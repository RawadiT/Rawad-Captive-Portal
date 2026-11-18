-- ==============================================================================
-- RAWAD TECH CAPTIVE PORTAL — SUPABASE POSTGRESQL SCHEMA
-- Architecture: MikroTik HotSpot UI + Supabase PostgreSQL & Edge Functions
-- Timezone rule: Daily 30-min free quota resets at midnight Asia/Baghdad;
--                all timestamps stored in UTC (TIMESTAMPTZ).
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Admin accounts
CREATE TABLE IF NOT EXISTS public.admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_super_admin BOOLEAN NOT NULL DEFAULT false,
  role TEXT NOT NULL DEFAULT 'subordinate' CHECK (role IN ('site_owner', 'general', 'subordinate')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'subordinate';

-- 2. Time-limited customer accounts (duration starts on FIRST successful login)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  started_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  is_disabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON public.users (username);

-- 3. Daily 30-minute free quota per MAC (1 per calendar day in Asia/Baghdad)
CREATE TABLE IF NOT EXISTS public.free_quotas (
  mac_address TEXT NOT NULL CHECK (mac_address ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  quota_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Baghdad')::date),
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT free_quotas_pkey PRIMARY KEY (mac_address, quota_date)
);

-- Safe idempotent migration from legacy free_quotas (mac_address PK -> (mac_address, quota_date) PK)
ALTER TABLE public.free_quotas ADD COLUMN IF NOT EXISTS quota_date DATE;
UPDATE public.free_quotas
SET quota_date = (started_at AT TIME ZONE 'Asia/Baghdad')::date
WHERE quota_date IS NULL;
ALTER TABLE public.free_quotas ALTER COLUMN quota_date SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.free_quotas'::regclass
      AND conname = 'free_quotas_pkey'
      AND pg_get_constraintdef(oid) NOT LIKE '%quota_date%'
  ) THEN
    ALTER TABLE public.free_quotas DROP CONSTRAINT free_quotas_pkey;
    ALTER TABLE public.free_quotas ADD CONSTRAINT free_quotas_pkey PRIMARY KEY (mac_address, quota_date);
  END IF;
END $$;

-- 4. Authorized / Active / Historical sessions
CREATE TABLE IF NOT EXISTS public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type TEXT NOT NULL CHECK (session_type IN ('free', 'user')),
  user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  mac_address TEXT NOT NULL CHECK (mac_address ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  ip_address TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('authorized', 'active', 'expired', 'disconnected')),
  revoked_at TIMESTAMPTZ NULL,
  revocation_ack_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe idempotent migration for legacy sessions rows/columns/constraints
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS revocation_ack_at TIMESTAMPTZ NULL;
UPDATE public.sessions
SET status = 'disconnected'
WHERE status NOT IN ('authorized', 'active', 'expired', 'disconnected');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sessions'::regclass AND conname = 'sessions_status_check'
  ) THEN
    ALTER TABLE public.sessions DROP CONSTRAINT sessions_status_check;
  END IF;
  ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_status_check
    CHECK (status IN ('authorized', 'active', 'expired', 'disconnected'));
END $$;

CREATE INDEX IF NOT EXISTS idx_sessions_mac_status ON public.sessions (mac_address, status);
CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON public.sessions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON public.sessions (expires_at);

-- Prevent duplicate concurrent authorized/active sessions for the same MAC
DROP INDEX IF EXISTS public.idx_sessions_one_active_free_mac;
DROP INDEX IF EXISTS public.idx_sessions_one_active_user;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_active_mac
  ON public.sessions (mac_address)
  WHERE status IN ('authorized', 'active');

-- ==============================================================================
-- ROW LEVEL SECURITY & PRIVILEGE HARDENING
-- ==============================================================================
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admins, public.users, public.free_quotas, public.sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admins, public.users, public.free_quotas, public.sessions TO service_role;

-- ==============================================================================
-- ATOMIC POSTGRESQL RPCS (service_role ONLY)
-- ==============================================================================

-- 1. Claim or resume today's 30-min free quota for MAC (Asia/Baghdad calendar day)
CREATE OR REPLACE FUNCTION public.request_free_quota(
  p_mac TEXT,
  p_ip TEXT,
  p_duration_seconds INTEGER DEFAULT 1800,
  p_now TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  allowed BOOLEAN,
  is_new BOOLEAN,
  session_id UUID,
  remaining_seconds INTEGER,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_mac TEXT := UPPER(TRIM(COALESCE(p_mac, '')));
  v_ip TEXT := TRIM(COALESCE(p_ip, ''));
  v_now TIMESTAMPTZ := COALESCE(p_now, clock_timestamp());
  v_baghdad_date DATE := (v_now AT TIME ZONE 'Asia/Baghdad')::date;
  v_fq public.free_quotas%ROWTYPE;
  v_sess_id UUID;
  v_rem INTEGER;
  v_is_new BOOLEAN := false;
BEGIN
  IF v_mac !~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' THEN
    RAISE EXCEPTION 'Invalid MAC address format';
  END IF;
  IF v_ip = '' THEN
    RAISE EXCEPTION 'Client IP address is required';
  END IF;
  IF p_duration_seconds IS NULL OR p_duration_seconds < 60 OR p_duration_seconds > 86400 THEN
    RAISE EXCEPTION 'Invalid free quota duration';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('free:' || v_mac));

  INSERT INTO public.free_quotas (mac_address, quota_date, started_at, expires_at)
  VALUES (v_mac, v_baghdad_date, v_now, v_now + make_interval(secs => p_duration_seconds))
  ON CONFLICT ON CONSTRAINT free_quotas_pkey DO NOTHING
  RETURNING * INTO v_fq;

  IF FOUND THEN
    v_is_new := true;
    v_rem := p_duration_seconds;
  ELSE
    SELECT * INTO v_fq
    FROM public.free_quotas fq
    WHERE fq.mac_address = v_mac AND fq.quota_date = v_baghdad_date;

    v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_fq.expires_at - v_now)))::INTEGER);
    IF v_rem <= 0 THEN
      RETURN QUERY SELECT false, false, NULL::UUID, 0, v_fq.expires_at;
      RETURN;
    END IF;
  END IF;

  UPDATE public.sessions s
  SET status = 'disconnected'
  WHERE s.mac_address = v_mac AND s.status IN ('authorized', 'active');

  INSERT INTO public.sessions (
    session_type, user_id, mac_address, ip_address, started_at, expires_at, status
  ) VALUES (
    'free', NULL, v_mac, v_ip, v_fq.started_at, v_fq.expires_at, 'authorized'
  )
  RETURNING id INTO v_sess_id;

  RETURN QUERY SELECT true, v_is_new, v_sess_id, v_rem, v_fq.expires_at;
END;
$$;

-- 2. Authorize user account login (wall-clock duration starts ONLY on first login)
CREATE OR REPLACE FUNCTION public.authorize_user_login(
  p_user_id UUID,
  p_mac TEXT,
  p_ip TEXT,
  p_now TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  allowed BOOLEAN,
  session_id UUID,
  remaining_seconds INTEGER,
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_mac TEXT := UPPER(TRIM(COALESCE(p_mac, '')));
  v_ip TEXT := TRIM(COALESCE(p_ip, ''));
  v_now TIMESTAMPTZ := COALESCE(p_now, clock_timestamp());
  v_user public.users%ROWTYPE;
  v_sess_id UUID;
  v_rem INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required';
  END IF;
  IF v_mac !~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' THEN
    RAISE EXCEPTION 'Invalid MAC address format';
  END IF;
  IF v_ip = '' THEN
    RAISE EXCEPTION 'Client IP address is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('user:' || p_user_id::TEXT));

  SELECT * INTO v_user FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.is_disabled THEN
    RETURN QUERY SELECT false, NULL::UUID, 0, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_user.started_at IS NULL OR v_user.expires_at IS NULL THEN
    UPDATE public.users u
    SET started_at = v_now,
        expires_at = v_now + make_interval(mins => u.duration_minutes)
    WHERE u.id = v_user.id
    RETURNING * INTO v_user;
  END IF;

  v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_user.expires_at - v_now)))::INTEGER);
  IF v_rem <= 0 THEN
    RETURN QUERY SELECT false, NULL::UUID, 0, v_user.started_at, v_user.expires_at;
    RETURN;
  END IF;

  UPDATE public.sessions s
  SET status = 'disconnected'
  WHERE (s.mac_address = v_mac OR s.user_id = p_user_id)
    AND s.status IN ('authorized', 'active');

  INSERT INTO public.sessions (
    session_type, user_id, mac_address, ip_address, started_at, expires_at, status
  ) VALUES (
    'user', p_user_id, v_mac, v_ip, v_user.started_at, v_user.expires_at, 'authorized'
  )
  RETURNING id INTO v_sess_id;

  RETURN QUERY SELECT true, v_sess_id, v_rem, v_user.started_at, v_user.expires_at;
END;
$$;

-- 3. Called by MikroTik on-login via verify-mac Edge Function
CREATE OR REPLACE FUNCTION public.verify_mac_authorization(
  p_mac TEXT,
  p_ip TEXT DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining_seconds INTEGER,
  session_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_mac TEXT := UPPER(TRIM(COALESCE(p_mac, '')));
  v_now TIMESTAMPTZ := COALESCE(p_now, clock_timestamp());
  v_sess public.sessions%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_rem INTEGER;
BEGIN
  IF v_mac !~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' THEN
    RETURN QUERY SELECT false, 0, NULL::TEXT;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('verify:' || v_mac));

  SELECT * INTO v_sess
  FROM public.sessions s
  WHERE s.mac_address = v_mac
    AND s.status IN ('authorized', 'active')
  ORDER BY s.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, NULL::TEXT;
    RETURN;
  END IF;

  IF v_sess.session_type = 'user' AND v_sess.user_id IS NOT NULL THEN
    SELECT * INTO v_user FROM public.users u WHERE u.id = v_sess.user_id;
    IF NOT FOUND OR v_user.is_disabled OR v_user.expires_at IS NULL THEN
      UPDATE public.sessions s
      SET status = 'disconnected',
          revoked_at = COALESCE(s.revoked_at, v_now)
      WHERE s.id = v_sess.id;
      RETURN QUERY SELECT false, 0, NULL::TEXT;
      RETURN;
    END IF;
    v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_user.expires_at - v_now)))::INTEGER);
  ELSE
    v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_sess.expires_at - v_now)))::INTEGER);
  END IF;

  IF v_rem <= 0 THEN
    UPDATE public.sessions s
    SET status = 'expired',
        revoked_at = COALESCE(s.revoked_at, v_now)
    WHERE s.id = v_sess.id;
    RETURN QUERY SELECT false, 0, NULL::TEXT;
    RETURN;
  END IF;

  UPDATE public.sessions
  SET status = 'active',
      ip_address = COALESCE(NULLIF(TRIM(COALESCE(p_ip, '')), ''), ip_address)
  WHERE id = v_sess.id;

  RETURN QUERY SELECT true, v_rem, v_sess.session_type;
END;
$$;

-- 4. Disconnect active/authorized session for MAC (on-logout or user disable)
CREATE OR REPLACE FUNCTION public.disconnect_mac_session(
  p_mac TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_mac TEXT := UPPER(TRIM(COALESCE(p_mac, '')));
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  UPDATE public.sessions
  SET status = 'disconnected',
      revoked_at = COALESCE(revoked_at, v_now)
  WHERE mac_address = v_mac AND status IN ('authorized', 'active');
END;
$$;

-- 5. Return ALL unacknowledged disabled/expired sessions regardless of session created_at age
DROP FUNCTION IF EXISTS public.get_revoked_sessions(INTEGER);
CREATE OR REPLACE FUNCTION public.get_revoked_sessions(
  p_now TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  session_id UUID,
  mac_address TEXT,
  ip_address TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_now, clock_timestamp());
BEGIN
  -- Mark any expired active/authorized sessions as expired (regardless of created_at)
  UPDATE public.sessions s
  SET status = 'expired',
      revoked_at = COALESCE(s.revoked_at, v_now)
  WHERE s.status IN ('authorized', 'active')
    AND s.expires_at <= v_now;

  -- Mark any active/authorized sessions of disabled users as disconnected (regardless of created_at)
  UPDATE public.sessions s
  SET status = 'disconnected',
      revoked_at = COALESCE(s.revoked_at, v_now)
  FROM public.users u
  WHERE s.user_id = u.id
    AND u.is_disabled = true
    AND s.status IN ('authorized', 'active');

  -- Return all pending revocations not yet acknowledged by the router
  RETURN QUERY
  SELECT s.id, s.mac_address, s.ip_address
  FROM public.sessions s
  WHERE s.status IN ('expired', 'disconnected')
    AND s.revoked_at IS NOT NULL
    AND s.revocation_ack_at IS NULL
  ORDER BY s.revoked_at ASC;
END;
$$;

-- 6. Acknowledge revocations ONLY after router removed rawad-verified / HotSpot active
CREATE OR REPLACE FUNCTION public.ack_revoked_sessions(
  p_session_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_session_ids IS NULL OR array_length(p_session_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH acked AS (
    UPDATE public.sessions s
    SET revocation_ack_at = COALESCE(s.revocation_ack_at, clock_timestamp())
    WHERE s.id = ANY(p_session_ids)
      AND s.status IN ('expired', 'disconnected')
      AND s.revoked_at IS NOT NULL
      AND s.revocation_ack_at IS NULL
    RETURNING s.id
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM acked;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.request_free_quota(TEXT, TEXT, INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_free_quota(TEXT, TEXT, INTEGER, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.authorize_user_login(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_user_login(UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.verify_mac_authorization(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_mac_authorization(TEXT, TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.disconnect_mac_session(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_mac_session(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.get_revoked_sessions(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_revoked_sessions(TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.ack_revoked_sessions(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ack_revoked_sessions(UUID[]) TO service_role;
