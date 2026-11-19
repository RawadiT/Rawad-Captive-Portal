-- ==============================================================================
-- External Rollback for 202611190001_portal_settings_and_unlimited.sql
-- Kept intentionally OUTSIDE supabase/migrations/ to avoid version collisions.
-- ==============================================================================

-- 1. Drop Phase 1 cleanup RPCs
DROP FUNCTION IF EXISTS public.get_cleanup_summary(TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.cleanup_operational_data(TIMESTAMPTZ);

-- 2. Restore original RPC implementations (pre-Phase 1)
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
  UPDATE public.sessions s
  SET status = 'expired',
      revoked_at = COALESCE(s.revoked_at, v_now)
  WHERE s.status IN ('authorized', 'active')
    AND s.expires_at <= v_now;

  UPDATE public.sessions s
  SET status = 'disconnected',
      revoked_at = COALESCE(s.revoked_at, v_now)
  FROM public.users u
  WHERE s.user_id = u.id
    AND u.is_disabled = true
    AND s.status IN ('authorized', 'active');

  RETURN QUERY
  SELECT s.id, s.mac_address, s.ip_address
  FROM public.sessions s
  WHERE s.status IN ('expired', 'disconnected')
    AND s.revoked_at IS NOT NULL
    AND s.revocation_ack_at IS NULL
  ORDER BY s.revoked_at ASC;
END;
$$;

-- 3. Revert sessions.expires_at to NOT NULL safely
UPDATE public.sessions
SET expires_at = COALESCE(expires_at, started_at + interval '60 minutes'),
    status = CASE WHEN status IN ('authorized', 'active') THEN 'disconnected' ELSE status END,
    revoked_at = COALESCE(revoked_at, clock_timestamp())
WHERE expires_at IS NULL;

ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_expires_at_check;
ALTER TABLE public.sessions ALTER COLUMN expires_at SET NOT NULL;

-- 4. Revert users.duration_minutes and drop users.is_unlimited safely
UPDATE public.users
SET duration_minutes = COALESCE(duration_minutes, 60)
WHERE duration_minutes IS NULL OR duration_minutes <= 0;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_duration_minutes_check;
ALTER TABLE public.users ALTER COLUMN duration_minutes SET NOT NULL;
ALTER TABLE public.users ADD CONSTRAINT users_duration_minutes_check CHECK (duration_minutes > 0);
ALTER TABLE public.users DROP COLUMN IF EXISTS is_unlimited;

-- 5. Drop portal_settings
DROP TABLE IF EXISTS public.portal_settings;
