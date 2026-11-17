# TASKS.md — Rawad Captive Portal (MikroTik HotSpot + Supabase Edge Functions)

**Branch:** `field-test-preparation` (NEVER merge to `main` without explicit approval)

## Completed
- [x] Require strict numeric HTTP `code = 200` (reject missing `code` / `"nothing"` / `null` / non-200) across all 4 `/tool fetch` paths in `routeros/deploy.rsc` (on-login, revocation feed, full ACK batch, final partial ACK batch).
- [x] Update `parseAck()` and RouterOS 4-path HTTP-200 checks in `tests/verify_system.mjs` (rejecting missing `code`, `code: null`, `401`, `500`, `status: 'failed'`, `ACK:0`, `ACK:`, `ACK:1abc`, and out-of-range counts).
- [ ] Live MikroTik RB4011 (`ether10`) + Live Supabase Edge Function integration test (not performed — required before claiming live MikroTik compatibility).
