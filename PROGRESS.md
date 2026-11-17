# PROGRESS.md — Fourth Audit Remediation

**Baseline Commit:** `b5787b5caf59cc4cdef14564416382cd686ca2d1`  
**Status:** Complete Locally (Live Supabase & MikroTik Tests NOT RUN — Not Deployed)

- **A4.1:** Added legacy `provisioning` `lease_expires_at` backfill, `reclaim_expired_provisioning_leases()`, and `renew_provisioning_lease()` with `REVOKE PUBLIC/anon/authenticated` + `GRANT EXECUTE TO service_role`.
- **A4.2:** Wired `withLeaseRenewal` in `QuotaService`, periodic `reclaimExpiredProvisioningLeases()` in `SessionMonitor.syncSessions()`, and `revokingSessionIds` concurrent revocation guard.
- **A4.3:** Hardened `routeros/deploy.rsc` DNS gate to require active WAN `input` `drop` rules covering BOTH TCP and UDP port 53 (rejecting non-WAN or UDP-only rules).
- **A4.4:** Extended pre-deploy conflict gate to NAT, Walled Garden, and Static DNS; verified all `rollback.rsc` deletions are gated by `$rawadCreated* = true`.
