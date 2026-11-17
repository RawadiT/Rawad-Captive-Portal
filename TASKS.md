# TASKS.md — Security & Reliability Remediation Plan

**Baseline Commit:** `cb22747a99c7615d39e7c58991044fffb0e0cc32`

## Phase 1 — Supabase Security
- [x] **R1.1** Harden `SECURITY DEFINER` functions in `supabase/schema.sql` (`SET search_path = pg_catalog, public`).
- [x] **R1.2** Revoke `EXECUTE` from `PUBLIC`, `anon`, `authenticated` and grant only to `service_role`.
- [x] **R1.3** Add PostgreSQL input validation (`p_mac` regex, `p_duration_seconds` bounds, `p_user_id` non-null) and partial unique indexes for active sessions.
- [x] **R1.4** Add explicit RLS deny policies / revoke table privileges from `PUBLIC`, `anon`, `authenticated`.

## Phase 2 — Session & Quota Reliability
- [x] **R2.1** Refactor `grantFreeAccess` & `loginUser` to provision MikroTik **before** committing `free_quotas` or `started_at`/`expires_at` in PostgreSQL.
- [x] **R2.2** Replace process-local-only locking with PostgreSQL `pg_advisory_xact_lock` + atomic RPCs (`commit_free_session`, `commit_user_session`).
- [x] **R2.3** Document exact 2-phase transaction & failure-recovery flow in `DEPLOYMENT.md` and `quotaService.ts`.

## Phase 3 — MikroTik Safety
- [x] **R3.1** Remove `mac-cookie` from `rawad-hs-prof` in `routeros/deploy.rsc` so accounts are not bound to MAC and expired/disabled sessions cannot auto-relogin.
- [x] **R3.2** Tag dynamic HotSpot users/profiles with `comment="rawad-guest-portal-managed"` in `restClient.ts` and restrict `rollback.rsc` to remove only provably owned resources (no broad prefix regex).
- [x] **R3.3** Keep all RouterOS scripts strictly scoped to `ether10` and verify conflict detection in `preflight.rsc`.

## Phase 4 & 5 — Deployment, USB & Documentation
- [x] **R4.1** Fix `install-linux.sh` (`npm ci && npm run build && npm prune --omit=dev`).
- [x] **R4.2** Fix `frontend/next.config.mjs` API rewrite for standalone USB startup + `start-windows.bat` `--env-file` loading + `docker-compose.yml` healthchecks.
- [x] **R5.1** Rewrite `README.md` (clean UTF-8) and update `DEPLOYMENT.md` to match current Supabase + `ether10` + MikroTik `session-timeout` architecture.

## Phase 6 — Verification
- [x] **R6.1** Run Backend `tsc` build, Frontend `tsc --noEmit`, Frontend `next build`.
- [x] **R6.2** Run static SQL, RouterOS, Docker, and USB package validation checks (marking live Supabase/MikroTik tests `NOT RUN`).
- [x] **R6.3** Commit remediation to `main` and deliver completion report.
