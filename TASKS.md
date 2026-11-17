# TASKS.md — PostgreSQL Integration Fix (`finalize_free_session`)

**Branch:** `field-test-preparation`  
**Baseline Commit:** `87ce639626dd5ed633624943d9d0b59c0bdb54cc`

- [x] **PG1** Fix `column reference "mac_address" is ambiguous` in `public.finalize_free_session` (`supabase/schema.sql`) by replacing `ON CONFLICT (mac_address)` with `ON CONFLICT ON CONSTRAINT free_quotas_pkey`, preserving `mac_address` in `RETURNS TABLE`.
- [x] **PG2** Audit all other `RETURNS TABLE` functions in `supabase/schema.sql` (`begin_free_provisioning`, `begin_user_provisioning`, `finalize_user_session`, `try_acquire_monitor_lock`) for similar column/variable ambiguities (none found).
- [x] **PG3** Update `tests/verify_supabase_integration.mjs` to use unique per-run MACs/usernames/lock names, clean up created test rows in `finally`, always release `monitor_locks`, and use `process.exitCode` instead of abrupt `process.exit()`.
- [x] **PG4** Execute `node tests/verify_supabase_integration.mjs` twice back-to-back against Docker PostgreSQL 16 + PostgREST (`127.0.0.1:54321`) — both runs passed (`exit code 0`).
- [x] **PG5** Run Backend/Frontend builds, `tests/verify_field_test.mjs`, review `git diff`, update `PROGRESS.md`, and commit to `field-test-preparation`.
