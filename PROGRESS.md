# PROGRESS.md — Seventh Audit Remediation

**Baseline Commit:** `0883ebfafee1051b92ea334bc36486efa7ed35f7`  
**Status:** Complete Locally (Live Supabase & MikroTik Tests NOT RUN — Not Deployed)

- **A7.1:** Updated `routeros/deploy.rsc` and `routeros/rollback.rsc` so `rollback.rsc` reads `rawad-portal-anchor` and `rawad-portal-state` as strings and verifies `.id`, length, safe grammar, and dual 31-bit polynomial hashes (`rawadStateH1`/`rawadStateH2`) BEFORE running `/system script run`.
- **A7.2:** Added `fence_token` to `public.monitor_locks` and `fenced_update_session_status()` in `supabase/schema.sql`, wired through `DatabaseClient` / `SupabaseDatabaseClient` and `SessionMonitor` (`verifyLock()` + fenced status writes).
- **A7.3:** Hardened `SessionMonitor` lock renewal with `renewalSeq` and `lockStopped` guards so late/failed renewals never schedule timers or release another process's lock.
- **A7.4:** Extended `mark_revocation_pending` to allow re-queuing from `'disconnected'` if late MikroTik compensation fails after `SessionMonitor` already ran.
- **A7.5:** Executed Backend `tsc`, Frontend `tsc --noEmit` & `next build`, Fifth/Sixth/Seventh Audit test suites, and `build-usb-package.ps1` + USB smoke test.
