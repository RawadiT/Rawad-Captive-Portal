# PROGRESS.md — Second Independent Audit Remediation

**Baseline Commit:** `0242e3ca46f7864554097033c7041217dceef2d3`  
**Status:** Complete Locally (Live Supabase & MikroTik Tests NOT RUN — Not Deployed)

- **R2.1:** `grantHotspotAccess` now binds `mac-address` ONLY when `bindMac=true` (free quota), never on ordinary accounts (`bindMac=false`); `revokeHotspotAccess` matches `a.user === input.username && (!macUpper || a['mac-address'] === macUpper)` so unrelated accounts sharing a MAC are never disconnected.
- **R2.2:** Added idempotent legacy RPC privilege revocation & `DROP FUNCTION IF EXISTS` for `claim_free_quota(TEXT, INTEGER)` and `activate_user_on_first_login(UUID)`, plus `'provisioning'` status and partial unique indexes covering `('provisioning', 'active')`.
- **R2.3:** Implemented 3-step PostgreSQL-locked provisioning (`begin_*_provisioning` -> MikroTik -> `finalize_*_session` / `abort_provisioning`), partial RouterOS resource cleanup on failure, and strict fail-loud revocation before marking DB sessions disconnected.
- **R2.4:** Added individual firewall rule ownership flags (`rawadCreatedFw*`, `rawadCreatedV6*`), pre-existing `rawad-*` conflict abort, DNS open-resolver preflight notice, and ownership-gated `rollback.rsc`.
- **R2.5:** Bound `127.0.0.1:4000:4000` in `deployment/docker-compose.yml` and aligned `DEPLOYMENT.md`.
