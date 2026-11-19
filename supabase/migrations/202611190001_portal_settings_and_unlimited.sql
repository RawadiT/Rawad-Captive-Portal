-- ==============================================================================
-- Phase 1 Migration: Portal Settings, Unlimited User Accounts,
-- Option B Baghdad-Date Cleanup & Active Free-Session Protection
-- ==============================================================================

-- 1. Single-row portal branding, welcome text, social links, and support phone
CREATE TABLE IF NOT EXISTS public.portal_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  site_title TEXT NOT NULL DEFAULT 'شبكة رواد',
  welcome_title TEXT NOT NULL DEFAULT 'أهلاً بك في شبكة رواد',
  welcome_subtitle TEXT NOT NULL DEFAULT 'استمتع بإنترنت فائق السرعة عبر بوابة الدخول الموحدة',
  free_notice TEXT NOT NULL DEFAULT 'يحق لكل جهاز 30 دقيقة مجانية يومياً',
  instagram_url TEXT NOT NULL DEFAULT '' CHECK (instagram_url = '' OR instagram_url ~* '^https?://'),
  instagram_enabled BOOLEAN NOT NULL DEFAULT false,
  facebook_url TEXT NOT NULL DEFAULT '' CHECK (facebook_url = '' OR facebook_url ~* '^https?://'),
  facebook_enabled BOOLEAN NOT NULL DEFAULT false,
  tiktok_url TEXT NOT NULL DEFAULT '' CHECK (tiktok_url = '' OR tiktok_url ~* '^https?://'),
  tiktok_enabled BOOLEAN NOT NULL DEFAULT false,
  whatsapp_url TEXT NOT NULL DEFAULT '' CHECK (whatsapp_url = '' OR whatsapp_url ~* '^https?://'),
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
  phone_number TEXT NOT NULL DEFAULT '' CHECK (phone_number = '' OR phone_number ~ '^[0-9+\-\s()]{3,32}$'),
  phone_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.portal_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.portal_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.portal_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.portal_settings TO service_role;

-- 2. Unlimited accounts support on public.users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_unlimited BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.users
  ALTER COLUMN duration_minutes DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND conname = 'users_duration_minutes_check'
  ) THEN
    ALTER TABLE public.users DROP CONSTRAINT users_duration_minutes_check;
  END IF;
  ALTER TABLE public.users
    ADD CONSTRAINT users_duration_minutes_check
    CHECK (
      (is_unlimited = true AND (duration_minutes IS NULL OR duration_minutes > 0))
      OR
      (is_unlimited = false AND duration_minutes IS NOT NULL AND duration_minutes > 0)
    );
END $$;

-- 3. Allow expires_at NULL for unlimited user sessions (free sessions remain NOT NULL)
ALTER TABLE public.sessions
  ALTER COLUMN expires_at DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sessions'::regclass AND conname = 'sessions_expires_at_check'
  ) THEN
    ALTER TABLE public.sessions DROP CONSTRAINT sessions_expires_at_check;
  END IF;
  ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_expires_at_check
    CHECK (
      (session_type = 'free' AND expires_at IS NOT NULL)
      OR
      (session_type = 'user')
    );
END $$;

-- 4. Update request_free_quota: preserve active unexpired free session & cross-midnight window
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
  v_active_sess public.sessions%ROWTYPE;
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

  -- Step 1: Check today's Baghdad calendar quota FIRST (prevents bypass or replay if today's quota already exists/exhausted)
  SELECT * INTO v_fq
  FROM public.free_quotas fq
  WHERE fq.mac_address = v_mac AND fq.quota_date = v_baghdad_date;

  IF FOUND THEN
    v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_fq.expires_at - v_now)))::INTEGER);
    IF v_rem <= 0 THEN
      RETURN QUERY SELECT false, false, NULL::UUID, 0, v_fq.expires_at;
      RETURN;
    END IF;
    v_is_new := false;
  ELSE
    -- Guard 1: active/authorized overnight free session already in progress (started_at <= v_now < expires_at)
    SELECT s.* INTO v_active_sess
    FROM public.sessions s
    WHERE s.mac_address = v_mac
      AND s.session_type = 'free'
      AND s.status IN ('authorized', 'active')
      AND s.started_at <= v_now
      AND s.expires_at IS NOT NULL
      AND s.expires_at > v_now
    ORDER BY s.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_active_sess.expires_at - v_now)))::INTEGER);
      IF v_rem > 0 THEN
        UPDATE public.sessions s
        SET status = 'disconnected'
        WHERE s.mac_address = v_mac AND s.status IN ('authorized', 'active');

        INSERT INTO public.sessions (
          session_type, user_id, mac_address, ip_address, started_at, expires_at, status
        ) VALUES (
          'free', NULL, v_mac, v_ip, v_active_sess.started_at, v_active_sess.expires_at, 'authorized'
        )
        RETURNING id INTO v_sess_id;

        RETURN QUERY SELECT true, false, v_sess_id, v_rem, v_active_sess.expires_at;
        RETURN;
      END IF;
    END IF;

    -- Guard 2: unexpired previous-day free_quotas record (e.g. overnight 23:50 -> 00:20 after logout)
    SELECT fq.* INTO v_fq
    FROM public.free_quotas fq
    WHERE fq.mac_address = v_mac
      AND fq.quota_date < v_baghdad_date
      AND fq.started_at <= v_now
      AND fq.expires_at > v_now
    ORDER BY fq.expires_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_fq.expires_at - v_now)))::INTEGER);
      IF v_rem > 0 THEN
        UPDATE public.sessions s
        SET status = 'disconnected'
        WHERE s.mac_address = v_mac AND s.status IN ('authorized', 'active');

        INSERT INTO public.sessions (
          session_type, user_id, mac_address, ip_address, started_at, expires_at, status
        ) VALUES (
          'free', NULL, v_mac, v_ip, v_fq.started_at, v_fq.expires_at, 'authorized'
        )
        RETURNING id INTO v_sess_id;

        RETURN QUERY SELECT true, false, v_sess_id, v_rem, v_fq.expires_at;
        RETURN;
      END IF;
    END IF;

    -- Standard daily Baghdad calendar quota (1 per calendar day in Asia/Baghdad)
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

-- 5. Update authorize_user_login to support unlimited accounts (expires_at = NULL)
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

  IF v_user.is_unlimited THEN
    UPDATE public.users u
    SET started_at = COALESCE(u.started_at, v_now),
        expires_at = NULL
    WHERE u.id = v_user.id
    RETURNING * INTO v_user;

    UPDATE public.sessions s
    SET status = 'disconnected',
        revoked_at = CASE WHEN s.mac_address <> v_mac THEN COALESCE(s.revoked_at, v_now) ELSE s.revoked_at END
    WHERE (s.mac_address = v_mac OR s.user_id = p_user_id)
      AND s.status IN ('authorized', 'active');

    INSERT INTO public.sessions (
      session_type, user_id, mac_address, ip_address, started_at, expires_at, status
    ) VALUES (
      'user', p_user_id, v_mac, v_ip, v_user.started_at, NULL, 'authorized'
    )
    RETURNING id INTO v_sess_id;

    RETURN QUERY SELECT true, v_sess_id, NULL::INTEGER, v_user.started_at, NULL::TIMESTAMPTZ;
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
  SET status = 'disconnected',
      revoked_at = CASE WHEN s.mac_address <> v_mac THEN COALESCE(s.revoked_at, v_now) ELSE s.revoked_at END
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

-- 6. Update verify_mac_authorization to return NULL remaining_seconds & 'unlimited' for unlimited users
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

  IF v_sess.session_type = 'user' THEN
    IF v_sess.user_id IS NULL THEN
      UPDATE public.sessions s
      SET status = 'disconnected',
          revoked_at = COALESCE(s.revoked_at, v_now)
      WHERE s.id = v_sess.id;
      RETURN QUERY SELECT false, 0, NULL::TEXT;
      RETURN;
    END IF;

    SELECT * INTO v_user FROM public.users u WHERE u.id = v_sess.user_id;
    IF NOT FOUND OR v_user.is_disabled THEN
      UPDATE public.sessions s
      SET status = 'disconnected',
          revoked_at = COALESCE(s.revoked_at, v_now)
      WHERE s.id = v_sess.id;
      RETURN QUERY SELECT false, 0, NULL::TEXT;
      RETURN;
    END IF;

    IF v_user.is_unlimited THEN
      UPDATE public.sessions
      SET status = 'active',
          expires_at = NULL,
          ip_address = COALESCE(NULLIF(TRIM(COALESCE(p_ip, '')), ''), ip_address)
      WHERE id = v_sess.id;

      RETURN QUERY SELECT true, NULL::INTEGER, 'unlimited'::TEXT;
      RETURN;
    END IF;

    IF v_user.expires_at IS NULL THEN
      UPDATE public.sessions s
      SET status = 'disconnected',
          revoked_at = COALESCE(s.revoked_at, v_now)
      WHERE s.id = v_sess.id;
      RETURN QUERY SELECT false, 0, NULL::TEXT;
      RETURN;
    END IF;

    v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_user.expires_at - v_now)))::INTEGER);
  ELSE
    IF v_sess.expires_at IS NULL THEN
      UPDATE public.sessions s
      SET status = 'disconnected',
          revoked_at = COALESCE(s.revoked_at, v_now)
      WHERE s.id = v_sess.id;
      RETURN QUERY SELECT false, 0, NULL::TEXT;
      RETURN;
    END IF;
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

-- 7. Update get_revoked_sessions to safely skip unlimited sessions (expires_at IS NULL) and catch deleted users
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
    AND s.expires_at IS NOT NULL
    AND s.expires_at <= v_now;

  UPDATE public.sessions s
  SET status = 'disconnected',
      revoked_at = COALESCE(s.revoked_at, v_now)
  WHERE s.session_type = 'user'
    AND s.status IN ('authorized', 'active')
    AND (
      s.user_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = s.user_id AND u.is_disabled = true
      )
    );

  RETURN QUERY
  SELECT s.id, s.mac_address, s.ip_address
  FROM public.sessions s
  WHERE s.status IN ('expired', 'disconnected')
    AND s.revoked_at IS NOT NULL
    AND s.revocation_ack_at IS NULL
  ORDER BY s.revoked_at ASC;
END;
$$;

-- 8. Database Cleanup RPCs (site_owner enforced at Edge Function layer; service_role ONLY in DB)
-- Policy (Option B): delete ONLY past Asia/Baghdad day already-expired free_quotas
-- and already-ended sessions (preserving today's Baghdad free_quotas, active sessions, users, admins, and pending revocations).
CREATE OR REPLACE FUNCTION public.get_cleanup_summary(
  p_now TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  past_free_quotas_count BIGINT,
  today_free_quotas_preserved BIGINT,
  ended_sessions_count BIGINT,
  active_sessions_preserved BIGINT,
  users_preserved BIGINT,
  admins_preserved BIGINT,
  baghdad_today DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_now, clock_timestamp());
  v_today DATE := (v_now AT TIME ZONE 'Asia/Baghdad')::date;
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.free_quotas fq WHERE fq.quota_date < v_today AND fq.expires_at <= v_now),
    (SELECT COUNT(*) FROM public.free_quotas fq WHERE fq.quota_date >= v_today OR fq.expires_at > v_now),
    (SELECT COUNT(*) FROM public.sessions s WHERE s.status IN ('expired', 'disconnected') AND (s.revoked_at IS NULL OR s.revocation_ack_at IS NOT NULL)),
    (SELECT COUNT(*) FROM public.sessions s WHERE NOT (s.status IN ('expired', 'disconnected') AND (s.revoked_at IS NULL OR s.revocation_ack_at IS NOT NULL))),
    (SELECT COUNT(*) FROM public.users),
    (SELECT COUNT(*) FROM public.admins),
    v_today;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_operational_data(
  p_now TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  deleted_free_quotas BIGINT,
  deleted_sessions BIGINT,
  preserved_today_free_quotas BIGINT,
  preserved_active_sessions BIGINT,
  preserved_users BIGINT,
  preserved_admins BIGINT,
  baghdad_today DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_now, clock_timestamp());
  v_today DATE := (v_now AT TIME ZONE 'Asia/Baghdad')::date;
  v_del_fq BIGINT := 0;
  v_del_sess BIGINT := 0;
BEGIN
  UPDATE public.sessions s
  SET status = 'expired',
      revoked_at = COALESCE(s.revoked_at, v_now)
  WHERE s.status IN ('authorized', 'active')
    AND s.expires_at IS NOT NULL
    AND s.expires_at <= v_now;

  WITH del_fq AS (
    DELETE FROM public.free_quotas fq
    WHERE fq.quota_date < v_today
      AND fq.expires_at <= v_now
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_del_fq FROM del_fq;

  WITH del_s AS (
    DELETE FROM public.sessions s
    WHERE s.status IN ('expired', 'disconnected')
      AND (s.revoked_at IS NULL OR s.revocation_ack_at IS NOT NULL)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_del_sess FROM del_s;

  RETURN QUERY
  SELECT
    v_del_fq,
    v_del_sess,
    (SELECT COUNT(*) FROM public.free_quotas),
    (SELECT COUNT(*) FROM public.sessions),
    (SELECT COUNT(*) FROM public.users),
    (SELECT COUNT(*) FROM public.admins),
    v_today;
END;
$$;

REVOKE ALL ON FUNCTION public.get_cleanup_summary(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cleanup_summary(TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_operational_data(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_operational_data(TIMESTAMPTZ) TO service_role;
