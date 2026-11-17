# TASKS.md — Harden Field-Test Isolation Before Approval

**Branch:** `field-test-preparation`  
**Baseline Commit:** `9db717cc99130f71e988dc12c1daa825b9a2ffc8`

- [x] **H1** Enforce loopback-only `HOST` (`127.0.0.1` or `localhost`) and loopback origins in `validateFieldTestIsolation()` (`backend/config/env.ts`).
- [x] **H2** Enforce `RAWAD_FIELD_TEST_PACKAGE_LOCK=true` in `backend/api/server.ts`, add `field-test-preflight.mjs` + `start-field-test.bat` + `start-windows.bat` in `deployment/build-usb-package.ps1`, and strip production `.env.example` from the field-test USB package.
- [x] **H3** Reclassify `tests/verify_field_test.mjs` explicitly as an In-Memory Application Test and add reproducible local PostgreSQL 16 + PostgREST stack (`deployment/docker-compose.field-test.yml`, `deployment/field-test-init.sql`, `deployment/nginx/field-test-postgrest.conf`) + `tests/verify_supabase_integration.mjs`.
- [x] **H4** Add actual outbound network isolation assertions (`net.Socket.prototype.connect`, `http.request`, `https.request`), loopback bind check, and package-lock rejection checks in `tests/verify_field_test.mjs`.
- [x] **H5** Update `FIELD_TEST.md` & `PROGRESS.md`, run builds, `tests/verify_field_test.mjs`, `docker compose config`, and USB build + fail-safe preflight/smoke tests; commit to `field-test-preparation`.
