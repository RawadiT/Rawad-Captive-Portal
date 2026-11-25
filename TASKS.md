# TASKS.md — Rawad RB4011 Full Simulation & Production Readiness

**Workspace / Target Branches:** `main`, `field-test-preparation`  
**Lab Environment:** `Rawad-CHR-Lab` (`RouterOS 7.25.1 x86_64`) + `RAWAD-WIN10-CLIENT` (`192.168.88.250`) + Supabase `Rawad Test` (`efqsmehqnhuzohzjztni`, PostgreSQL `17.12`)  
**Production Safety Lock:** ZERO connections or changes to company production RB4011 or production Supabase. Never delete `admins` (`hashim`, `testo`) or original `users` (`test`, `hashim`). Never run `POST /cleanup/execute` on live `Rawad Test` data.

---

## Historical Completed Baselines (2026-11-18 — 2026-11-20)
- [x] Strict numeric HTTP `200` fetch checks (`routeros/deploy.rsc` 4 paths) & `parseAck()` (`tests/verify_system.mjs`).
- [x] Three-tier admin role hierarchy (`site_owner`, `general`, `subordinate`), PG 17 portable 3-file backup & verified restore, Phase 1–5 migrations (`202611190001_portal_settings_and_unlimited.sql` + external rollback `supabase/rollbacks/`), Edge Functions deployment, Unified Light Daytime Admin UI (`admin/`) & Customer Portal (`hotspot/`), CHR isolated static admin container (`x86_64` ONLY), and dual Win11/Win10 admin access restoration.

---

## Master Task Execution Board (`RB-001` — `FINAL-ACCEPTANCE-TEST`)

| Task ID | Stage | Task Name | Prerequisites | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `RB-001` | 0 | Initialize Task-Driven Execution board (`TASKS.md`, `PROGRESS.md`) | — | All tasks `RB-001..RB-030` & `FINAL-ACCEPTANCE-TEST` defined with criteria and tracked live | `PASSED` |
| `RB-002` | 1 | Full VirtualBox & `Rawad-CHR-Lab` Baseline Audit | `RB-001` | Full CHR `/export`, containers, firewall/NAT, HotSpot, schedulers, `127.0.0.1:2222/8088`, `192.168.56.2:8088`, and `RAWAD-WIN10-CLIENT` screenshot captured | `PASSED` |
| `RB-003` | 1 | `Rawad Test` Supabase, Edge Functions & Repo Baseline Audit | `RB-001` | DB counts (`admins=2`, `users=2`, `settings=1`), 3 ACTIVE Edge Functions, HTTP probes, and `verify_system.mjs` baseline verified | `PASSED` |
| `RB-004` | 1 | Stage 1 Gap, Risk & Hardware-Parity Summary | `RB-002, RB-003` | Initial risks (WSL2/Hyper-V disabled -> no local ARM32 QEMU; `deploy.rsc` rule placement vs `hotspot=auth`; `preflight.rsc` legacy names) logged in `PROGRESS.md` | `PASSED` |
| `RB-005` | 2 | Expand `Rawad-CHR-Lab` to Multi-Department RB4011 VLAN Topology | `RB-004` | Non-destructive VLANs (`vlan10-mgmt`, `vlan20-staff`, `vlan30-floor1`, `vlan40-floor2` on `br-corp-sim`) + DHCP/NAT/inter-VLAN firewall isolation added without breaking HotSpot or Admin access | `PASSED` |
| `RB-006` | 2 | Verify Multi-Subnet Routing, HotSpot & Cross-VLAN Firewall Isolation | `RB-005` | Guests blocked from all simulated `10.10.x.0/24` subnets with observed drop counters; Win11 (`192.168.56.2:8088`, `127.0.0.1:8088`) & Win10 (`192.168.88.1:8088`) intact | `PASSED` |
| `RB-007` | 2 | Simulate WAN Link Disconnect & Automatic Recovery on CHR | `RB-006` | `setlinkstate1 off` enforces fail-closed external access while local LAN/Host-Only admin stays reachable; `setlinkstate1 on` restores Supabase connectivity | `PASSED` |
| `RB-008` | 2 | Author `LAB-SETUP.md` Topology & Reproduction Guide | `RB-007` | VirtualBox NICs, IP/VLAN table, CHR reproduction commands, and CHR `x86_64` vs RB4011 `ARM32` differences documented accurately | `PASSED` |
| `RB-009` | 3 | Line-by-Line Audit of `deploy.rsc`, `preflight.rsc`, `verify.rsc`, `rollback.rsc` | `RB-004` | Every RouterOS v7 command, filter placement,HotSpot profile, NAT, IPv6, NTP/DNS, and revocation scheduler reviewed | `PASSED` |
| `RB-010` | 3 | Validate RouterOS v7 Syntax & Critical `hotspot=auth` Filter Placement | `RB-009` | Verify whether `cUnverified` with `place-before=0` without `hotspot=auth` blocks Walled Garden pre-auth Supabase fetches on CHR | `PASSED` |
| `RB-011` | 3 | Author `RB4011-COMPATIBILITY.md` Matrix | `RB-010` | Complete compatibility matrix with 4 exact classifications (`verified`, `theoretical`, `incompatible`, `requires real RB4011`) | `PASSED` |
| `RB-012` | 3 | Author `ROLLBACK.md` Multi-Layer Rollback Runbook | `RB-009` | Safe rollback procedures documented for PostgreSQL schema/backups, Edge Functions, CHR Lab, and production `rollback.rsc` | `PASSED` |
| `RB-013` | 4 | Assess Container & Admin Dashboard on RB4011 ARM32 / NAND Constraints | `RB-004` | BusyBox ARM32/ARMv5 image constraints, RAM/CPU/storage/write-sectors measured; explicitly mark RB4011 container execution NOT verified / NOT approved | `PASSED` |
| `RB-014` | 4 | Evaluate & Validate Safe Local Static Hosting Alternative for `admin/` | `RB-013` | Zero-VPS internal company LAN static hosting architecture documented & tested locally against `Rawad Test` | `PASSED` |
| `RB-015` | 4 | Consolidate Stage 4 Findings into Docs | `RB-014` | ARM32 warnings & local alternative recorded clearly in `RB4011-COMPATIBILITY.md` and `PRODUCTION-READINESS.md` | `PASSED` |
| `RB-016` | 5 | Execute Comprehensive HotSpot & Captive Portal E2E Tests | `RB-008` | Free 30m quota, limited user, unlimited (`ALLOW:UNLIMITED`), expiry/revocation disconnect, `F5` continuity, logout, multi-client MACs tested; temp rows cleaned | `PASSED` |
| `RB-017` | 5 | Execute Supabase Edge Functions (`portal-auth`, `verify-mac`, `admin-api`) Suite | `RB-008` | All endpoints, `portal_settings` live reflection, `status_token`, revocations + ACK verified; ZERO `/cleanup/execute` on live data | `PASSED` |
| `RB-018` | 5 | Execute Security Hardening Suite (RLS, Roles, HMAC, MAC Spoof, Firewall) | `RB-008` | Anon REST blocked, `site_owner`/`general`/`subordinate` 403 guards, tampered/cross-MAC HMAC rejected, `verify-mac` secret enforced, Firewall isolation proven | `PASSED` |
| `RB-019` | 5 | Verify Admin Dashboard Live UI, Assets, RTL/Cairo & Desktop/Mobile | `RB-008` | `chrome-devtools-mcp` checks on `192.168.56.2:8088` across Desktop (`1440x900`) & Mobile (`390x844`): HTTP 200 local assets, 0 console errors, 0 overflow | `PASSED` |
| `RB-020` | 5 | Execute Live Failure Recovery Tests (5 Scenarios) | `RB-016..019` | WAN cut/restore, Supabase unreachable fail-closed, CHR reboot auto-start, Container stop/start recovery, Client NIC cut/reconnect all passed | `PASSED` |
| `RB-021` | 5 | Post-Stage-5 Database Cleanliness Verification | `RB-020` | Confirm `Rawad Test` restored to exact baseline (`admins=2: hashim, testo`; `users=2: test, hashim`; clean `free_quotas`/`sessions`) | `PASSED` |
| `RB-022` | 6 | Execute Gradual Load & Stress Tests (10, 25, 40, 60, 100 Concurrent) | `RB-021` | Real latency (`p50`, `p95`, `max`), HTTP status counts, error rates, and CHR CPU/RAM/HDD/write-sectors recorded at 10/25/40/60/100 concurrency | `PASSED` |
| `RB-023` | 6 | Cleanup All Synthetic Load-Test Data & Verify Recovery | `RB-022` | Zero synthetic users/sessions/quotas left in `Rawad Test`; CHR responsive and healthy | `PASSED` |
| `RB-024` | 6 | Document Measured Load Results & Lab Caveats in `TEST-REPORT.md` | `RB-023` | Exact measured figures logged with explicit warning NOT to extrapolate CHR `x86_64` numbers to RB4011 hardware | `PASSED` |
| `RB-025` | 7 | Fix Safe Discovered Code Bugs (`preflight.rsc`, `deploy.rsc`, `admin.js`, etc.) | `RB-010, RB-024` | All safe discovered bugs fixed cleanly without breaking existing invariants or `Rawad Test` compatibility | `PASSED` |
| `RB-026` | 7 | Add Regression Assertions & Re-Run Full Verification Suite | `RB-025` | `tests/verify_system.mjs` updated & passing; re-verify affected CHR/UI/Edge Function flows cleanly | `PASSED` |
| `RB-027` | 8 | Execute Final Documentation Consistency & Pre-Acceptance Audit | `RB-026` | Verify all 6 deliverable docs (`TASKS`, `PROGRESS`, `TEST-REPORT`, `RB4011-COMPATIBILITY`, `LAB-SETUP`, `ROLLBACK`) match observed outputs | `PASSED` |
| `FINAL-ACCEPTANCE-TEST` | 8 | Complete 17-Point Cold-Start Final Acceptance Test | `RB-027` | Cold VM power-off/on of CHR + Win10 VM, all 17 acceptance items executed & passed after final fixes, zero secrets leaked | `PASSED` |
| `RB-028` | 8 | Author `PRODUCTION-READINESS.md` & Hardware Rollout Checklist | `FINAL-ACCEPTANCE-TEST` | Final honest readiness %, explicit assessment on extra RB4011 coding, and minimal-risk company RB4011 checklist completed | `PASSED` |
| `RB-029` | 9 | Organized Git Commits, Branch Sync (`main` & `field-test-preparation`) & Push | `RB-028` | Clean non-forced push to `origin/main` and `origin/field-test-preparation`; remote SHA-1 matches local; `git status` clean | `PASSED` |
| `RB-030` | 9 | Deliver Unified 14-Point Arabic Final Report | `RB-029` | Complete 14-section report with verified facts, `file:///` links, and honest hardware-only checklist delivered | `PASSED` |

## Final Validation, Performance & Production Readiness Tasks (`RB-031` — `RB-040`)

| Task ID | Task Name | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- |
| `RB-031` | Refine `Powered BY Hashim Hasanen` Styling in Admin UI | Light gray subtle color, smaller font size, soft opacity, transparent/minimal aesthetic verified on Desktop & Mobile + CHR container | `PASSED` (`PASS`) |
| `RB-032` | Honest Audit of Previous Failed/Cancelled/Killed/Timeout Runs | Every non-clean run categorized (`PASS \| FAIL \| BLOCKED \| NOT TESTED \| CANCELLED`) with log evidence in `TEST-REPORT.md` & `PROGRESS.md` | `PASSED` (`PASS`) |
| `RB-033` | Complete Full Simulation Checks (Incl. Live Fail-Closed Test) | Fail-Closed unapproved MAC hotSpot check, DHCP/DNS/NAT, CHR reboot, container auto-recovery, RBAC/RLS/HMAC, WAN/Client recovery verified | `PASSED` (`PASS`) |
| `RB-034` | Diagnose BusyBox `n=100` Bottleneck & Validate Internal LAN Static Alternative | Root cause of BusyBox `n=100` failures identified (`FAIL` on BusyBox); internal LAN static host benchmarked 10/25/40/60/100 at 100% HTTP 200 (`PASS`); Edge Functions re-verified | `PASSED` (`PASS` LAN / `FAIL` BusyBox) |
| `RB-035` | Review Hardware Compatibility with Physical `RB4011iGS+RM` | Full `ARM32/ARMv5`, `1GB RAM`, `512MB NAND`, `RTL8367SB`, RouterOS 7.x review + off-router service separation + explicit untested/blocked hardware list | `PASSED` (Doc/Preflight; `ARM32` `BLOCKED`) |
| `RB-036` | Design Production Deployment Strictly Scoped to `ether10` (`A–F`) | Subsections A–F (`ether1–ether9` protection, `ether10` isolation, preflight 8 checks, stop conditions, surgical rollback, pre/post test plan) documented | `PASSED` (Design; HW `NOT TESTED`) |
| `RB-037` | Comprehensive Security Audit | Zero leaks across Git/code/docs, RLS/RBAC/Edge Functions/HMAC/MAC verification, guest isolation, WAN admin block, Fail-Closed verified | `PASSED` (`PASS`) |
| `RB-038` | Database & Supabase `Rawad Test` Deep Audit | Migrations, schema, RLS, Edge Functions, cleanup summary, unlimited accounts, preserved `admins`/`users`, hardcoded lab inventory audited | `PASSED` (`PASS`) |
| `RB-039` | Final 20-Row Acceptance Matrix | Full 20-item matrix with exact honest classifications (`PASS / FAIL / BLOCKED / NOT TESTED / CANCELLED`) & concrete evidence | `PASSED` (`PASS`) |
| `RB-040` | Update All 7 Docs, Verify, Push to GitHub & Deliver Final Report | All 7 markdown docs updated & consistent, `verify_system.mjs` + secret scan pass, non-forced push to `main` & `field-test-preparation`, final report delivered | `PASSED` (`PASS`) |

## Final Review — Production Isolation, Migration Tracking & Full E2E Load (`RB-041` — `RB-044`)

| Task ID | Task Name | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- |
| `RB-041` | Strict `ether10` Production Isolation & Zero Global Mutations | Remove `/ip dns set`, `/system clock set`, `/system ntp client set` from `deploy.rsc` & `rollback.rsc`; add read-only DNS prerequisite ABORT gate; scope `rawad-gate` & `walled-garden` to `server="rawad-guest-hotspot"`; verify with `verify_system.mjs`; mark RB4011 Production `BLOCKED` until field proof | `PASSED` (Scripts/Audit) / **`BLOCKED`** (Prod Rollout) |
| `RB-042` | Supabase Migration Tracking Analysis & Safe Sync Method | Inspect `pg_namespace` & `supabase migration list --linked`; document root cause (`remote=""`) and safe `migration repair --status applied` procedure without bypassing CLI consent or modifying Production | `PASSED` (`PASS`) |
| `RB-043` | Full-System E2E Load Test (`10, 25, 40, 60, 100` Users + `25` PBKDF2 Auth) | Run full 5-step user lifecycle + `revoked`/`ACK` batch flow across `10–100` concurrent simulated users + `25` PBKDF2 logins in `Rawad Test`; distinguish HTTP static vs Edge vs Full E2E vs physical RB4011; clean all synthetic data | `PASSED` (`PASS` on `Rawad Test` / HW `NOT TESTED`) |
| `RB-044` | Update Documentation with Honest Production Blockers, Load Breakdown & Final Report | Sync `PRODUCTION-READINESS.md`, `TEST-REPORT.md`, `RB4011-COMPATIBILITY.md`, `ROLLBACK.md`, `TASKS.md`, `PROGRESS.md`; re-verify & push cleanly without `--force` | `PASSED` (`PASS`) |

## Scope Clarification, Auth Capacity (`10–500`), Scalability & Safe Cleanup (`RB-045` — `RB-051`)

| Task ID | Task Name | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- |
| `RB-045` | Authentication & Session Capacity Benchmark (`10–500`) + Edge Cases | Full E2E auth lifecycle (`free -> verify-mac -> session_status -> logout -> revoked/ACK`) across `10..500`, `P50/P95/P99`, duplicate-race, expired/exhausted & secret guards measured cleanly | `PASSED` (`300/300` max 100% tier; `500` saturated `191/500`; RB4011 HW `NOT TESTED`) |
| `RB-046` | Targeted Scalability & Stability Hardening (`getDb()` + Partial Indexes) | Module-level singleton client reuse in 3 Edge Functions + `idx_sessions_pending_revocations` & `idx_sessions_active_expires` in `schema.sql` deployed to `Rawad Test` | `PASSED` (`PASS`) |
| `RB-047` | MikroTik Resource & Architectural Limits Audit | Measured `Rawad-CHR-Lab` CPU/RAM/rule overhead + documented DHCP `/24` (`241` IPs) & `shared-users=250` without assuming physical RB4011 ceiling | `PASSED` (`PASS` on CHR / HW `NOT TESTED`) |
| `RB-048` | Full Inventory & Safe Repository Cleanup (`KEEP` / `ARCHIVE` / `DELETE`) | Classified all 45 tracked files (`44 KEEP`, `1 ARCHIVE: docs/archive/FIELD_TEST.md`, `0 DELETE`), verified zero broken refs | `PASSED` (`PASS`) |
| `RB-049` | Repository Organization & Scope Clarification (`README.md`) | Updated `README.md` with explicit Auth-only Scope Clarification & `docs/archive/`, separated scratch outputs cleanly outside repo | `PASSED` (`PASS`) |
| `RB-050` | Full Post-Cleanup Regression & Functionality Verification | Verified `verify_system.mjs`, `run_stage5_tests.mjs` (`7/7`), all 6 Admin UI assets `HTTP 200`, CHR `hotspot/`, `.github/workflows/`, secret scan (`GREP_EXIT=1`) & clean DB | `PASSED` (`PASS`) |
| `RB-051` | Final Update of All Docs, Git Sync, Push & 11-Point Report | Updated `TASKS`, `PROGRESS`, `TEST-REPORT`, `PRODUCTION-READINESS`; verified after last edit; non-forced push to `main` & `field-test-preparation`; delivered 11-point report | `PASSED` (`PASS`) |

## Final Capacity Investigation, Proven Limits & Cleanliness Audit (`RB-052` — `RB-055`)

| Task ID | Task Name | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- |
| `RB-052` | Investigate 500-User Failure (Calibrated Single vs Multi-Process `350–500`) | Calibrated `127.0.0.1` (`232/500` 1-proc `ECONNREFUSED` vs `500/500` 5-proc); ran `350/400/450/500` in 1-proc & 5-proc against `Rawad Test`; logged exact `UND_ERR_CONNECT_TIMEOUT` per step; 0 orphan/duplicate sessions | `PASSED` (`350` 1-proc / `400` 5-proc stable; `500` `INCONCLUSIVE/UNSTABLE` despite `500/500` isolated burst) |
| `RB-053` | Establish Proven Operational Capacity & Safety Margin | Documented highest consistent `100%` tier (`350` 1-proc / `400` 5-proc), error onset (`400` 1-proc / `450` cumulative 5-proc), `P50/P95/P99`, `pg_stat_database`, and conservative `200–250` auth safety margin (RB4011 HW `NOT TESTED`) | `PASSED` (`PASS`) |
| `RB-054` | Final Repository Cleanliness & Reference Integrity Verification | Verified all HTML/CSS local assets (`EXISTS`), intentional SHA-256 duplicates (`admin/` vs `hotspot/`), zero untracked non-ignored files (`!! supabase/.temp/` only), external `scratch/` preserved | `PASSED` (`PASS`) |
| `RB-055` | Final Acceptance Gate & Doc Sync (`verify_system.mjs`, Secret Scan, DB, UI) | Re-verified `verify_system.mjs` (static pass / PG local skipped), secret scan (`GREP_EXIT=1`), `Rawad Test` clean DB (`admins=2`, `users=2`, `rem=0`), live Admin UI `HTTP 200`, clean Git sync & push | `PASSED` (`PASS`) |

## Repeatability & Certified Cloud Capacity Confirmation (`RB-056` — `RB-058`)

| Task ID | Task Name | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- |
| `RB-056` | Run 3 Independent Multi-Process Rounds (`300, 350, 400, 450, 500`) | 15 independent 5-process rounds on `Rawad Test` with CHR scheduler paused, between-round cleanup, zero orphan/duplicate sessions, `P50/P95/P99`, timeout/`429`/`5xx` counts, and strict unchanged timeouts | `PASSED` (`300/350/400` = `3/3`; `450/500` = `0/3`) |
| `RB-057` | Certify Cloud Auth Capacity vs Safe Margin vs Untested RB4011 | Strictly certify `400` (largest tier passing `3/3` at 100%), set recommended safe operating capacity at `200–250`, and explicitly classify real RB4011 capacity `NOT TESTED` | `PASSED` (`Certified Cloud: 400`; HW `NOT TESTED`) |
| `RB-058` | Final Documentation Closure (`TASKS`, `PROGRESS`, `TEST-REPORT`, `PRODUCTION-READINESS`) | Document all 15 rounds, 3-way capacity distinction, verify cleanly, commit & push without `--force`, deliver final report | `PASSED` (`PASS`) |

## Production RB4011 Read-Only Field Readiness Audit (`RB-059`)

| Task ID | Task Name | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- |
| `RB-059` | Production `RB4011` Read-Only Field Readiness Audit | Verified Git baseline & absence of real `/export`; authored Read-Only audit command pack, `ether10` vs `ether1–ether9` risk analysis, unexecuted `Safe Mode` rollout & surgical rollback blueprint, and explicit production blockers (`BLOCKED` / `NOT TESTED`) | `PASSED` (Audit & Plan) / **`BLOCKED`** (Prod Rollout) |
| `RB-060` | Full Repository Synchronization, Cleanup Verification & Finalization | Audited all 45 tracked files, branches (`main` & `field-test-preparation`), remotes, relative doc/HTML/CSS links & secret scan; updated `DEPLOYMENT.md` & `README.md` to reflect `BLOCKED` status & certified cloud limits; clean non-forced push to `origin` | `PASSED` (`PASS`) |

## Captive Portal Footer Consistency & Admin Dashboard Recovery After Reboot (`RB-061`)

| Task ID | Task Name | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- |
| `RB-061` | Captive Portal Footer Consistency & `/admin/login` Recovery After Reboot | Match `.rawad-powered-by` in `hotspot/assets/style.css` (`#94a3b8`, `10.5px`, `500`, `0.78`, `transparent`, `border: none`, `padding: 0`) + `?v=20261125` cache-buster on `hotspot/{login,status}.html`; diagnose true root cause of `http://hotspot.rawad.test/admin/login` broken page (`Win10 cable="false"` + HotSpot `64873` intercepting `/admin/login` as unstyled `login.html` + BusyBox `404` on `/admin/login`); apply persistent Lab fix + `--cableconnected1 on` + `/admin-www/admin/login/index.html`; verify live CSS, Admin login (`200`), and full cold Lab reboot persistence | `PASSED` (`PASS`) |

## Supabase Production Migration, Config, Live Cutoff & Security Verification (`RB-062`)

| Task ID | Task Name | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- |
| `RB-062` | Full Supabase Production Migration, Edge Functions, Config & Live Cutoff Tests | Linked CLI to `stlrolkrqtbhkjztxudd` (`eu-west-1`), audited `Rawad Test` parity, dry-ran & applied `schema.sql` via Session Pooler IPv4, synced migration history (`202611180001..202611190001`), set 3 fresh Production secrets, deployed `portal-auth`/`verify-mac`/`admin-api`, updated `admin/`, `hotspot/`, `deploy.rsc`, & `CHR Lab`, passed `30s`/`60s` real internet cutoff (`302` post-expiry, `ACK` `9.70s`/`6.95s`), re-login block (`403`), Baghdad midnight (`Test D/E`), RLS/JWT/HMAC/MAC guards, and full test cleanup (`admins=0, users=0, sessions=0`); physical RB4011 remains `BLOCKED` | `PASSED` (Cloud & CHR Lab) / **`BLOCKED`** (Physical RB4011) |

## Production Finalization, Owner Bootstrap & Full VM E2E Verification (`RB-063`)

| Task ID | Task Name | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- |
| `RB-063` | Production Finalization, `hashim` Owner Bootstrap & Full VM E2E Verification | Verified Production `stlrolkrqtbhkjztxudd` DB (`5` tables, `RLS`, `8` RPCs, `3` migrations) and zero runtime refs to deleted `Rawad Test`; bootstrapped primary owner `hashim` (`site_owner`, `is_super_admin=true`, PBKDF2); verified Admin UI login (`200`, `0` console errors) & 3-tier backend RBAC (`403` guards); verified Captive Portal (`8.1`), `30s`/`60s` real internet cutoff (`9.32s`/`9.05s` delay), `403` re-login block (`8.4`), Baghdad midnight (`8.5`), Admin-initiated revocation cutoff (`1.11s` delay, `8.6`), Cold Reboot persistence (`8.7`), security suite (`9`), and cleanup (`admins=1: hashim`, `users=0`, `sessions=0`); physical RB4011 remains `BLOCKED` | `PASSED` (Production & CHR Lab) / **`BLOCKED`** (Physical RB4011) |
| `RB-064` | Final Verification of Production Migration on Existing Local VM Environment | Verified 17/17 exact file parity (`CHR` vs Git), zero old-project runtime refs (`OLD_REF_RUNTIME_EXIT=1`), local access (`192.168.56.2:8088`, `hotspot.rawad.test`), `hashim` Admin UI login (`200`, 7 views, `0` console errors), Captive Portal `30s` (`9.20s` delay) & `60s` (`7.78s` delay) cutoff, `403` re-login block, Baghdad midnight, Admin revocation (`3.15s` delay), Cold Reboot persistence, and clean DB (`admins=1: hashim`, `users=0`, `sessions=0`) with zero architecture/scope changes; physical RB4011 remains `BLOCKED` | `PASSED` (`PASS`) / **`BLOCKED`** (Physical RB4011) |
