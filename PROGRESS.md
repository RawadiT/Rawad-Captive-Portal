# PROGRESS.md — Fifth Audit Remediation

**Baseline Commit:** `79c360b8108036e8cc2c5f64cf2d5b808bee31bd`  
**Status:** Complete Locally (Live Supabase & MikroTik Tests NOT RUN — Not Deployed)

- **A5.1:** Removed `allow-remote-requests=false` condition from `routeros/deploy.rsc` DNS gate; added exact WAN interface resolution (`WAN` interface-list + `%` parsing on active default routes) and top-to-bottom `chain=input` rule-order bypass detection for TCP and UDP port 53.
- **A5.2:** Replaced fire-and-forget `setInterval` in `QuotaService.withLeaseRenewal` with tracked, awaitable recursive renewal that aborts provisioning via `LeaseLostError` on lease loss/failure and triggers `compensateFailedProvisioning` (strict MikroTik revoke + DB cleanup/`revocation_pending`). Hardened `reclaim_expired_provisioning_leases()` with `FOR UPDATE SKIP LOCKED`.
- **A5.3:** Prevented overlapping `SessionMonitor.syncSessions()` executions via `syncInFlight` coalescing + `setTimeout` scheduling; added PostgreSQL `monitor_locks` lease (`try_acquire_monitor_lock` / `release_monitor_lock`) for cross-process and crash-recovery coordination; added DB status update retries and non-fatal error handling after MikroTik revoke.
- **A5.4:** Updated `routeros/deploy.rsc` to record exact `.id` (`rawadId*`) and parameters in `rawad-portal-state`, and `routeros/rollback.rsc` to delete ONLY resources matching both exact `.id` and unmodified properties.
- **A5.5:** Verified Backend `tsc`, Frontend `tsc --noEmit` & `next build`, Fifth Audit verification suite (`verify_fifth_audit.mjs`), and `build-usb-package.ps1` + USB smoke test.
