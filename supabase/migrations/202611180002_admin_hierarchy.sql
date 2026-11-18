-- Role hierarchy for Rawad admin accounts.
-- site_owner: the immutable primary account; general: full operational access;
-- subordinate: internet-account creation, listing, disable and delete only.
ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'subordinate';

UPDATE public.admins
SET role = CASE
  WHEN id = '39c0a9e8-028d-4c04-a0e3-e46e21cef7d9'::uuid THEN 'site_owner'
  ELSE COALESCE(NULLIF(role, ''), 'subordinate')
END;

UPDATE public.admins
SET is_super_admin = true
WHERE id = '39c0a9e8-028d-4c04-a0e3-e46e21cef7d9'::uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.admins'::regclass
      AND conname = 'admins_role_check'
  ) THEN
    ALTER TABLE public.admins
      ADD CONSTRAINT admins_role_check
      CHECK (role IN ('site_owner', 'general', 'subordinate'));
  END IF;
END $$;

-- The site-owner identity cannot be demoted by the application role-management API.
-- Direct table access remains restricted to service_role as established previously.
