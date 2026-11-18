-- Rawad Captive Portal: administrator roles and secure account management
-- Apply only to the dedicated Rawad Test Supabase project first.

ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- Preserve the existing primary owner account as the immutable super administrator.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admins
    WHERE id = '39c0a9e8-028d-4c04-a0e3-e46e21cef7d9'::uuid
  ) THEN
    RAISE EXCEPTION 'Primary administrator account was not found; migration stopped to prevent lockout.';
  END IF;

  UPDATE public.admins
  SET is_super_admin = true
  WHERE id = '39c0a9e8-028d-4c04-a0e3-e46e21cef7d9'::uuid;
END $$;

-- No browser role can read or mutate admin rows directly. Edge Function service role only.
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admins FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admins TO service_role;
