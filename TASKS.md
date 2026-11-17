# TASKS.md — Sixth Audit Remediation

**Baseline Commit:** `de61fa5793d5cece616fb6c3fc036b09d879a385`

- [x] **A6.1** Fix `QuotaService.withLeaseRenewal` late MikroTik completion race: wait up to `lateCompletionGraceMs` for in-flight `grantHotspotAccess` before compensating, and if still in flight, keep `revocation_pending` and trigger compensating revoke upon late completion.
- [x] **A6.2** Add periodic `session_monitor_sync` lock renewal (`monitorLockRenewIntervalMs` / `monitorLockLeaseSeconds`) in `SessionMonitor` and abort further mutations if the lock is lost mid-cycle.
- [x] **A6.3** Track `rawad-portal-state` exact `.id` (`rawadIdStateScript`) and body length (`rawadStateBodyLen`) in `deploy.rsc` / `rollback.rsc` so modified or replaced state scripts are never deleted.
- [x] **A6.4** Record expected project-applied config values (`rawadSetDnsRemote`, `rawadSetWwwSsl*`, `rawadSetTz`, `rawadSetNtpEn`) and preserve manual post-deploy changes during rollback.
- [x] **A6.5** Guard dependent resource removals (Pool, HotSpot Profile, DHCP Option, API Group) and isolate errors in `rollback.rsc`, then run all builds, Sixth Audit verification suite, USB package smoke test, commit & push to `main`.
