# PROGRESS.md — Rawad Captive Portal

**Branch:** `field-test-preparation`  
**Status:** Strict HTTP 200 Fetch Validation Complete; Verified in GitHub Actions PG 16

## Changes Completed
- **`routeros/deploy.rsc`:** Replaced `[:typeof (...->"code")] = "nothing" || ...` with strict `[:typeof [:tonum (...->"code")]] = "num" && [:tonum (...->"code")] = 200` on all 4 `/tool fetch` paths.
- **`tests/verify_system.mjs`:** Updated `parseAck()` to reject missing `code`, `code: null`, non-200 HTTP codes, `status != 'finished'`, and malformed/out-of-range ACK counts, and verified all 4 fetch paths in `deploy.rsc`.

## Not Tested Locally
- Live MikroTik RB4011 (`ether10`) & Live Supabase Deno Edge Function deployment (`NOT PERFORMED`).
