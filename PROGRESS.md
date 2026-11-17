# PROGRESS.md — Security & Reliability Remediation Log

**Baseline Commit:** `cb22747a99c7615d39e7c58991044fffb0e0cc32`  
**Status:** Remediation Complete Locally (Live Supabase & MikroTik Tests NOT RUN — Not Deployed)

- **Phase 1 (Supabase Security):** Hardened `supabase/schema.sql` (`SET search_path = pg_catalog, public`, revoked `PUBLIC`/`anon`/`authenticated`, granted `service_role`, added input validation, partial unique indexes, and `pg_advisory_xact_lock`).
- **Phase 2 (Session & Quota Reliability):** Refactored `QuotaService` + `DatabaseClient` to 2-phase MikroTik-first provisioning with compensating revoke on DB failure and PostgreSQL-level advisory locking.
- **Phase 3 (MikroTik Safety):** Removed `mac-cookie` from `rawad-hs-prof`, tagged managed HotSpot users/profiles with `comment="rawad-guest-portal-managed"`, and eliminated broad prefix deletion in `rollback.rsc`.
- **Phase 4 & 5 (Deployment, USB & Docs):** Fixed `install-linux.sh`, `next.config.mjs` API rewrite, `start-windows.bat` `--env-file`, `docker-compose.yml` healthchecks, `README.md`, and `DEPLOYMENT.md`.
- **Phase 6 (Verification):** Backend `tsc`, Frontend `tsc --noEmit` & `next build`, SQL static review (8/8), RouterOS static review, Docker & USB package validation (HTTP 200 on `/` & `/admin`, fail-closed Backend) all passed. Live Supabase & MikroTik tests: NOT RUN.
