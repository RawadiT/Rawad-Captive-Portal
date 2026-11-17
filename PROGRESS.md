# PROGRESS.md — Sixth Audit Remediation

**Baseline Commit:** `de61fa5793d5cece616fb6c3fc036b09d879a385`  
**Status:** Complete Locally (Live Supabase & MikroTik Tests NOT RUN — Not Deployed)

- **A6.1:** Hardened `QuotaService.withLeaseRenewal` against late MikroTik completion after lease loss (bounded grace wait + `revocation_pending` & post-settlement compensating revoke if still in flight).
- **A6.2:** Added periodic PostgreSQL `session_monitor_sync` lock renewal during long `SessionMonitor.syncSessions()` cycles and safe mutation abort on lock loss.
- **A6.3:** Secured `rawad-portal-state` ownership in `deploy.rsc` & `rollback.rsc` via exact `.id` (`rawadIdStateScript`) and `rawadStateBodyLen` verification.
- **A6.4:** Added pre-restore comparison against `rawadSetDnsRemote`, `rawadSetWwwSsl*`, `rawadSetTz`, and `rawadSetNtpEn` in `rollback.rsc` so manual admin changes after deploy are preserved.
- **A6.5:** Added dependency checks and `:do { ... } on-error={ ... }` isolation in `rollback.rsc`; verified Backend/Frontend builds, Sixth Audit verification suite, and USB package smoke test.
