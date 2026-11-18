# PROGRESS.md — Rawad Captive Portal

**Branch:** `field-test-preparation`  
**Status:** Strict HTTP 200 Fetch Validation Complete; Verified in GitHub Actions PG 16

## Changes Completed
- **`routeros/deploy.rsc`:** Replaced `[:typeof (...->"code")] = "nothing" || ...` with strict `[:typeof [:tonum (...->"code")]] = "num" && [:tonum (...->"code")] = 200` on all 4 `/tool fetch` paths.
- **`tests/verify_system.mjs`:** Updated `parseAck()` to reject missing `code`, `code: null`, non-200 HTTP codes, `status != 'finished'`, and malformed/out-of-range ACK counts, and verified all 4 fetch paths in `deploy.rsc`.

## Not Tested Locally
- Live MikroTik RB4011 (`ether10`) & Live Supabase Deno Edge Function deployment (`NOT PERFORMED`).


## Admin Dashboard Update — 2026-11-18
- Added a three-tier role model: immutable `site_owner`, `general`, and `subordinate`.
- The site owner alone can create, edit, promote/demote, and delete subordinate/general manager accounts. The fixed site-owner account ID is protected by the API.
- All admin roles can list, create, disable, and permanently delete internet accounts. Only site owner/general managers can edit internet-account details and view free-quota records.
- Added manager role selection to the UI, role-aware navigation/actions, the existing company logo, ambient background motion, button transitions, and success/error feedback.
- Backend migration and end-to-end role regression tests are pending application to the Rawad Test project. No production deployment or MikroTik changes performed.
