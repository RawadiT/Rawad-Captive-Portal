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

## Phase 2 Edge Functions Deployment & Live HTTP Verification — 2026-11-19
- Added signed domain-separated `portal_status` tokens in `supabase/functions/_shared/crypto.ts`.
- Extended `supabase/functions/admin-api/index.ts` for unlimited accounts (`is_unlimited`), `GET/PUT /portal-settings` (`site_owner` & `general`, rejecting `javascript:`/`data:` schemes and invalid phones), and `GET /cleanup/summary` + `POST /cleanup/execute` (strictly `site_owner` ONLY, returning HTTP `403` to `general` and `subordinate`).
- Extended `supabase/functions/portal-auth/index.ts` (`GET`/`POST portal_settings`, `session_status` authenticated with HMAC `status_token`, and unlimited user login responses) and `supabase/functions/verify-mac/index.ts` (`ALLOW:UNLIMITED`).
- Deployed all 3 functions to `Rawad Test` (`efqsmehqnhuzohzjztni`) and passed live HTTP tests across role guards, `portal_settings` round-trip, unlimited account login/status/disable revocation, with temporary test accounts cleaned up afterwards.

## Phase 3 Unified Light Daytime Admin Dashboard — 2026-11-19
- Bundled self-contained `admin/assets/logo.png` and `admin/assets/fonts/cairo-{arabic,latin}.woff2` (zero external CDNs).
- Redesigned `admin/index.html`, `admin/style.css`, and `admin/admin.js` in the unified light daytime Captive Portal aesthetic with `Powered BY Hashim Hasanen` footer, unlimited account toggle (`is_unlimited`), `Portal Settings` with live safe preview, and `site_owner`-only `Database Cleanup` panel.
- Verified in Chromium (`chrome-devtools-mcp`) across Desktop (`1440x900`), Tablet (`820x1180`), and Mobile (`390x844`): 0 console errors, all local assets HTTP 200, Cairo RTL active, zero horizontal overflow, live preview & cleanup summary verified, temporary `__tmp_ui_owner` removed afterwards.

## Phase 4 CHR Lab Integration & Unified Customer Portal — 2026-11-19
- Updated `routeros/deploy.rsc` (`on-login` handles `ALLOW:UNLIMITED` without `timeout=` and `ALLOW:<seconds>` with `timeout=`; all 4 strict HTTP 200 fetch checks intact).
- Exported pre-change CHR config backup (`scratch/chr-backup-before-phase4.rsc`), set generated 32-byte hex `ROUTER_SHARED_SECRET` on `Rawad Test`, verified CHR native HTTPS fetch (`code=200`), and applied CHR lab `rawad-verified-prof`, `rawad-sync-revocations` (15s), `hsprof1` (`http-chap,http-pap`), and fail-closed `rawad-lab-block-unverified` rule.
- Updated `hotspot/login.html`, `hotspot/status.html`, `hotspot/assets/portal.js`, and `hotspot/assets/style.css` (removed `<meta http-equiv="refresh">`, added `portal_settings` live branding, `status_token` sessionStorage + `session_status` polling, unlimited status display `الإنترنت متاح دون حد زمني`, validated social/`tel:` channels, and `Powered BY Hashim Hasanen`), uploaded via SCP to `Rawad-CHR-Lab`.
- Executed live E2E verification on `RAWAD-WIN10-CLIENT` (`192.168.88.250`, MAC `08:00:27:44:DC:6B`): verified limited account `timeout=59m54s` and `F5` timer continuity, social/phone rendering, unlimited account (`dynamic=no`, no `timeout=`) + `غير محدود` UI, and automatic CHR disconnect + `revocation_ack_at` acknowledgment after account disable; cleaned temporary test users/sessions and restored default `portal_settings`.

## Phase 5 Isolated Static Admin Container (CHR x86_64 Lab) & Backup Docs — 2026-11-19
- Installed `container-7.25.1.npk` on `Rawad-CHR-Lab` (`x86_64`), enabled `device-mode container=yes` with cold VirtualBox power-cycle, and verified `container: yes`.
- Configured `bridge-admin`/`veth-admin` (`172.18.0.2/24`), uploaded self-contained `admin/` to `/admin-www` mounted `mode=ro,noexec`, configured `memory-high=32.0MiB`, pulled `library/busybox:musl` running `httpd -f -p 8080 -h /www`, and verified staff HTTP `200` on all 6 assets with 0 console errors.
- Verified HotSpot firewall isolation: `rawad-admin-block-guests` (`chain=forward in-interface=bridge dst-address=172.18.0.0/24 action=drop`) blocked authenticated guest traffic from `RAWAD-WIN10-CLIENT` (`9 packets / 468 bytes` dropped).
- Recorded real lab metrics (pre `67.8MiB` HDD / `282.3MiB` free RAM -> post `64.8MiB` HDD / `274.9MiB` free RAM, container RAM `360–460KiB`, CPU `0%`, `write-sect-since-reboot=7696`) and documented in `DEPLOYMENT.md` alongside the official PG 17 3-file manual backup/restore guide and explicit warning that `RB4011 (ARM32/ARMv5)` container hosting remains unverified and not approved for production.
