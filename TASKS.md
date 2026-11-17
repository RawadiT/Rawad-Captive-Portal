# TASKS.md — Rawad Captive Portal (MikroTik HotSpot + Supabase Edge Functions)

**Branch:** `field-test-preparation` (NEVER merge to `main` without explicit approval)

## Completed
- [x] Fix `public.get_revoked_sessions()` to detect ALL disabled/expired sessions regardless of `created_at` age.
- [x] Add `revoked_at` + `revocation_ack_at` + `ack_revoked_sessions(UUID[])` so revocations are never lost when router is temporarily unreachable and never returned repeatedly once acknowledged.
- [x] Update `admin-api` (`revoked_at`), `verify-mac` (`?action=revoked` & `?action=ack`), and `routeros/deploy.rsc` (`rawad-sync-revocations`).
- [x] Expand `tests/verify_system.mjs` with +2h disabled session test, +4h expired session test, failed-ack retry test, post-ack suppression test, and `sessions` preservation on `schema.sql` re-apply.
- [ ] Live MikroTik RB4011 (`ether10`) + Live Supabase Edge Function integration test (requires isolated lab router + test Supabase project).
