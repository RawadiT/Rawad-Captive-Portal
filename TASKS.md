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
