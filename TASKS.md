# TASKS.md — Final Field-Test Verification Fixes

**Branch:** `field-test-preparation`  
**Baseline Commit:** `4a540922ab9fa8f427071068c2c3cb8e52cebff7`

- [x] **V1** Make `tests/verify_supabase_integration.mjs` fail closed (`exit 1`) by default whenever the local PostgreSQL/PostgREST service is unavailable.
- [x] **V2** Update `FIELD_TEST.md` to require `backend` build and Docker readiness verification (`docker info`, `docker compose ps`) before running `tests/verify_supabase_integration.mjs`.
- [x] **V3** Clarify API-level vs container/OS-level network isolation in `tests/verify_field_test.mjs` and `FIELD_TEST.md`, and add an `internal: true` Docker network (`field_test_internal`) to `deployment/docker-compose.field-test.yml`.
- [x] **V4** Run Backend/Frontend builds, `tests/verify_field_test.mjs`, `docker compose config`, verify `tests/verify_supabase_integration.mjs` fails closed when the service is stopped, rebuild & smoke-test USB package, update `PROGRESS.md`, and commit to `field-test-preparation`.
