# TASKS.md — Final Focused Audit (PostgreSQL Fencing Race)

**Baseline Commit:** `6850f913db7f45a7b82d15cc5c6cf32c32398411`

- [x] **F1** Make `public.fenced_update_session_status()` in `supabase/schema.sql` lock the `monitor_locks` row with `SELECT ... FOR UPDATE`, validate `p_status`, and return `FOUND` (`false` if no session row was updated).
- [x] **F2** Add concurrency test (`verify_fencing_race.mjs`) proving `FOR UPDATE` blocks Backend B until Backend A's transaction completes, rejects stale `fence_token` from A after B takes ownership, rejects expired locks, and rejects invalid `p_status` / missing session.
- [x] **F3** Re-run Fifth, Sixth, and Seventh Audit suites, Backend & Frontend builds, SQL & RouterOS static checks, USB build & smoke test, update `PROGRESS.md`, commit & push to `main`.
