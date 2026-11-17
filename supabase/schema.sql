-- ==============================================================================
-- RAWAD TECH CAPTIVE PORTAL — SUPABASE POSTGRESQL SCHEMA (HARDENED)
-- Single source of truth (Online Supabase PostgreSQL via HTTPS).
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Admin accounts
CREATE TABLE IF NOT EXISTS public.admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Time-limited customer accounts (NOT tied to MAC; Wall-Clock UTC)
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

-- 3. One-time 30-minute free quota per MAC (NEVER deleted, NEVER reset)
CREATE TABLE IF NOT EXISTS public.free_quotas (
  mac_address TEXT PRIMARY KEY CHECK (mac_address ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Active / historical sessions
CREATE TABLE IF NOT EXISTS public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type TEXT NOT NULL CHECK (session_type IN ('free', 'user')),
  user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  mac_address TEXT NOT NULL CHECK (mac_address ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  ip_address TEXT NOT NULL,
  hotspot_username TEXT NOT NULL,
  hotspot_profile TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'disconnected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_mac_status ON public.sessions (mac_address, status);
CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON public.sessions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON public.sessions (expires_at);

-- Database-level guarantee against duplicate active sessions for the same MAC or user account
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_active_free_mac
  ON public.sessions (mac_address)
  WHERE status = 'active' AND session_type = 'free';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_active_user
  ON public.sessions (user_id)
  WHERE status = 'active' AND session_type = 'user';

-- ==============================================================================
-- ROW LEVEL SECURITY & PRIVILEGE HARDENING
-- Deny all access to PUBLIC, anon, and authenticated; Backend uses service_role.
-- ==============================================================================
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admins, public.users, public.free_quotas, public.sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admins, public.users, public.free_quotas, public.sessions TO service_role;

-- ==============================================================================
-- HARDENED ATOMIC RPC FUNCTIONS (PostgreSQL Advisory Locks + Input Validation)
-- ==============================================================================

-- Atomically claim/resume free quota AND create active session under advisory lock.
-- Called ONLY AFTER MikroTik provisioning succeeds (fail-closed compensating revoke on failure).
CREATE OR REPLACE FUNCTION public.commit_free_session(
  p_mac TEXT,
  p_ip TEXT,
  p_hs_user TEXT,
  p_hs_profile TEXT,
  p_duration_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE (
  allowed BOOLEAN,
  is_new BOOLEAN,
  session_id UUID,
  mac_address TEXT,
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  remaining_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_mac TEXT := UPPER(TRIM(COALESCE(p_mac, '')));
  v_now TIMESTAMPTZ := clock_timestamp();
  v_fq public.free_quotas%ROWTYPE;
  v_sess_id UUID;
  v_rem INTEGER;
  v_is_new BOOLEAN := false;
BEGIN
  IF v_mac !~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' THEN
    RAISE EXCEPTION 'Invalid MAC address format';
  END IF;
  IF p_duration_seconds IS NULL OR p_duration_seconds < 1 OR p_duration_seconds > 86400 THEN
    RAISE EXCEPTION 'Invalid free quota duration';
  END IF;
  IF TRIM(COALESCE(p_ip, '')) = '' OR TRIM(COALESCE(p_hs_user, '')) = '' OR TRIM(COALESCE(p_hs_profile, '')) = '' THEN
    RAISE EXCEPTION 'Missing session metadata';
  END IF;

  -- PostgreSQL transaction-scoped advisory lock prevents concurrent race conditions across processes
  PERFORM pg_advisory_xact_lock(hashtext('free:' || v_mac));

  INSERT INTO public.free_quotas (mac_address, started_at, expires_at)
  VALUES (v_mac, v_now, v_now + make_interval(secs => p_duration_seconds))
  ON CONFLICT (mac_address) DO NOTHING
  RETURNING * INTO v_fq;

  IF FOUND THEN
    v_is_new := true;
    v_rem := p_duration_seconds;
  ELSE
    SELECT * INTO v_fq FROM public.free_quotas fq WHERE fq.mac_address = v_mac;
    v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_fq.expires_at - v_now)))::INTEGER);
  END IF;

  IF v_rem <= 0 THEN
    RETURN QUERY SELECT false, false, NULL::UUID, v_mac, v_fq.started_at, v_fq.expires_at, 0;
    RETURN;
  END IF;

  -- Close any stale active free session for this MAC before inserting the new active session
  UPDATE public.sessions s
  SET status = 'disconnected'
  WHERE s.mac_address = v_mac AND s.session_type = 'free' AND s.status = 'active';

  INSERT INTO public.sessions (
    session_type, user_id, mac_address, ip_address, hotspot_username, hotspot_profile,
    started_at, expires_at, status
  ) VALUES (
    'free', NULL, v_mac, TRIM(p_ip), TRIM(p_hs_user), TRIM(p_hs_profile),
    v_fq.started_at, v_fq.expires_at, 'active'
  )
  RETURNING id INTO v_sess_id;

  RETURN QUERY SELECT true, v_is_new, v_sess_id, v_mac, v_fq.started_at, v_fq.expires_at, v_rem;
END;
$$;

-- Atomically start Wall-Clock timer on first successful login AND create active session.
-- Called ONLY AFTER MikroTik provisioning succeeds.
CREATE OR REPLACE FUNCTION public.commit_user_session(
  p_user_id UUID,
  p_mac TEXT,
  p_ip TEXT,
  p_hs_user TEXT,
  p_hs_profile TEXT
)
RETURNS TABLE (
  allowed BOOLEAN,
  session_id UUID,
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  remaining_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_mac TEXT := UPPER(TRIM(COALESCE(p_mac, '')));
  v_now TIMESTAMPTZ := clock_timestamp();
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
  IF TRIM(COALESCE(p_ip, '')) = '' OR TRIM(COALESCE(p_hs_user, '')) = '' OR TRIM(COALESCE(p_hs_profile, '')) = '' THEN
    RAISE EXCEPTION 'Missing session metadata';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('user:' || p_user_id::TEXT));

  SELECT * INTO v_user FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.is_disabled THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, 0;
    RETURN;
  END IF;

  IF v_user.started_at IS NULL OR v_user.expires_at IS NULL THEN
    UPDATE public.users u
    SET
      started_at = v_now,
      expires_at = v_now + make_interval(mins => u.duration_minutes)
    WHERE u.id = p_user_id
    RETURNING * INTO v_user;
  END IF;

  v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_user.expires_at - v_now)))::INTEGER);
  IF v_rem <= 0 THEN
    RETURN QUERY SELECT false, NULL::UUID, v_user.started_at, v_user.expires_at, 0;
    RETURN;
  END IF;

  -- Close any stale active sessions for this account OR this MAC
  UPDATE public.sessions s
  SET status = 'disconnected'
  WHERE s.status = 'active' AND (s.user_id = p_user_id OR s.mac_address = v_mac);

  INSERT INTO public.sessions (
    session_type, user_id, mac_address, ip_address, hotspot_username, hotspot_profile,
    started_at, expires_at, status
  ) VALUES (
    'user', p_user_id, v_mac, TRIM(p_ip), TRIM(p_hs_user), TRIM(p_hs_profile),
    v_user.started_at, v_user.expires_at, 'active'
  )
  RETURNING id INTO v_sess_id;

  RETURN QUERY SELECT true, v_sess_id, v_user.started_at, v_user.expires_at, v_rem;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_free_session(TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_free_session(TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.commit_user_session(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_user_session(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
