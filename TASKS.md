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
