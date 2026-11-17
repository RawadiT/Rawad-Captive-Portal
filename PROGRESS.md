# PROGRESS.md — Safe Field-Test Package Preparation

**Branch:** `field-test-preparation`  
**Baseline Commit:** `e6bac87430d1769864ba5e055d01b9ffe0445f17`  
**Status:** Isolated Field-Test Package Ready (Live Supabase & Real MikroTik NOT RUN — Not Deployed)

- **FT1:** Implemented `MockMikroTikAdapter` (`backend/mikrotik/mockAdapter.ts`), `validateFieldTestIsolation()` (`backend/config/env.ts`), and `MIKROTIK_MODE=mock` wiring (`backend/api/server.ts`).
- **FT2:** Added `deployment/.env.field-test.example` and hardened `deployment/build-usb-package.ps1` against accidental inclusion of `.env` files or private TLS keys/certs.
- **FT3:** Created `tests/verify_field_test.mjs` covering all isolated Local Field-Test scenarios (health check, mock MikroTik, 30m free quota, duplicate MAC 409/403, Username/Password first-login start & no MAC binding, expiry/revocation, DB fail-closed, and production isolation guards).
- **FT4:** Created `FIELD_TEST.md` detailing Local Isolated Test, MikroTik Lab Test, and Production Deployment differences, execution steps, stop procedure, and test boundaries.
- **Remaining / Not Executed Locally:**
  - Live PostgreSQL 2-connection test (`tests/verify_fencing_race.mjs`) is `SKIPPED` locally when `TEST_DATABASE_URL` is unset (verified 8/8 in GitHub Actions `postgres:16` run `44128557227`).
  - Live Supabase & Real MikroTik RouterOS tests are `NOT RUN` per mandatory safety constraints.
