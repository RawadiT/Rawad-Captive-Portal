# PROGRESS.md — Rawad Captive Portal

**Branch:** `field-test-preparation`  
**Status:** Complete Locally & Verified in CI (Live Supabase & Real MikroTik Lab Test Pending)

## Completed Implementation
- **Supabase (`supabase/schema.sql`, `supabase/functions/`):**
  - Daily 30-min free quota per MAC in `Asia/Baghdad` (`PRIMARY KEY (mac_address, quota_date)`), UTC timestamps, and `pg_advisory_xact_lock`.
  - User accounts with duration starting on first login (`authorize_user_login`), plus `verify_mac_authorization` and `disconnect_mac_session`.
  - Edge Functions: `portal-auth`, `verify-mac` (`x-router-secret` header), `admin-api` (HMAC JWT admin auth + CRUD + enable/disable).
- **MikroTik HotSpot UI (`hotspot/`):** Self-contained `login.html`, `status.html`, `logout.html`, `error.html`, `assets/portal.js`, `assets/style.css` (2 options only, zero external CDNs, no `localStorage` passwords).
- **Static Admin UI (`admin/`):** `index.html`, `admin.js`, `style.css` (zero Vercel/VPS/Backend).
- **RouterOS (`routeros/`):** `deploy.rsc`, `rollback.rsc`, `verify.rsc` (`ether10` only, `rawad-verified` address-list, `on-login` `/tool fetch` to `verify-mac`, Fail-Closed).
- **Cleanup:** Removed obsolete `backend/`, `frontend/`, `deployment/`, `usb-package/`, and legacy test files.

## Verification Results
- `node tests/verify_system.mjs` against Docker PostgreSQL 16: `POSTGRESQL 16 SCHEMA & EDGE-FUNCTION RPC TESTS PASSED` and `ALL SYSTEM VERIFICATIONS PASSED` (`exit code 0`).
- Post-cleanup `node tests/verify_system.mjs` (static checks): `ALL SYSTEM VERIFICATIONS PASSED` (`exit code 0`).
- **Not Executed:** Live Supabase project & physical MikroTik RB4011 device tests (`NOT RUN` — ready for isolated lab test).
