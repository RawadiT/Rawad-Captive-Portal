# TASKS.md — Safe Field-Test Package Preparation

**Branch:** `field-test-preparation`  
**Baseline Commit:** `e6bac87430d1769864ba5e055d01b9ffe0445f17`

- [x] **FT1** Add isolated `FIELD_TEST_MODE` & `MIKROTIK_MODE=mock` support (`backend/config/env.ts`, `backend/mikrotik/mockAdapter.ts`, `backend/api/server.ts`) with fail-closed rejection of production Supabase URLs (`*.supabase.co`), real MikroTik hosts, and `NODE_ENV=production`.
- [x] **FT2** Create `deployment/.env.field-test.example` (test-only placeholders, zero real secrets) and harden `deployment/build-usb-package.ps1` to strip any `.env` or private TLS certificates/keys (`*.key`, `*.pem`, `*.crt`, `*.p12`).
- [x] **FT3** Add `tests/verify_field_test.mjs` covering API health check, `MockMikroTikAdapter`, 30m free quota & duplicate MAC blocking, Username/Password first-login duration & `bindMac=false`, session expiry/revocation, DB fail-closed, and production-URL isolation.
- [x] **FT4** Document isolated test procedures, boundaries, and Local Isolated vs MikroTik Lab vs Production Deployment differences in `FIELD_TEST.md`.
- [x] **FT5** Run Backend/Frontend builds, `tests/verify_field_test.mjs`, USB package build & smoke test, update `PROGRESS.md`, and commit on `field-test-preparation` (no merge to `main`, no deployment).
