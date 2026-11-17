# TASKS.md — Fourth Audit Remediation

**Baseline Commit:** `b5787b5caf59cc4cdef14564416382cd686ca2d1`

- [x] **A4.1** Add legacy `provisioning` `lease_expires_at` backfill + `reclaim_expired_provisioning_leases` + `renew_provisioning_lease` RPCs in `supabase/schema.sql`.
- [x] **A4.2** Wire `reclaimExpiredProvisioningLeases`, `renewProvisioningLease`, and concurrent revocation guard (`revokingSessionIds`) in `backend/`.
- [x] **A4.3** Harden WAN TCP+UDP port 53 DNS security gate in `routeros/deploy.rsc` (never accept non-WAN rules, abort if unproven, never modify WAN).
- [x] **A4.4** Verify all ownership flags in `deploy.rsc` and `rollback.rsc` (including DHCP, DNS, NAT, Firewall, HotSpot, API).
- [x] **A4.5** Run all builds, TypeScript checks, lease/recovery/DNS-gate simulations, SQL/RouterOS/Docker/USB validations, update `PROGRESS.md`, commit & push to `main`.
