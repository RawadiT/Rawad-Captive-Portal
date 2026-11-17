# TASKS.md — Second Independent Audit Remediation

**Baseline Commit:** `0242e3ca46f7864554097033c7041217dceef2d3`

- [x] **R2.1** Remove MAC binding from ordinary accounts (`restClient.ts`, `adapter.ts`, `quotaService.ts`) & prevent cross-account MAC disconnect in `revokeHotspotAccess`.
- [x] **R2.2** Add idempotent legacy RPC privilege revocation & cleanup (`claim_free_quota`, `activate_user_on_first_login`) + `provisioning` lock state in `supabase/schema.sql`.
- [x] **R2.3** Implement 3-step PostgreSQL-locked provisioning (`begin_*_provisioning` -> MikroTik -> `finalize_*_session` / `abort_provisioning`) + partial MikroTik cleanup + fail-loud revocation in `restClient.ts`, `quotaService.ts`, `sessionMonitor.ts`.
- [x] **R2.4** Individual firewall rule ownership tracking, pre-existing name conflict abort, DNS open-resolver preflight check, and safe `rollback.rsc` in `routeros/*.rsc`.
- [x] **R2.5** Bind `127.0.0.1:4000:4000` in `deployment/docker-compose.yml` and align `DEPLOYMENT.md`.
- [x] **R2.6** Run all local builds & static validations, rebuild `usb-package/`, commit & push to `main`.
