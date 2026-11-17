# PROGRESS.md — Rawad Captive Portal

**Branch:** `field-test-preparation`  
**Status:** Schema Migration & Revocation Sync Hardened; Ready for Lab MikroTik + Test Supabase Verification

## Changes Completed in This Pass
- **`supabase/schema.sql`:** Removed `DROP TABLE ... CASCADE`; added idempotent `ALTER TABLE` / constraint migration preserving existing `users`, `free_quotas`, and `sessions`; added `get_revoked_sessions(INTEGER)`.
- **`supabase/functions/verify-mac/index.ts` & `portal-auth/index.ts`:** Added `?action=revoked` endpoint for router revocation sync and sanitized error messages in `portal-auth`.
- **`routeros/deploy.rsc` & `rollback.rsc`:** Added 30s `rawad-sync-revocations` scheduler (`ether10` / `rawad-verified` cleanup) with exact `.id` tracking in `rollback.rsc`.
- **`tests/verify_system.mjs`:** Added idempotent schema re-apply test (verifies data & consumed quota preserved) and disabled-user `get_revoked_sessions` test.
- **`DEPLOYMENT.md`:** Documented first-admin creation, 30s NAT revocation sync bound, and MAC verification model.

## Not Tested Locally
- Actual RouterOS execution (`deploy.rsc`, `rollback.rsc`, `on-login` `/tool fetch`, `rawad-sync-revocations`) on a physical MikroTik RB4011.
- Live Deno Edge Function deployment on Supabase.
