# TASKS.md — Rawad Captive Portal (MikroTik HotSpot + Supabase Edge Functions)

**Branch:** `field-test-preparation` (NEVER merge to `main` without explicit approval)

## Completed
- [x] Require strict numeric HTTP `code = 200` (reject missing `code` / `"nothing"` / `null` / non-200) across all 4 `/tool fetch` paths in `routeros/deploy.rsc` (on-login, revocation feed, full ACK batch, final partial ACK batch).
- [x] Update `parseAck()` and RouterOS 4-path HTTP-200 checks in `tests/verify_system.mjs` (rejecting missing `code`, `code: null`, `401`, `500`, `status: 'failed'`, `ACK:0`, `ACK:`, `ACK:1abc`, and out-of-range counts).
- [ ] Live MikroTik RB4011 (`ether10`) + Live Supabase Edge Function integration test (not performed — required before claiming live MikroTik compatibility).


## Admin dashboard hierarchy and visual refresh (2026-11-18)
- [x] Add immutable site-owner, general-manager and subordinate roles in the test migration.
- [x] Allow all authenticated roles to list internet accounts; allow all roles to create, disable and permanently delete internet accounts.
- [x] Restrict internet-account editing and free-quota viewing to site owner/general manager.
- [x] Restrict administrator creation, editing, role assignment and deletion to the site owner.
- [x] Add manager role selection and role labels to the dashboard.
- [x] Add company logo and motion/interaction styling.
- [ ] Apply `202611180002_admin_hierarchy.sql` to Rawad Test and run role-based API/UI regression tests.
- [ ] Verify subordinate/general manager cannot access administrator-management endpoints and site owner cannot be modified/deleted.


## Isolated CHR + Rawad Test end-to-end integration (2026-11-18)

- [ ] Confirm Rawad Test Supabase project URL, anon key, deployment access, and current migration state locally (never commit secrets).
- [ ] Add an explicit lab-only RouterOS integration path for the existing CHR bridge / 192.168.88.0/24 environment; do not reuse the production ether10 deployment script.
- [ ] Connect admin account create/update/disable/delete operations to the actual MikroTik User Manager/RADIUS source of truth, with verified success/failure semantics.
- [ ] Define and implement the account model consistently across Supabase and User Manager: username, password, validity from first successful login, per-user upload/download limits, and half-hour preset defaults.
- [ ] Ensure delete/disable revokes active sessions and removes or disables the corresponding RouterOS/User Manager identity; verify by querying CHR after each action.
- [ ] Deploy and configure the admin-api, portal-auth, and verify-mac Edge Functions against Rawad Test only.
- [ ] Upload the hotspot/ files to the CHR HotSpot HTML directory and test login, free access, error, status, and logout flows from RAWAD-WIN10-CLIENT.
- [ ] Configure admin/index.html with the Rawad Test URL and anon key locally; never expose service-role or router shared secrets in browser code.
- [ ] Run API/UI regression tests and live create/edit/disable/delete/expiry/speed tests against CHR; record actual router-side evidence.
- [ ] Update FIELD_TEST.md and PROGRESS.md with commands, observed results, and remaining limitations.
- [ ] Keep all lab work isolated; do not run routeros/deploy.rsc on the company RB4011 and do not merge to main without explicit approval.

## Phase 1–5 Restoration & Enhancements (2026-11-19)
- [x] Step 0: Acquire PG 17.9 portable (`scratch/pg17/`), capture verified 3-file backup of `Rawad Test` (`efqsmehqnhuzohzjztni`), and verify full roles/schema/data restore into ephemeral local PG 17 (`127.0.0.1:55432`).
- [x] Phase 1: Create & verify `202611190001_portal_settings_and_unlimited.sql`, external rollback `supabase/rollbacks/202611190001_portal_settings_and_unlimited.down.sql`, and synced `supabase/schema.sql` (`portal_settings`, `users.is_unlimited`, nullable `sessions.expires_at`, overnight free-session guard, Option B Baghdad cleanup RPCs); apply and verify on `Rawad Test`.
- [x] Phase 2: Edge Functions (`_shared/crypto.ts`, `admin-api`, `portal-auth`, `verify-mac`) + live deployment & HTTP verification on `Rawad Test`.
- [ ] Phase 3: Unified Light Daytime Admin Dashboard (`admin/`) + browser verification.
- [ ] Phase 4: Lab `ROUTER_SHARED_SECRET` + CHR `on-login`/`revocations` + unified Customer Portal (`hotspot/`) + live `RAWAD-WIN10-CLIENT` E2E test.
- [ ] Phase 5: Isolated static admin container on `Rawad-CHR-Lab` (`x86_64` ONLY) + backup documentation + final PG 17 regression & Git sync.
