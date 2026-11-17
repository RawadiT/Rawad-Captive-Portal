# TASKS.md — Seventh Audit Remediation

**Baseline Commit:** `0883ebfafee1051b92ea334bc36486efa7ed35f7`

- [x] **A7.1** Verify `rawad-portal-state` exact `.id`, name, comment, safe `:global` grammar, and dual-hash digest (`rawadStateH1`, `rawadStateH2`) against `rawad-portal-anchor` in `routeros/rollback.rsc` BEFORE executing `/system script run`.
- [x] **A7.2** Add monotonic `fence_token` to `monitor_locks`, `try_acquire_monitor_lock`, and `fenced_update_session_status` RPC in `supabase/schema.sql`, `backend/db/*`, and `SessionMonitor` to prevent stale mutations on lock loss during in-flight MikroTik or PostgreSQL calls.
- [x] **A7.3** Harden `SessionMonitor` lock renewal lifecycle (`renewalSeq`, `lockStopped`, `await inFlightLockRenewal`, `!lockLost` release guard) against in-flight renewal races.
- [x] **A7.4** Allow `mark_revocation_pending` to re-queue from `'disconnected'` on late MikroTik grant compensation failure so no late grant can remain un-revoked.
- [x] **A7.5** Run Fifth, Sixth, and Seventh Audit regression suites, Backend & Frontend builds, SQL/RouterOS static checks, USB package build & smoke test, update `PROGRESS.md`, commit & push to `main`.
