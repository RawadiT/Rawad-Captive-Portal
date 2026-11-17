# TASKS.md — Rawad Captive Portal (MikroTik HotSpot + Supabase Edge Functions)

**Branch:** `field-test-preparation` (NEVER merge to `main` without explicit approval)

## Completed
- [x] Replace destructive `DROP TABLE ... CASCADE` in `supabase/schema.sql` with safe idempotent migrations preserving `users`, `free_quotas`, and `sessions`.
- [x] Add `get_revoked_sessions(INTEGER)` RPC, `verify-mac?action=revoked`, and 30s `rawad-sync-revocations` scheduler in `deploy.rsc` / `rollback.rsc` so disabled/expired active users are removed from `rawad-verified` behind NAT.
- [x] Sanitize DB error messages in `portal-auth/index.ts`.
- [x] Expand `tests/verify_system.mjs` to verify idempotent `schema.sql` re-apply, `get_revoked_sessions`, `verify_mac_authorization`, and static/security invariants.
- [x] Document first-admin creation, 30s revocation sync bound, and MAC verification boundary in `DEPLOYMENT.md`.
- [ ] Live MikroTik RB4011 (`ether10`) + Live Supabase Edge Function integration test (requires isolated lab router + test Supabase project).
