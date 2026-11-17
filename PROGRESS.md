# PROGRESS.md — Third Audit Remediation

**Baseline Commit:** `2acf6f356922302de393cd4cdc88e27f6953de22`  
**Status:** Complete Locally (Live Supabase & MikroTik Tests NOT RUN — Not Deployed)

- **A3.1:** Added `lease_expires_at` (2-minute reservation lease), `'revocation_pending'` status, lease expiration validation in `finalize_free_session` / `finalize_user_session`, and `mark_revocation_pending` RPC in `supabase/schema.sql`.
- **A3.2:** Removed `.catch(() => {})` from compensating revocations in `quotaService.ts`, transitioned failed revocations to `'revocation_pending'`, and updated `SessionMonitor` to retry `'revocation_pending'` and never mark `'expired'`/`'disconnected'` before RouterOS revocation succeeds.
- **A3.3:** Removed runtime user/profile deletion (`rawad-guest-portal-managed`) from `routeros/rollback.rsc`.
- **A3.4:** Added mandatory DNS open-resolver abort gate in `routeros/deploy.rsc` before enabling `allow-remote-requests=yes` without modifying WAN.
- **A3.5:** Aligned `DEPLOYMENT.md` with the 3-step provisioning & recovery RPCs.
