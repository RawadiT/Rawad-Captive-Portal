# TASKS.md — Fifth Audit Remediation

**Baseline Commit:** `79c360b8108036e8cc2c5f64cf2d5b808bee31bd`

- [x] **A5.1** Make `routeros/deploy.rsc` DNS Security Gate unconditional (runs even if `allow-remote-requests=yes`), resolve WAN interfaces without fragile `immediate-gw` substring matching, and verify `chain=input` TCP/UDP port 53 protection cannot be bypassed by earlier rules.
- [x] **A5.2** Make `QuotaService.withLeaseRenewal` trackable, awaitable, and abort-on-failure (`LeaseLostError`), plus compensating MikroTik revoke on any provisioning failure or concurrent `reclaim_expired_provisioning_leases()` race; use `FOR UPDATE SKIP LOCKED` in `reclaim_expired_provisioning_leases()`.
- [x] **A5.3** Prevent overlapping `SessionMonitor.syncSessions()` ticks in-process (`syncInFlight` + `setTimeout`), add PostgreSQL-backed crash-safe multi-process lock (`monitor_locks`, `try_acquire_monitor_lock`, `release_monitor_lock`), and retry/recover cleanly on PostgreSQL write failures after MikroTik revoke.
- [x] **A5.4** Capture exact created `.id` values in `deploy.rsc` (`rawadId*`) and verify both `.id` AND unmodified properties in `rollback.rsc` so pre-existing, manually added, and manually modified resources are never deleted.
- [x] **A5.5** Run all builds, TypeScript checks, Fifth Audit simulation & static validations (DNS gate, lease, recovery, concurrency, rollback), USB package smoke test, update `PROGRESS.md`, commit & push to `main`.
