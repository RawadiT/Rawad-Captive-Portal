# PROGRESS.md — PostgreSQL Integration Fix (`finalize_free_session`)

**Branch:** `field-test-preparation`  
**Baseline Commit:** `87ce639626dd5ed633624943d9d0b59c0bdb54cc`  
**Status:** Local PostgreSQL 16 + PostgREST Integration Verified (2/2 Consecutive Runs Passed)

- **PG1:** Fixed `ON CONFLICT (mac_address)` -> `ON CONFLICT ON CONSTRAINT free_quotas_pkey` in `public.finalize_free_session` (`supabase/schema.sql`), keeping `mac_address` in the RPC output table intact.
- **PG2:** Audited all other `RETURNS TABLE` functions in `supabase/schema.sql`; no other ambiguous `OUT`-variable vs column references exist.
- **PG3:** Hardened `tests/verify_supabase_integration.mjs` with per-run random MAC/username/lock identifiers, targeted REST cleanup in `finally`, guaranteed monitor lock release, and `process.exitCode` error handling.
- **PG4:** Executed `node tests/verify_supabase_integration.mjs` twice consecutively against Docker PostgreSQL 16 + PostgREST (`127.0.0.1:54321`) covering `ping`, `begin/finalize free session`, duplicate MAC conflict, `monitor_lock` + `fencedUpdateSessionStatus`, `createUser`, and `begin/finalize user session` — both runs exited `0` (`ALL LOCAL SUPABASE/POSTGRESQL INTEGRATION TESTS PASSED`).
- **Not Run (Mandatory Constraints):** Production Supabase & Real MikroTik RouterOS remain `NOT RUN`.
