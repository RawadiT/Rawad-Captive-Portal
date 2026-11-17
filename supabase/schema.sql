-- ==============================================================================
-- RAWAD TECH CAPTIVE PORTAL — SUPABASE POSTGRESQL SCHEMA
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
  mac_address TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Active / historical sessions
CREATE TABLE IF NOT EXISTS public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type TEXT NOT NULL CHECK (session_type IN ('free', 'user')),
  user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  mac_address TEXT NOT NULL,
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

-- ==============================================================================
-- ROW LEVEL SECURITY (Deny all anon/public access; Backend uses Service Role Key)
-- ==============================================================================
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- ATOMIC RPC FUNCTIONS (Concurrency-safe, Wall-Clock UTC)
-- ==============================================================================

-- Atomically claim or check remaining 30-min free quota for a MAC address
CREATE OR REPLACE FUNCTION public.claim_free_quota(
  p_mac TEXT,
  p_duration_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE (
  allowed BOOLEAN,
  is_new BOOLEAN,
  mac_address TEXT,
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  remaining_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row public.free_quotas%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_rem INTEGER;
BEGIN
  INSERT INTO public.free_quotas (mac_address, started_at, expires_at)
  VALUES (UPPER(TRIM(p_mac)), v_now, v_now + make_interval(secs => p_duration_seconds))
  ON CONFLICT (mac_address) DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN QUERY SELECT
      true,
      true,
      v_row.mac_address,
      v_row.started_at,
      v_row.expires_at,
      p_duration_seconds;
    RETURN;
  END IF;

  SELECT * INTO v_row
  FROM public.free_quotas fq
  WHERE fq.mac_address = UPPER(TRIM(p_mac));

  v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_row.expires_at - v_now)))::INTEGER);

  RETURN QUERY SELECT
    (v_rem > 0),
    false,
    v_row.mac_address,
    v_row.started_at,
    v_row.expires_at,
    v_rem;
END;
$$;

-- Atomically start Wall-Clock timer on first successful login for a user account
CREATE OR REPLACE FUNCTION public.activate_user_on_first_login(
  p_user_id UUID
)
RETURNS TABLE (
  id UUID,
  username TEXT,
  duration_minutes INTEGER,
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_disabled BOOLEAN,
  remaining_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_row public.users%ROWTYPE;
  v_rem INTEGER;
BEGIN
  UPDATE public.users u
  SET
    started_at = COALESCE(u.started_at, v_now),
    expires_at = COALESCE(u.expires_at, v_now + make_interval(mins => u.duration_minutes))
  WHERE u.id = p_user_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_row.expires_at - v_now)))::INTEGER);

  RETURN QUERY SELECT
    v_row.id,
    v_row.username,
    v_row.duration_minutes,
    v_row.started_at,
    v_row.expires_at,
    v_row.is_disabled,
    v_rem;
END;
$$;
