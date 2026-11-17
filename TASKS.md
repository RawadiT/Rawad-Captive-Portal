# TASKS.md — Final Closure (PostgreSQL Fencing Hardening)

**Baseline Commit:** `68554ae71fe40eee66e5a250d5a92e80dfe1a6b3`

- [x] **C1** Reject `p_fence_token IS NULL`, empty `p_lock_name`/`p_owner_id`, and use `IS DISTINCT FROM` in `public.fenced_update_session_status()` (`supabase/schema.sql`).
- [x] **C2** Acquire `SELECT ... FOR UPDATE` on `monitor_locks` FIRST, then validate `v_lock.lease_expires_at < clock_timestamp()` after acquiring the row lock.
- [x] **C3** Commit `tests/verify_fencing_race.mjs` implementing a real 2-connection `psql` concurrency & fencing test suite (8 cases + cleanup).
- [x] **C4** Run Fifth, Sixth, and Seventh Audit suites, Backend & Frontend builds, SQL & RouterOS static checks, USB build & smoke test, update `PROGRESS.md`, commit & push to `main`.
