# PROGRESS.md — Final Closure (PostgreSQL Fencing Hardening)

**Baseline Commit:** `68554ae71fe40eee66e5a250d5a92e80dfe1a6b3`  
**Status:** Complete Locally (Live Supabase & MikroTik Tests NOT RUN — Not Deployed)

- **C1:** Added explicit `p_fence_token IS NULL`, `v_lock_name = ''`, `v_owner_id = ''` rejection and `IS DISTINCT FROM` comparisons in `public.fenced_update_session_status()`.
- **C2:** Moved lease expiry check (`clock_timestamp()`) after `SELECT ... FOR UPDATE` in `public.fenced_update_session_status()` so leases expiring while waiting on the row lock are rejected.
- **C3:** Added `tests/verify_fencing_race.mjs` (2 independent `psql` connections testing all 8 real PostgreSQL concurrency/fencing scenarios + cleanup, gated on `TEST_DATABASE_URL`).
- **C4:** Completed final builds, Fifth/Sixth/Seventh Audit suites, SQL/RouterOS static validations, and USB package build & smoke test.
