# TASKS.md — Rawad Captive Portal (MikroTik HotSpot + Supabase Edge Functions)

**Branch:** `field-test-preparation` (NEVER merge to `main` without explicit approval)

## Phase 1 — Inspection & Architecture Alignment
- [x] Inspect current repository and remove obsolete always-on Backend, Next.js/Vercel, Docker, Nginx, and USB bundle files.
- [x] Confirm target architecture: MikroTik HotSpot UI (`hotspot/`) + Supabase PostgreSQL & Edge Functions (`supabase/functions/`) + Static Admin UI (`admin/`).

## Phase 2 — Supabase Schema & Edge Functions
- [x] Implement `supabase/schema.sql` with 30-min daily free quota per MAC (`Asia/Baghdad` midnight reset, UTC storage) and real-time user accounts (duration starts on first login).
- [x] Implement Edge Functions: `portal-auth`, `verify-mac`, and `admin-api` (+ `_shared/crypto.ts`).

## Phase 3 — Captive Portal UI (`hotspot/`) & Static Admin UI (`admin/`)
- [x] Implement `hotspot/login.html`, `status.html`, `logout.html`, `error.html`, `assets/portal.js`, `assets/style.css` (2 options only, zero external CDNs, no localStorage passwords).
- [x] Implement `admin/index.html`, `admin/admin.js`, `admin/style.css` (8 required admin functions).

## Phase 4 — RouterOS v7 (`routeros/`)
- [x] Update `routeros/deploy.rsc`, `rollback.rsc`, `verify.rsc` for `ether10`-only HotSpot + `rawad-verified` address-list + `on-login`/`on-logout` `verify-mac` integration.

## Phase 5 — Verification, Cleanup & GitHub Sync
- [x] Run `tests/verify_system.mjs` against real PostgreSQL 16 (passed `POSTGRESQL 16 SCHEMA & EDGE-FUNCTION RPC TESTS PASSED` & `ALL SYSTEM VERIFICATIONS PASSED`).
- [x] Clean up obsolete directories (`backend/`, `frontend/`, `deployment/`, `usb-package/`) and temporary test files.
- [x] Re-run `tests/verify_system.mjs` after cleanup, add `.github/workflows/system-test.yml`, commit & push to `field-test-preparation`.
