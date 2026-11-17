-- ==============================================================================
-- RAWAD TECH CAPTIVE PORTAL — SUPABASE POSTGRESQL SCHEMA (THIRD AUDIT HARDENED)
-- Single source of truth (Online Supabase PostgreSQL via HTTPS).
-- Idempotent for both fresh installs and upgrades from prior schema versions.
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

-- 4. Active / provisioning / revocation_pending / historical sessions
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
  lease_expires_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL CHECK (status IN ('provisioning', 'active', 'expired', 'disconnected', 'revocation_pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe idempotent upgrade for existing sessions columns, constraints & partial unique indexes
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NULL;

-- Backfill any legacy 'provisioning' rows that lack lease_expires_at (do NOT touch 'active' rows)
UPDATE public.sessions
SET lease_expires_at = created_at + INTERVAL '2 minutes'
WHERE status = 'provisioning' AND lease_expires_at IS NULL;

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
    CHECK (status IN ('provisioning', 'active', 'expired', 'disconnected', 'revocation_pending'));
END $$;

CREATE INDEX IF NOT EXISTS idx_sessions_mac_status ON public.sessions (mac_address, status);
CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON public.sessions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON public.sessions (expires_at);

DROP INDEX IF EXISTS public.idx_sessions_one_active_free_mac;
CREATE UNIQUE INDEX idx_sessions_one_active_free_mac
  ON public.sessions (mac_address)
  WHERE status IN ('provisioning', 'active', 'revocation_pending') AND session_type = 'free';

DROP INDEX IF EXISTS public.idx_sessions_one_active_user;
CREATE UNIQUE INDEX idx_sessions_one_active_user
  ON public.sessions (user_id)
  WHERE status IN ('provisioning', 'active', 'revocation_pending') AND session_type = 'user';

-- 5. Cross-process SessionMonitor lease locks (PostgreSQL-backed, crash-safe, fenced)
CREATE TABLE IF NOT EXISTS public.monitor_locks (
  lock_name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  fence_token BIGINT NOT NULL DEFAULT 0,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.monitor_locks ADD COLUMN IF NOT EXISTS fence_token BIGINT NOT NULL DEFAULT 0;

-- ==============================================================================
-- ROW LEVEL SECURITY & PRIVILEGE HARDENING
-- ==============================================================================
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_locks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admins, public.users, public.free_quotas, public.sessions, public.monitor_locks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admins, public.users, public.free_quotas, public.sessions, public.monitor_locks TO service_role;

-- ==============================================================================
-- LEGACY RPC PRIVILEGE REVOCATION & SAFE CLEANUP (IDEMPOTENT)
-- ==============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'claim_free_quota'
  ) THEN
    REVOKE ALL ON FUNCTION public.claim_free_quota(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
    DROP FUNCTION IF EXISTS public.claim_free_quota(TEXT, INTEGER);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'activate_user_on_first_login'
  ) THEN
    REVOKE ALL ON FUNCTION public.activate_user_on_first_login(UUID) FROM PUBLIC, anon, authenticated;
    DROP FUNCTION IF EXISTS public.activate_user_on_first_login(UUID);
  END IF;
END $$;

-- ==============================================================================
-- 3-STEP POSTGRESQL-LOCKED PROVISIONING & LEASE-VALIDATED FINALIZATION RPCS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.begin_free_provisioning(
  p_mac TEXT,
  p_ip TEXT,
  p_hs_user TEXT,
  p_hs_profile TEXT,
  p_duration_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE (
  allowed BOOLEAN,
  conflict_active BOOLEAN,
  session_id UUID,
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
  v_active public.sessions%ROWTYPE;
  v_sess_id UUID;
  v_rem INTEGER;
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

  PERFORM pg_advisory_xact_lock(hashtext('free:' || v_mac));

  -- Only transition expired-lease provisioning rows (> 2 min) to revocation_pending (never prematurely at 30s)
  UPDATE public.sessions s
  SET status = 'revocation_pending'
  WHERE s.mac_address = v_mac
    AND s.session_type = 'free'
    AND s.status = 'provisioning'
    AND s.lease_expires_at IS NOT NULL
    AND s.lease_expires_at < v_now;

  SELECT * INTO v_active
  FROM public.sessions s
  WHERE s.mac_address = v_mac
    AND s.session_type = 'free'
    AND s.status IN ('provisioning', 'active', 'revocation_pending')
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT false, true, v_active.id, 0;
    RETURN;
  END IF;

  SELECT * INTO v_fq FROM public.free_quotas fq WHERE fq.mac_address = v_mac;
  IF FOUND THEN
    v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_fq.expires_at - v_now)))::INTEGER);
    IF v_rem <= 0 THEN
      RETURN QUERY SELECT false, false, NULL::UUID, 0;
      RETURN;
    END IF;
  ELSE
    v_rem := p_duration_seconds;
  END IF;

  INSERT INTO public.sessions (
    session_type, user_id, mac_address, ip_address, hotspot_username, hotspot_profile,
    started_at, expires_at, lease_expires_at, status
  ) VALUES (
    'free', NULL, v_mac, TRIM(p_ip), TRIM(p_hs_user), TRIM(p_hs_profile),
    v_now, v_now + make_interval(secs => v_rem), v_now + INTERVAL '2 minutes', 'provisioning'
  )
  RETURNING id INTO v_sess_id;

  RETURN QUERY SELECT true, false, v_sess_id, v_rem;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_free_session(
  p_session_id UUID,
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
  v_sess public.sessions%ROWTYPE;
  v_fq public.free_quotas%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_rem INTEGER;
  v_is_new BOOLEAN := false;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Session ID is required';
  END IF;

  SELECT * INTO v_sess FROM public.sessions s WHERE s.id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_sess.status <> 'provisioning' THEN
    RAISE EXCEPTION 'Provisioning session not found or already finalized';
  END IF;
  IF v_sess.lease_expires_at IS NOT NULL AND v_sess.lease_expires_at < v_now THEN
    RAISE EXCEPTION 'Provisioning reservation lease expired before finalization';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('free:' || v_sess.mac_address));

  INSERT INTO public.free_quotas (mac_address, started_at, expires_at)
  VALUES (v_sess.mac_address, v_now, v_now + make_interval(secs => p_duration_seconds))
  ON CONFLICT ON CONSTRAINT free_quotas_pkey DO NOTHING
  RETURNING * INTO v_fq;

  IF FOUND THEN
    v_is_new := true;
    v_rem := p_duration_seconds;
  ELSE
    SELECT * INTO v_fq FROM public.free_quotas fq WHERE fq.mac_address = v_sess.mac_address;
    v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_fq.expires_at - v_now)))::INTEGER);
  END IF;

  IF v_rem <= 0 THEN
    UPDATE public.sessions SET status = 'revocation_pending' WHERE id = p_session_id;
    RETURN QUERY SELECT false, false, p_session_id, v_sess.mac_address, v_fq.started_at, v_fq.expires_at, 0;
    RETURN;
  END IF;

  UPDATE public.sessions
  SET status = 'active', started_at = v_fq.started_at, expires_at = v_fq.expires_at, lease_expires_at = NULL
  WHERE id = p_session_id;

  RETURN QUERY SELECT true, v_is_new, p_session_id, v_sess.mac_address, v_fq.started_at, v_fq.expires_at, v_rem;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_user_provisioning(
  p_user_id UUID,
  p_mac TEXT,
  p_ip TEXT,
  p_hs_user TEXT,
  p_hs_profile TEXT
)
RETURNS TABLE (
  allowed BOOLEAN,
  session_id UUID,
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
    RETURN QUERY SELECT false, NULL::UUID, 0;
    RETURN;
  END IF;

  IF v_user.expires_at IS NOT NULL THEN
    v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_user.expires_at - v_now)))::INTEGER);
  ELSE
    v_rem := v_user.duration_minutes * 60;
  END IF;

  IF v_rem <= 0 THEN
    RETURN QUERY SELECT false, NULL::UUID, 0;
    RETURN;
  END IF;

  UPDATE public.sessions s
  SET status = 'revocation_pending'
  WHERE s.user_id = p_user_id
    AND s.status = 'provisioning'
    AND s.lease_expires_at IS NOT NULL
    AND s.lease_expires_at < v_now;

  IF EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.user_id = p_user_id AND s.status IN ('provisioning', 'active', 'revocation_pending')
  ) THEN
    RAISE EXCEPTION 'Concurrent, active, or revocation-pending session exists for this account';
  END IF;

  INSERT INTO public.sessions (
    session_type, user_id, mac_address, ip_address, hotspot_username, hotspot_profile,
    started_at, expires_at, lease_expires_at, status
  ) VALUES (
    'user', p_user_id, v_mac, TRIM(p_ip), TRIM(p_hs_user), TRIM(p_hs_profile),
    COALESCE(v_user.started_at, v_now),
    COALESCE(v_user.expires_at, v_now + make_interval(mins => v_user.duration_minutes)),
    v_now + INTERVAL '2 minutes',
    'provisioning'
  )
  RETURNING id INTO v_sess_id;

  RETURN QUERY SELECT true, v_sess_id, v_rem;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_user_session(
  p_session_id UUID
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
  v_sess public.sessions%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_rem INTEGER;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Session ID is required';
  END IF;

  SELECT * INTO v_sess FROM public.sessions s WHERE s.id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_sess.status <> 'provisioning' OR v_sess.user_id IS NULL THEN
    RAISE EXCEPTION 'Provisioning session not found or already finalized';
  END IF;
  IF v_sess.lease_expires_at IS NOT NULL AND v_sess.lease_expires_at < v_now THEN
    RAISE EXCEPTION 'Provisioning reservation lease expired before finalization';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('user:' || v_sess.user_id::TEXT));

  SELECT * INTO v_user FROM public.users u WHERE u.id = v_sess.user_id FOR UPDATE;
  IF NOT FOUND OR v_user.is_disabled THEN
    UPDATE public.sessions SET status = 'revocation_pending' WHERE id = p_session_id;
    RETURN QUERY SELECT false, p_session_id, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, 0;
    RETURN;
  END IF;

  IF v_user.started_at IS NULL OR v_user.expires_at IS NULL THEN
    UPDATE public.users u
    SET started_at = v_now, expires_at = v_now + make_interval(mins => u.duration_minutes)
    WHERE u.id = v_user.id
    RETURNING * INTO v_user;
  END IF;

  v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_user.expires_at - v_now)))::INTEGER);
  IF v_rem <= 0 THEN
    UPDATE public.sessions SET status = 'revocation_pending' WHERE id = p_session_id;
    RETURN QUERY SELECT false, p_session_id, v_user.started_at, v_user.expires_at, 0;
    RETURN;
  END IF;

  UPDATE public.sessions
  SET status = 'active', started_at = v_user.started_at, expires_at = v_user.expires_at, lease_expires_at = NULL
  WHERE id = p_session_id;

  RETURN QUERY SELECT true, p_session_id, v_user.started_at, v_user.expires_at, v_rem;
END;
$$;

CREATE OR REPLACE FUNCTION public.abort_provisioning(
  p_session_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.sessions
  SET status = 'disconnected', lease_expires_at = NULL
  WHERE id = p_session_id AND status = 'provisioning';
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_revocation_pending(
  p_session_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.sessions
  SET status = 'revocation_pending', lease_expires_at = NULL
  WHERE id = p_session_id AND status IN ('provisioning', 'active', 'disconnected');
END;
$$;

-- Periodically reclaim expired 'provisioning' leases -> 'revocation_pending' even without new user requests
CREATE OR REPLACE FUNCTION public.reclaim_expired_provisioning_leases()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH expired_rows AS (
    SELECT id FROM public.sessions
    WHERE status = 'provisioning'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at < clock_timestamp()
    FOR UPDATE SKIP LOCKED
  ),
  reclaimed AS (
    UPDATE public.sessions s
    SET status = 'revocation_pending', lease_expires_at = NULL
    FROM expired_rows e
    WHERE s.id = e.id
    RETURNING s.id
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM reclaimed;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- Acquire or renew a cross-process SessionMonitor lease lock in PostgreSQL with monotonic fence_token
DROP FUNCTION IF EXISTS public.try_acquire_monitor_lock(TEXT, TEXT, INTEGER);
CREATE OR REPLACE FUNCTION public.try_acquire_monitor_lock(
  p_lock_name TEXT,
  p_owner_id TEXT,
  p_lease_seconds INTEGER DEFAULT 30
)
RETURNS TABLE (
  acquired BOOLEAN,
  fence_token BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_token BIGINT;
BEGIN
  IF TRIM(COALESCE(p_lock_name, '')) = '' OR TRIM(COALESCE(p_owner_id, '')) = '' THEN
    RAISE EXCEPTION 'Lock name and owner ID are required';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 5 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'Invalid monitor lock lease seconds';
  END IF;

  INSERT INTO public.monitor_locks (lock_name, owner_id, fence_token, lease_expires_at, updated_at)
  VALUES (TRIM(p_lock_name), TRIM(p_owner_id), 1, v_now + make_interval(secs => p_lease_seconds), v_now)
  ON CONFLICT (lock_name) DO UPDATE
    SET owner_id = EXCLUDED.owner_id,
        fence_token = CASE
          WHEN public.monitor_locks.owner_id = EXCLUDED.owner_id THEN public.monitor_locks.fence_token
          ELSE public.monitor_locks.fence_token + 1
        END,
        lease_expires_at = EXCLUDED.lease_expires_at,
        updated_at = EXCLUDED.updated_at
    WHERE public.monitor_locks.owner_id = EXCLUDED.owner_id
       OR public.monitor_locks.lease_expires_at < v_now
  RETURNING public.monitor_locks.fence_token INTO v_token;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_token;
  ELSE
    RETURN QUERY SELECT false, 0::BIGINT;
  END IF;
END;
$$;

-- Atomically update session status ONLY if the caller holds the row-locked monitor lock & fence_token
CREATE OR REPLACE FUNCTION public.fenced_update_session_status(
  p_session_id UUID,
  p_status TEXT,
  p_lock_name TEXT,
  p_owner_id TEXT,
  p_fence_token BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lock public.monitor_locks%ROWTYPE;
  v_lock_name TEXT := TRIM(COALESCE(p_lock_name, ''));
  v_owner_id TEXT := TRIM(COALESCE(p_owner_id, ''));
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Session ID is required';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('provisioning', 'active', 'expired', 'disconnected', 'revocation_pending') THEN
    RAISE EXCEPTION 'Invalid session status: %', COALESCE(p_status, '<null>');
  END IF;
  IF p_fence_token IS NULL OR v_lock_name = '' OR v_owner_id = '' THEN
    RETURN false;
  END IF;

  -- Acquire transactional row lock on monitor_locks FIRST so no other backend
  -- can acquire/steal the lock between ownership verification and the session update.
  SELECT * INTO v_lock
  FROM public.monitor_locks ml
  WHERE ml.lock_name = v_lock_name
  FOR UPDATE;

  -- Validate ownership, fence_token (IS DISTINCT FROM), and lease expiry AFTER acquiring row lock
  -- using clock_timestamp() directly so a lease expiring while waiting is rejected.
  IF NOT FOUND
     OR v_lock.owner_id IS DISTINCT FROM v_owner_id
     OR v_lock.fence_token IS DISTINCT FROM p_fence_token
     OR v_lock.lease_expires_at < clock_timestamp() THEN
    RETURN false;
  END IF;

  UPDATE public.sessions
  SET status = p_status
  WHERE id = p_session_id;

  RETURN FOUND;
END;
$$;

-- Release a cross-process SessionMonitor lease lock owned by this instance
CREATE OR REPLACE FUNCTION public.release_monitor_lock(
  p_lock_name TEXT,
  p_owner_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.monitor_locks
  WHERE lock_name = TRIM(COALESCE(p_lock_name, ''))
    AND owner_id = TRIM(COALESCE(p_owner_id, ''));
END;
$$;

-- Renew an active 'provisioning' reservation lease during slow MikroTik provisioning
CREATE OR REPLACE FUNCTION public.renew_provisioning_lease(
  p_session_id UUID,
  p_extend_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Session ID is required';
  END IF;
  IF p_extend_seconds IS NULL OR p_extend_seconds < 10 OR p_extend_seconds > 300 THEN
    RAISE EXCEPTION 'Invalid lease extension seconds';
  END IF;

  UPDATE public.sessions
  SET lease_expires_at = GREATEST(COALESCE(lease_expires_at, v_now), v_now) + make_interval(secs => p_extend_seconds)
  WHERE id = p_session_id
    AND status = 'provisioning'
    AND (lease_expires_at IS NULL OR lease_expires_at >= v_now);

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_free_provisioning(TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_free_provisioning(TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_free_session(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_free_session(UUID, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.begin_user_provisioning(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_user_provisioning(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_user_session(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_user_session(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.abort_provisioning(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abort_provisioning(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.mark_revocation_pending(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_revocation_pending(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.reclaim_expired_provisioning_leases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_expired_provisioning_leases() TO service_role;

REVOKE ALL ON FUNCTION public.renew_provisioning_lease(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_provisioning_lease(UUID, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.try_acquire_monitor_lock(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_monitor_lock(TEXT, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.fenced_update_session_status(UUID, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fenced_update_session_status(UUID, TEXT, TEXT, TEXT, BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public.release_monitor_lock(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_monitor_lock(TEXT, TEXT) TO service_role;
