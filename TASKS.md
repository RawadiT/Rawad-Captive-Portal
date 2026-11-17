# TASKS.md — Rawad Captive Portal (MikroTik HotSpot + Supabase Edge Functions)

**Branch:** `field-test-preparation` (NEVER merge to `main` without explicit approval)

## Completed
- [x] Fix `public.get_revoked_sessions()` to detect ALL disabled/expired sessions regardless of `created_at` age.
- [x] Add `revoked_at` + `revocation_ack_at` + `ack_revoked_sessions(UUID[])` and batched (10-ID) ACK verification in `routeros/deploy.rsc`.
- [x] Backdate `created_at` to `t0` in `tests/verify_system.mjs` and assert genuine >=2h and >=4h age + `expires_at < p_now` + `revoked_at`/`revocation_ack_at` preservation across `schema.sql` re-apply.
- [ ] Live MikroTik RB4011 (`ether10`) + Live Supabase Edge Function integration test (requires isolated lab router + test Supabase project).
