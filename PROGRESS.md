# PROGRESS.md — Rawad Captive Portal

**Branch:** `field-test-preparation`  
**Status:** Final RouterOS ACK Scope & HTTP Status Hardening Complete; Verified in GitHub Actions PG 16

## Changes Completed
- **`routeros/deploy.rsc`:** Scoped all HotSpot active removals to `server="rawad-guest-hotspot" && mac-address=... && address=...`; enforced HTTP `code = 200` (when present), `status = "finished"`, digits-only `ACK:<n>`, and `1 <= n <= batchCount` across feed and full/partial ACK batches.
- **`tests/verify_system.mjs`:** Added behavioral tests for HTTP 401/500/429, `status=failed`, `ACK:0`, empty/malformed/out-of-range counts, and HotSpot/address-list scoping.

## Not Tested Locally
- Live MikroTik RB4011 (`ether10`) & Live Supabase Deno Edge Function deployment (`NOT PERFORMED`).
