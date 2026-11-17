# PROGRESS.md — Harden Field-Test Isolation Before Approval

**Branch:** `field-test-preparation`  
**Baseline Commit:** `9db717cc99130f71e988dc12c1daa825b9a2ffc8`  
**Status:** Hardened Field-Test Isolation Ready (Local Docker Supabase Integration NOT TESTED locally — Docker daemon offline)

- **H1:** `validateFieldTestIsolation()` now enforces loopback-only `HOST` (`127.0.0.1` / `localhost`) and rejects `0.0.0.0`, LAN, and public IPs.
- **H2:** Added `RAWAD_FIELD_TEST_PACKAGE_LOCK=true` runtime check in `server.ts`, `field-test-preflight.mjs`, and `start-field-test.bat` / `start-windows.bat` in `build-usb-package.ps1` so the field-test USB package refuses any non-mock/non-loopback/production config.
- **H3:** Added `deployment/docker-compose.field-test.yml` (local `postgres:16-alpine` + `postgrest` + `nginx` on `127.0.0.1:54321`) and `tests/verify_supabase_integration.mjs` using `SupabaseDatabaseClient`.
- **H4:** Verified zero outbound network connections during `MockMikroTikAdapter` execution and loopback-only binding in `tests/verify_field_test.mjs`.
- **Remaining Limitations:**
  - `tests/verify_supabase_integration.mjs` is `NOT TESTED` locally because Docker Desktop Linux Engine daemon is not running on this host.
  - Real MikroTik Lab & Production tests are `NOT RUN` per mandatory constraints.
