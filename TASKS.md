# TASKS.md — Third Audit Remediation

**Baseline Commit:** `2acf6f356922302de393cd4cdc88e27f6953de22`

- [x] **A3.1** Fix PostgreSQL provisioning lease (`lease_expires_at`, no 30s premature release, validate lease in `finalize_*`, add `'revocation_pending'` status) in `supabase/schema.sql`.
- [x] **A3.2** Fix failure recovery in `quotaService.ts` & `sessionMonitor.ts` (no `.catch(() => {})` on compensating revoke, keep `'revocation_pending'` if revoke fails, never mark `'expired'`/`'disconnected'` before RouterOS revoke succeeds).
- [x] **A3.3** Remove runtime user/profile deletion from `routeros/rollback.rsc`; keep only `deploy.rsc`-owned resources.
- [x] **A3.4** Add mandatory DNS open-resolver abort gate in `routeros/deploy.rsc` before setting `allow-remote-requests=yes` (without modifying WAN).
- [x] **A3.5** Update `DEPLOYMENT.md` to match the 3-step RPCs (`begin_*`, `finalize_*`, `abort_provisioning`, `revocation_pending`).
- [x] **A3.6** Run all builds, static validations, USB package validation, commit & push to `main`.
