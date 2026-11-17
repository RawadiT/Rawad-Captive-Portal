# TASKS.md — Rawad Captive Portal (MikroTik HotSpot + Supabase Edge Functions)

**Branch:** `field-test-preparation` (NEVER merge to `main` without explicit approval)

## Completed
- [x] Set `revoked_at = COALESCE(s.revoked_at, v_now)` on disabled-user and expired-session transitions in `public.verify_mac_authorization()` (`supabase/schema.sql`), while preserving intentional reconnects.
- [x] Harden `verify-mac?action=ack` to reject invalid/empty UUIDs (`400 ERR:invalid_ids`) and `admin-api` disable to report `500` on session-update failure while preserving `get_revoked_sessions()` fallback.
- [x] Harden `rawad-sync-revocations` in `routeros/deploy.rsc` to validate UUID/MAC/IP per row, clean `rawad-verified` + `/ip hotspot active` first, batch ACKs (max 10 IDs), and validate numeric `ACK:<1..batchCount>` responses.
- [x] Add Test A (+2h disabled) and Test B (+4h expired) calling `verify_mac_authorization()` BEFORE `get_revoked_sessions()`, plus ACK/malformed-row checks in `tests/verify_system.mjs`.
- [ ] Live MikroTik RB4011 (`ether10`) + Live Supabase Edge Function integration test (not performed — required before production approval).
