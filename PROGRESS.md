# PROGRESS.md — Final Field-Test Verification Fixes

**Branch:** `field-test-preparation`  
**Baseline Commit:** `4a540922ab9fa8f427071068c2c3cb8e52cebff7`  
**Status:** Fail-Closed Verification Fixes Applied (Local Docker PostgreSQL+PostgREST Integration NOT EXECUTED locally — Docker daemon offline)

- **V1:** Updated `tests/verify_supabase_integration.mjs` to fail closed (`process.exit(1)`) by default when `http://127.0.0.1:54321` is unavailable.
- **V2:** Updated `FIELD_TEST.md` with explicit `backend` build, `docker info`, and `docker compose ps` steps before running `tests/verify_supabase_integration.mjs`.
- **V3:** Added `field_test_internal` (`internal: true`) network isolation to `deployment/docker-compose.field-test.yml` and clarified API-level vs container/OS-level isolation boundaries in `tests/verify_field_test.mjs` and `FIELD_TEST.md`.
- **V4:** Verified Backend/Frontend builds, `tests/verify_field_test.mjs`, `docker compose config`, fail-closed `exit code 1` of `tests/verify_supabase_integration.mjs` when stopped, and USB package build + fail-safe preflight/smoke tests.
