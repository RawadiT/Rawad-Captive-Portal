# PROGRESS.md — Rawad Captive Portal

**Branch:** `field-test-preparation`  
**Status:** Complete Revocation Lifecycle, SQL State Transitions & Router ACK Verification Implemented

## Verification Boundaries
- **PostgreSQL 16 CI Verification:** Executed automatically via GitHub Actions (`system-test.yml`).
- **Static RouterOS & Edge Function Checks:** Executed in `tests/verify_system.mjs`.
- **Live MikroTik RB4011 Testing:** `NOT PERFORMED` (required in isolated lab before production approval).
- **Live Supabase Edge Function Testing:** `NOT PERFORMED` (required in isolated test project before production approval).
