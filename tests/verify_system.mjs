/**
 * Permanent System Verification Suite — Rawad Captive Portal
 * Architecture: MikroTik HotSpot UI (hotspot/) + Supabase PostgreSQL & Edge Functions + Static Admin UI (admin/)
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

// ============================================================================
// 1. STATIC & SECURITY CHECKS (hotspot/, admin/, supabase/, routeros/)
// ============================================================================
const loginHtml = fs.readFileSync(path.join(root, 'hotspot/login.html'), 'utf8');
const portalJs = fs.readFileSync(path.join(root, 'hotspot/assets/portal.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
const schemaSql = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
const deployRsc = fs.readFileSync(path.join(root, 'routeros/deploy.rsc'), 'utf8');
const rollbackRsc = fs.readFileSync(path.join(root, 'routeros/rollback.rsc'), 'utf8');

// No external CDNs, no service_role key, no localStorage passwords in hotspot/ or admin/
for (const [name, content] of [
  ['hotspot/login.html', loginHtml],
  ['hotspot/assets/portal.js', portalJs],
  ['admin/index.html', adminHtml],
  ['admin/admin.js', adminJs],
]) {
  assert.ok(!/service_role/i.test(content), `${name} must never reference service_role`);
  assert.ok(!/ROUTER_SHARED_SECRET|routerSecret/i.test(content), `${name} must never contain router secret`);
  assert.ok(!/localStorage/i.test(content), `${name} must not store credentials in localStorage`);
  assert.ok(!/https?:\/\/(cdn\.|fonts\.googleapis|unpkg\.com|jsdelivr)/i.test(content), `${name} must not load external CDNs`);
}

// Two options only on hotspot/login.html
assert.match(loginHtml, /id="btn-free"/);
assert.match(loginHtml, /id="login-form"/);
assert.match(loginHtml, /\$\(link-login-only\)/);
assert.match(loginHtml, /\$\(mac\)/);

// Portal JS prevents duplicate concurrent submits
assert.match(portalJs, /if \(inFlight\) return;/);
assert.match(portalJs, /btnFree\.disabled = busy/);

// Edge functions exist and enforce security
for (const fnPath of [
  'supabase/functions/_shared/crypto.ts',
  'supabase/functions/portal-auth/index.ts',
  'supabase/functions/verify-mac/index.ts',
  'supabase/functions/admin-api/index.ts',
]) {
  assert.ok(fs.existsSync(path.join(root, fnPath)), `Missing Edge Function file: ${fnPath}`);
}
const verifyMacTs = fs.readFileSync(path.join(root, 'supabase/functions/verify-mac/index.ts'), 'utf8');
assert.match(verifyMacTs, /x-router-secret/);
assert.match(verifyMacTs, /constantTimeEqual/);
assert.match(verifyMacTs, /ALLOW:/);
assert.match(verifyMacTs, /get_revoked_sessions/);

const portalAuthTs = fs.readFileSync(path.join(root, 'supabase/functions/portal-auth/index.ts'), 'utf8');
assert.ok(!/error\.message/.test(portalAuthTs), 'portal-auth must not leak raw DB error.message to client');

// RouterOS deploy.rsc enforces ether10 scope, DNS gate, Walled Garden to Supabase, Fail-Closed on-login, and revocation scheduler
assert.match(deployRsc, /:local guestIf "ether10"/);
assert.match(deployRsc, /src-address-list="!rawad-verified" action=drop/);
assert.match(deployRsc, /\/functions\/v1\/verify-mac\?mac=/);
assert.match(deployRsc, /rawad-sync-revocations/);
assert.match(deployRsc, /x-router-secret:/);
assert.match(rollbackRsc, /\/system script remove \$stateSid/);
assert.match(rollbackRsc, /\/system script remove \$anchorSid/);
assert.match(rollbackRsc, /\$rawadCreatedSched = true/);

// SQL schema checks: NO destructive DROP TABLE CASCADE, Asia/Baghdad daily quota, RLS, service_role-only grants
assert.ok(!/DROP TABLE\b/i.test(schemaSql), 'schema.sql must NOT drop tables on re-apply');
assert.match(schemaSql, /AT TIME ZONE 'Asia\/Baghdad'/i);
assert.match(schemaSql, /PRIMARY KEY \(mac_address, quota_date\)/i);
assert.match(schemaSql, /ALTER TABLE public\.free_quotas ENABLE ROW LEVEL SECURITY/i);
assert.match(schemaSql, /GRANT EXECUTE ON FUNCTION public\.request_free_quota\(TEXT, TEXT, INTEGER, TIMESTAMPTZ\) TO service_role/i);
assert.match(schemaSql, /GRANT EXECUTE ON FUNCTION public\.verify_mac_authorization\(TEXT, TEXT, TIMESTAMPTZ\) TO service_role/i);
assert.match(schemaSql, /GRANT EXECUTE ON FUNCTION public\.get_revoked_sessions\(INTEGER\) TO service_role/i);

// ============================================================================
// 2. POSTGRESQL 16 REAL SQL & BEHAVIORAL VERIFICATION (via TEST_DATABASE_URL or local Docker PG)
// ============================================================================
let pgExec = null;
if (process.env.TEST_DATABASE_URL) {
  pgExec = (sql) =>
    execFileSync('psql', [process.env.TEST_DATABASE_URL, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
      encoding: 'utf8',
    }).trim();
} else {
  const probe = spawnSync('docker', ['exec', 'deployment-postgres-1', 'pg_isready', '-U', 'postgres', '-d', 'rawad_test'], {
    encoding: 'utf8',
  });
  if (probe.status === 0) {
    pgExec = (sql) =>
      execFileSync('docker', ['exec', '-i', 'deployment-postgres-1', 'psql', '-U', 'postgres', '-d', 'rawad_test', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], {
        input: sql,
        encoding: 'utf8',
      }).trim();
  }
}

if (pgExec) {
  // Apply schema.sql cleanly
  pgExec(schemaSql);

  const testMac1 = '02:AA:BB:CC:DD:01';
  const testMac2 = '02:AA:BB:CC:DD:02';
  const testUser = `sys_user_${Date.now()}`;
  try {
    // 2a. Free quota: Day 1 in Baghdad (2026-11-17 20:50:00Z = 2026-11-17 23:50:00+03:00 Baghdad)
    const day1Start = '2026-11-17T20:50:00Z';
    const r1 = pgExec(`SELECT allowed, is_new, remaining_seconds FROM public.request_free_quota('${testMac1}', '192.168.20.10', 1800, '${day1Start}'::timestamptz);`);
    assert.equal(r1, 't|t|1800');

    // verify_mac_authorization succeeds immediately after portal-auth
    const v1 = pgExec(`SELECT allowed, remaining_seconds, session_type FROM public.verify_mac_authorization('${testMac1}', '192.168.20.10', '${day1Start}'::timestamptz);`);
    assert.equal(v1, 't|1800|free');

    // 2b. Reconnect 10 mins later (same Baghdad day: 2026-11-17 23:59:00+03:00 -> 20:59:00Z): remaining = 1260s, is_new = false
    const day1Later = '2026-11-17T20:59:00Z';
    const r2 = pgExec(`SELECT allowed, is_new, remaining_seconds FROM public.request_free_quota('${testMac1}', '192.168.20.10', 1800, '${day1Later}'::timestamptz);`);
    assert.equal(r2, 't|f|1260');

    // 2c. After 30 mins same Baghdad day (2026-11-17 21:25:00Z -> 2026-11-18 00:25:00+03:00 is NEXT Baghdad day! Wait: test 31m before midnight Baghdad!)
    // Use 2026-11-17 18:00:00Z (21:00 Baghdad) -> +35m = 18:35:00Z (21:35 Baghdad, still same Baghdad day!)
    const macSameDay = '02:AA:BB:CC:DD:03';
    pgExec(`SELECT public.request_free_quota('${macSameDay}', '192.168.20.11', 1800, '2026-11-17T18:00:00Z'::timestamptz);`);
    const exhaustedSameDay = pgExec(`SELECT allowed, remaining_seconds FROM public.request_free_quota('${macSameDay}', '192.168.20.11', 1800, '2026-11-17T18:35:00Z'::timestamptz);`);
    assert.equal(exhaustedSameDay, 'f|0', 'Second quota on same Baghdad day must be denied');

    // 2d. Next Baghdad day after midnight (2026-11-17T21:01:00Z = 2026-11-18 00:01:00+03:00 Baghdad) -> new 1800s quota allowed!
    const nextBaghdadDay = pgExec(`SELECT allowed, is_new, remaining_seconds FROM public.request_free_quota('${macSameDay}', '192.168.20.11', 1800, '2026-11-17T21:01:00Z'::timestamptz);`);
    assert.equal(nextBaghdadDay, 't|t|1800', 'Quota must reset at midnight Asia/Baghdad');

    // 2e. User account: duration starts ONLY on first login, wall-clock real time, disabled user blocked
    const uid = pgExec(`INSERT INTO public.users (username, password_hash, duration_minutes) VALUES ('${testUser}', 'pbkdf2:00:00', 180) RETURNING id;`);
    const u1 = pgExec(`SELECT allowed, remaining_seconds FROM public.authorize_user_login('${uid}', '${testMac2}', '192.168.20.12', '2026-11-17T10:00:00Z'::timestamptz);`);
    assert.equal(u1, 't|10800');

    // Reconnect 1 hour later -> 7200s remaining (wall-clock!)
    const u2 = pgExec(`SELECT allowed, remaining_seconds FROM public.authorize_user_login('${uid}', '${testMac2}', '192.168.20.12', '2026-11-17T11:00:00Z'::timestamptz);`);
    assert.equal(u2, 't|7200');

    // Expired after 3 hours -> denied
    const u3 = pgExec(`SELECT allowed, remaining_seconds FROM public.authorize_user_login('${uid}', '${testMac2}', '192.168.20.12', '2026-11-17T13:01:00Z'::timestamptz);`);
    assert.equal(u3, 'f|0');

    // Disabled user -> verify_mac_authorization fails closed AND get_revoked_sessions returns MAC|IP for router cleanup
    pgExec(`UPDATE public.users SET is_disabled = true, expires_at = '2026-11-18T00:00:00Z'::timestamptz WHERE id = '${uid}';`);
    pgExec(`SELECT public.authorize_user_login('${uid}', '${testMac2}', '192.168.20.12', '2026-11-17T11:30:00Z'::timestamptz);`);
    const vDisabled = pgExec(`SELECT allowed, remaining_seconds FROM public.verify_mac_authorization('${testMac2}', '192.168.20.12', '2026-11-17T11:30:00Z'::timestamptz);`);
    assert.equal(vDisabled, 'f|0');

    // Also test an active session whose user is disabled mid-session -> get_revoked_sessions picks it up
    pgExec(`UPDATE public.users SET is_disabled = false WHERE id = '${uid}';`);
    pgExec(`SELECT public.authorize_user_login('${uid}', '${testMac2}', '192.168.20.12', '2026-11-17T11:30:00Z'::timestamptz);`);
    pgExec(`SELECT public.verify_mac_authorization('${testMac2}', '192.168.20.12', '2026-11-17T11:30:00Z'::timestamptz);`);
    pgExec(`UPDATE public.users SET is_disabled = true WHERE id = '${uid}';`);
    const revokedList = pgExec(`SELECT mac_address || '|' || ip_address FROM public.get_revoked_sessions(300);`);
    assert.ok(revokedList.includes(`${testMac2}|192.168.20.12`), 'Disabled active user must appear in get_revoked_sessions');

    // Unknown MAC without prior portal-auth -> verify_mac_authorization denies (prevents rawad-gate bypass!)
    const vUnknown = pgExec(`SELECT allowed, remaining_seconds FROM public.verify_mac_authorization('02:FF:FF:FF:FF:FF', '192.168.20.99', '2026-11-17T11:30:00Z'::timestamptz);`);
    assert.equal(vUnknown, 'f|0');

    // Idempotent re-apply of schema.sql MUST preserve existing users, free_quotas, and sessions!
    const usersBefore = Number(pgExec(`SELECT COUNT(*) FROM public.users WHERE id = '${uid}';`));
    const quotasBefore = Number(pgExec(`SELECT COUNT(*) FROM public.free_quotas WHERE mac_address = '${macSameDay}';`));
    assert.equal(usersBefore, 1);
    assert.ok(quotasBefore >= 1);

    pgExec(schemaSql);

    const usersAfter = Number(pgExec(`SELECT COUNT(*) FROM public.users WHERE id = '${uid}';`));
    const quotasAfter = Number(pgExec(`SELECT COUNT(*) FROM public.free_quotas WHERE mac_address = '${macSameDay}';`));
    assert.equal(usersAfter, 1, 'Re-applying schema.sql must preserve existing users');
    assert.equal(quotasAfter, quotasBefore, 'Re-applying schema.sql must preserve existing free_quotas');

    const stillExhausted = pgExec(`SELECT allowed, remaining_seconds FROM public.request_free_quota('${macSameDay}', '192.168.20.11', 1800, '2026-11-17T18:35:00Z'::timestamptz);`);
    assert.equal(stillExhausted, 'f|0', 'Consumed free quota must remain exhausted after schema.sql re-apply');

    console.log('POSTGRESQL 16 SCHEMA & EDGE-FUNCTION RPC TESTS PASSED');
  } finally {
    pgExec(`
      DELETE FROM public.sessions WHERE mac_address IN ('${testMac1}', '${testMac2}', '02:AA:BB:CC:DD:03');
      DELETE FROM public.free_quotas WHERE mac_address IN ('${testMac1}', '02:AA:BB:CC:DD:03');
      DELETE FROM public.users WHERE username = '${testUser}';
    `);
  }
} else {
  console.log('SKIPPED: No local PostgreSQL test instance available; static checks only.');
}

console.log('ALL SYSTEM VERIFICATIONS PASSED');
