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

// SQL schema checks: NO destructive DROP TABLE CASCADE, NO created_at lookback in get_revoked_sessions, Asia/Baghdad daily quota, RLS
assert.ok(!/DROP TABLE\b/i.test(schemaSql), 'schema.sql must NOT drop tables on re-apply');
assert.ok(!/s\.created_at\s*>=\s*v_now\s*-\s*make_interval/i.test(schemaSql), 'get_revoked_sessions must NOT filter by s.created_at lookback');
assert.match(deployRsc, /\$batchCount >= 10/);
assert.match(deployRsc, /!= \\"ACK:\\"/);
assert.match(schemaSql, /AT TIME ZONE 'Asia\/Baghdad'/i);
assert.match(schemaSql, /PRIMARY KEY \(mac_address, quota_date\)/i);
assert.match(schemaSql, /ALTER TABLE public\.free_quotas ENABLE ROW LEVEL SECURITY/i);
assert.match(schemaSql, /GRANT EXECUTE ON FUNCTION public\.request_free_quota\(TEXT, TEXT, INTEGER, TIMESTAMPTZ\) TO service_role/i);
assert.match(schemaSql, /GRANT EXECUTE ON FUNCTION public\.verify_mac_authorization\(TEXT, TEXT, TIMESTAMPTZ\) TO service_role/i);
assert.match(schemaSql, /GRANT EXECUTE ON FUNCTION public\.get_revoked_sessions\(TIMESTAMPTZ\) TO service_role/i);
assert.match(schemaSql, /GRANT EXECUTE ON FUNCTION public\.ack_revoked_sessions\(UUID\[\]\) TO service_role/i);

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

    // 1. Genuinely old (+2h) active session whose user is disabled 2 hours later -> get_revoked_sessions MUST catch it!
    const t0 = '2026-11-17T08:00:00Z';
    const tPlus2h = '2026-11-17T10:00:00Z';
    const tPlus4h = '2026-11-17T12:00:00Z';
    const uidLong = pgExec(`INSERT INTO public.users (username, password_hash, duration_minutes) VALUES ('${testUser}_long', 'pbkdf2:00:00', 180) RETURNING id;`);
    const macLong = '02:AA:BB:CC:DD:04';
    const sessLong = pgExec(`SELECT session_id FROM public.authorize_user_login('${uidLong}', '${macLong}', '192.168.20.14', '${t0}'::timestamptz);`);
    pgExec(`SELECT public.verify_mac_authorization('${macLong}', '192.168.20.14', '${t0}'::timestamptz);`);
    pgExec(`UPDATE public.sessions SET created_at = '${t0}'::timestamptz WHERE id = '${sessLong}';`);
    const ageLongSec = Number(pgExec(`SELECT FLOOR(EXTRACT(EPOCH FROM ('${tPlus2h}'::timestamptz - created_at))) FROM public.sessions WHERE id = '${sessLong}';`));
    assert.ok(ageLongSec >= 7200, `Expected sessLong age >= 7200s, got ${ageLongSec}s`);

    // Advance 2 hours -> disable user -> must appear in get_revoked_sessions immediately regardless of created_at
    pgExec(`UPDATE public.users SET is_disabled = true WHERE id = '${uidLong}';`);
    const rev1 = pgExec(`SELECT session_id || '|' || mac_address || '|' || ip_address FROM public.get_revoked_sessions('${tPlus2h}'::timestamptz);`);
    assert.ok(rev1.includes(`${sessLong}|${macLong}|192.168.20.14`), '2h-old disabled session must appear in get_revoked_sessions');

    // Simulate router unreachable / failed ACK -> calling get_revoked_sessions again MUST still return it!
    const revRetry = pgExec(`SELECT session_id FROM public.get_revoked_sessions('${tPlus2h}'::timestamptz);`);
    assert.ok(revRetry.includes(sessLong), 'Unacknowledged revocation must NOT be lost on failed ACK');

    // Acknowledge revocation -> must NOT be returned again
    const ackCount = Number(pgExec(`SELECT public.ack_revoked_sessions(ARRAY['${sessLong}']::uuid[]);`));
    assert.equal(ackCount, 1);
    const revAfterAck = pgExec(`SELECT session_id FROM public.get_revoked_sessions('${tPlus2h}'::timestamptz);`);
    assert.ok(!revAfterAck.includes(sessLong), 'Acknowledged revocation must NOT be returned repeatedly');

    // 2. Genuinely old (+4h) session expiring 4 hours after creation (duration 180m = 3h)
    const uidExp = pgExec(`INSERT INTO public.users (username, password_hash, duration_minutes) VALUES ('${testUser}_exp', 'pbkdf2:00:00', 180) RETURNING id;`);
    const macExp = '02:AA:BB:CC:DD:05';
    const sessExp = pgExec(`SELECT session_id FROM public.authorize_user_login('${uidExp}', '${macExp}', '192.168.20.15', '${t0}'::timestamptz);`);
    pgExec(`SELECT public.verify_mac_authorization('${macExp}', '192.168.20.15', '${t0}'::timestamptz);`);
    pgExec(`UPDATE public.sessions SET created_at = '${t0}'::timestamptz WHERE id = '${sessExp}';`);
    const expChecks = pgExec(`SELECT (EXTRACT(EPOCH FROM ('${tPlus4h}'::timestamptz - created_at)) >= 14400)::text || '|' || (expires_at < '${tPlus4h}'::timestamptz)::text FROM public.sessions WHERE id = '${sessExp}';`);
    assert.equal(expChecks, 't|t', 'sessExp must have created_at >= 4h older than p_now and expires_at < p_now');
    const revExp = pgExec(`SELECT session_id FROM public.get_revoked_sessions('${tPlus4h}'::timestamptz);`);
    assert.ok(revExp.includes(sessExp), 'Expired session long after creation must appear in get_revoked_sessions');
    pgExec(`SELECT public.ack_revoked_sessions(ARRAY['${sessExp}']::uuid[]);`);

    // Unknown MAC without prior portal-auth -> verify_mac_authorization denies (prevents rawad-gate bypass!)
    const vUnknown = pgExec(`SELECT allowed, remaining_seconds FROM public.verify_mac_authorization('02:FF:FF:FF:FF:FF', '192.168.20.99', '2026-11-17T11:30:00Z'::timestamptz);`);
    assert.equal(vUnknown, 'f|0');

    // Idempotent re-apply of schema.sql MUST preserve existing users, free_quotas, AND sessions (including revoked_at & revocation_ack_at)!
    const usersBefore = Number(pgExec(`SELECT COUNT(*) FROM public.users WHERE id IN ('${uid}', '${uidLong}', '${uidExp}');`));
    const quotasBefore = Number(pgExec(`SELECT COUNT(*) FROM public.free_quotas WHERE mac_address = '${macSameDay}';`));
    const sessionsBefore = Number(pgExec(`SELECT COUNT(*) FROM public.sessions WHERE id IN ('${sessLong}', '${sessExp}') AND revoked_at IS NOT NULL AND revocation_ack_at IS NOT NULL;`));
    assert.equal(usersBefore, 3);
    assert.ok(quotasBefore >= 1);
    assert.equal(sessionsBefore, 2);

    pgExec(schemaSql);

    const usersAfter = Number(pgExec(`SELECT COUNT(*) FROM public.users WHERE id IN ('${uid}', '${uidLong}', '${uidExp}');`));
    const quotasAfter = Number(pgExec(`SELECT COUNT(*) FROM public.free_quotas WHERE mac_address = '${macSameDay}';`));
    const sessionsAfter = Number(pgExec(`SELECT COUNT(*) FROM public.sessions WHERE id IN ('${sessLong}', '${sessExp}') AND revoked_at IS NOT NULL AND revocation_ack_at IS NOT NULL;`));
    assert.equal(usersAfter, usersBefore, 'Re-applying schema.sql must preserve existing users');
    assert.equal(quotasAfter, quotasBefore, 'Re-applying schema.sql must preserve existing free_quotas');
    assert.equal(sessionsAfter, sessionsBefore, 'Re-applying schema.sql must preserve sessions including revoked_at & revocation_ack_at');

    const stillExhausted = pgExec(`SELECT allowed, remaining_seconds FROM public.request_free_quota('${macSameDay}', '192.168.20.11', 1800, '2026-11-17T18:35:00Z'::timestamptz);`);
    assert.equal(stillExhausted, 'f|0', 'Consumed free quota must remain exhausted after schema.sql re-apply');

    console.log('POSTGRESQL 16 SCHEMA & EDGE-FUNCTION RPC TESTS PASSED');
  } finally {
    pgExec(`
      DELETE FROM public.sessions WHERE mac_address IN ('${testMac1}', '${testMac2}', '02:AA:BB:CC:DD:03', '02:AA:BB:CC:DD:04', '02:AA:BB:CC:DD:05');
      DELETE FROM public.free_quotas WHERE mac_address IN ('${testMac1}', '02:AA:BB:CC:DD:03');
      DELETE FROM public.users WHERE username LIKE '${testUser}%';
    `);
  }
} else {
  console.log('SKIPPED: No local PostgreSQL test instance available; static checks only.');
}

console.log('ALL SYSTEM VERIFICATIONS PASSED');
