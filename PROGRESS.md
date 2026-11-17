# PROGRESS.md — Rawad Captive Portal

**Branch:** `field-test-preparation`  
**Status:** Genuine Old-Session Tests & Batched Router ACK Complete; Verified in GitHub Actions PG 16

## Changes Completed
- **`tests/verify_system.mjs`:** Explicitly backdated `created_at` to `t0` for `sessLong` and `sessExp`, asserted `>= 7200s` (+2h) and `>= 14400s` (+4h) age + `expires_at < p_now`, verified `revoked_at` and `revocation_ack_at` preservation on `schema.sql` re-apply, and added regression check against `s.created_at` lookback.
- **`routeros/deploy.rsc`:** Batched `action=ack` requests (max 10 IDs per `/tool fetch` for safe URL length) and verified `status = "finished"` + `"ACK:"` prefix.

## Not Tested Locally
- Live MikroTik RB4011 (`ether10`) & Live Supabase Deno Edge Function deployment (`NOT RUN`).
