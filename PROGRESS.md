# PROGRESS.md — Rawad Captive Portal

**Branch:** `field-test-preparation`  
**Status:** Revocation Acknowledgement & Age-Independent Detection Complete; Verified in GitHub Actions PG 16

## Changes Completed
- **`supabase/schema.sql`:** Added `revoked_at` & `revocation_ack_at` to `sessions`, updated `get_revoked_sessions(TIMESTAMPTZ)` to detect all disabled/expired sessions regardless of `created_at`, and added `ack_revoked_sessions(UUID[])`.
- **`supabase/functions/verify-mac/index.ts` & `admin-api/index.ts`:** Added `ID|MAC|IP` revocation feed (`?action=revoked`), acknowledgement endpoint (`?action=ack&ids=...`), and `revoked_at` on user disable.
- **`routeros/deploy.rsc`:** Updated `rawad-sync-revocations` to remove `rawad-verified` + `/ip hotspot active` first and only then send `action=ack`.
- **`tests/verify_system.mjs`:** Added +2h disable, +4h expiry, unacknowledged retry, post-ack suppression, and `sessions` preservation on `schema.sql` re-apply tests.

## Not Tested Locally
- Live MikroTik RB4011 (`ether10`) & Live Supabase Deno Edge Function deployment (`NOT RUN`).
