# PROGRESS.md — Rawad Captive Portal

**Branch:** `field-test-preparation`  
**Status:** Strict HTTP 200 Fetch Validation Complete; Verified in GitHub Actions PG 16

## Changes Completed
- **`routeros/deploy.rsc`:** Replaced `[:typeof (...->"code")] = "nothing" || ...` with strict `[:typeof [:tonum (...->"code")]] = "num" && [:tonum (...->"code")] = 200` on all 4 `/tool fetch` paths.
- **`tests/verify_system.mjs`:** Updated `parseAck()` to reject missing `code`, `code: null`, non-200 HTTP codes, `status != 'finished'`, and malformed/out-of-range ACK counts, and verified all 4 fetch paths in `deploy.rsc`.

## Not Tested Locally
- Live MikroTik RB4011 (`ether10`) & Live Supabase Deno Edge Function deployment (`NOT PERFORMED`).


## Admin Dashboard Update — 2026-11-18
- Added a three-tier role model: immutable `site_owner`, `general`, and `subordinate`.
- The site owner alone can create, edit, promote/demote, and delete subordinate/general manager accounts. The fixed site-owner account ID is protected by the API.
- All admin roles can list, create, disable, and permanently delete internet accounts. Only site owner/general managers can edit internet-account details and view free-quota records.
- Added manager role selection to the UI, role-aware navigation/actions, the existing company logo, ambient background motion, button transitions, and success/error feedback.
- Backend migration and end-to-end role regression tests are pending application to the Rawad Test project. No production deployment or MikroTik changes performed.


## Isolated CHR + Rawad Test integration — 2026-11-18

- Confirmed the user has an existing Rawad Test Supabase project available.
- Reviewed the current admin API, schema, portal files, and RouterOS deployment scripts on `field-test-preparation`.
- Identified a functional gap: current admin API writes internet accounts to Supabase tables and revokes database sessions, but does not itself create/update/delete the corresponding MikroTik User Manager users. A database delete therefore cannot yet be treated as a verified router-side delete.
- The existing `routeros/deploy.rsc` is scoped to production `ether10` / `192.168.20.0/24`; it is not suitable for the isolated CHR lab (`bridge` / `192.168.88.0/24`) and must not be executed there unchanged.
- No Supabase deployment, RouterOS configuration change, file upload to CHR, or production change has been performed in this step.
- Next: configure and deploy against Rawad Test using local environment credentials, then implement and verify the CHR-specific integration before declaring CRUD operations complete.

## Phase 1 Database Migration & Verification — 2026-11-19
- Downloaded PostgreSQL 17.9 Windows x64 portable binaries into `scratch/pg17/` (no Windows install/service/system PATH modification; local PG 16 untouched).
- Captured official 3-file PG 17 backup (`backup_roles.sql`, `backup_schema.sql`, `backup_data.sql` + `backup_schema_full.sql`) from `Rawad Test` (`efqsmehqnhuzohzjztni`, PG 17.12) via Session Pooler + `pgpass.conf`, and verified restore (`admins=2`, `users=1`, `free_quotas=2`, `sessions=10`) into ephemeral local PG 17 (`127.0.0.1:55432`, documenting `SET (pg_attver=...)` and cluster-role notes for vanilla PG 17).
- Added `supabase/migrations/202611190001_portal_settings_and_unlimited.sql`, external `supabase/rollbacks/202611190001_portal_settings_and_unlimited.down.sql`, and synced `supabase/schema.sql`.
- Verified migration UP -> rollback DOWN (`true|0|NO`) -> re-UP -> `tests/verify_system.mjs` (`POSTGRESQL 17 SCHEMA & EDGE-FUNCTION RPC TESTS PASSED`) on local PG 17.
- Applied migration to `Rawad Test` (`efqsmehqnhuzohzjztni`) and verified `admins` (`hashim`, `testo`), existing `users` (`1`), `portal_settings` UTF-8 Arabic default row, and `get_cleanup_summary()` read-only output.
