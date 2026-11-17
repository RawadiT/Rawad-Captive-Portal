# TASKS.md — Rawad Captive Portal (MikroTik HotSpot + Supabase Edge Functions)

**Branch:** `field-test-preparation` (NEVER merge to `main` without explicit approval)

## Completed
- [x] Restrict HotSpot active removal in `routeros/deploy.rsc` (`rawad-sync-revocations` & `on-login`) to `server="rawad-guest-hotspot"` + exact `mac-address` + `address`, preserving `rawad-verified` (`rawad-guest-portal`) address-list scoping.
- [x] Require `status = "finished"`, HTTP `code = 200` (when present), `ACK:` prefix, digits-only suffix (`^[0-9]+$`), and `1..batchCount` range for both revocation feed and full/partial ACK batches in `routeros/deploy.rsc`.
- [x] Expand `tests/verify_system.mjs` behavioral ACK tests (HTTP 200/401/429/500, `status=failed`, `ACK:0`, empty/malformed/out-of-range counts) and HotSpot/address-list scope checks.
- [ ] Live MikroTik RB4011 (`ether10`) + Live Supabase Edge Function integration test (not performed — required before production approval).
