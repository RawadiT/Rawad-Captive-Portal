/**
 * Real Local PostgreSQL/PostgREST Integration Test using SupabaseDatabaseClient
 *
 * Expects the local test stack (`deployment/docker-compose.field-test.yml`) at http://127.0.0.1:54321
 * and rejects any non-local or production Supabase URL.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const supabaseUrl = process.env.LOCAL_TEST_SUPABASE_URL || 'http://127.0.0.1:54321';

if (
  /\.supabase\.(co|in)/i.test(supabaseUrl) ||
  !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(supabaseUrl)
) {
  throw new Error(`ABORT: Refusing to run integration test against non-local URL: ${supabaseUrl}`);
}

// Mint a local-only test service_role JWT matching deployment/docker-compose.field-test.yml PGRST_JWT_SECRET
function signLocalJwt(role) {
  const secret = process.env.LOCAL_TEST_PGRST_JWT_SECRET || 'field-test-only-postgrest-jwt-secret-32chars-min';
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ role, iss: 'rawad-field-test', exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function randomTestMac() {
  const b = crypto.randomBytes(4);
  return `02:FE:${b[0].toString(16).padStart(2, '0')}:${b[1].toString(16).padStart(2, '0')}:${b[2].toString(16).padStart(2, '0')}:${b[3].toString(16).padStart(2, '0')}`.toUpperCase();
}

async function run() {
  // Check if local PostgREST gateway is reachable (FAIL CLOSED by default)
  try {
    const probe = await fetch(`${supabaseUrl}/rest/v1/`, { method: 'GET' });
    if (!probe.ok && probe.status !== 401 && probe.status !== 404) {
      throw new Error(`Unexpected status ${probe.status}`);
    }
  } catch (err) {
    console.error(
      `FAIL-CLOSED: Local PostgreSQL/PostgREST test service is unavailable at ${supabaseUrl} (${err instanceof Error ? err.message : err}).`
    );
    console.error(
      'Start the local stack first: docker compose -f deployment/docker-compose.field-test.yml up -d'
    );
    process.exitCode = 1;
    return;
  }

  const { SupabaseDatabaseClient } = await import(
    pathToFileURL(path.join(root, 'backend/dist/db/supabaseClient.js')).href
  );
  const { hashPassword } = await import(
    pathToFileURL(path.join(root, 'backend/dist/authentication/password.js')).href
  );

  const serviceKey = signLocalJwt('service_role');
  const db = new SupabaseDatabaseClient(supabaseUrl, serviceKey);

  const deleteByIn = async (table, column, values) => {
    if (values.length === 0) return;
    const encoded = values.map((v) => `"${encodeURIComponent(v)}"`).join(',');
    await fetch(`${supabaseUrl}/rest/v1/${table}?${column}=in.(${encoded})`, {
      method: 'DELETE',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });
  };

  const runSuffix = crypto.randomBytes(4).toString('hex');
  const freeMac = randomTestMac();
  const userMac = randomTestMac();
  const lockName = `local_integ_${Date.now()}_${runSuffix}`;
  const lockOwner = `integ-owner-${runSuffix}`;
  const createdSessionIds = [];
  const createdUserIds = [];
  const createdFreeMacs = [];
  let lockHeld = false;

  try {
    // 1. ping
    assert.equal(await db.ping(), true, 'db.ping() must return true');

    // 2. begin/finalize free session + duplicate MAC rejection
    const cleanFreeMac = freeMac.replace(/:/g, '').toLowerCase();
    const beginFree = await db.beginFreeProvisioning({
      macAddress: freeMac,
      ipAddress: '192.168.20.88',
      hotspotUsername: `free-${cleanFreeMac}`,
      hotspotProfile: `rawad-sess-free-${cleanFreeMac}`,
      durationSeconds: 1800,
    });
    assert.equal(beginFree.allowed, true, 'beginFreeProvisioning must allow fresh MAC');
    assert.ok(beginFree.session_id, 'beginFreeProvisioning must return session_id');
    createdSessionIds.push(beginFree.session_id);

    const finFree = await db.finalizeFreeSession(beginFree.session_id, 1800);
    assert.equal(finFree.allowed, true, 'finalizeFreeSession must succeed');
    assert.equal(finFree.is_new, true, 'finalizeFreeSession must mark is_new=true');
    assert.equal(finFree.mac_address, freeMac, 'finalizeFreeSession must return mac_address');
    createdFreeMacs.push(freeMac);

    const dupFree = await db.beginFreeProvisioning({
      macAddress: freeMac,
      ipAddress: '192.168.20.88',
      hotspotUsername: `free-${cleanFreeMac}`,
      hotspotProfile: `rawad-sess-free-${cleanFreeMac}`,
      durationSeconds: 1800,
    });
    assert.equal(dupFree.allowed, false, 'Second free provisioning for active MAC must be rejected');
    assert.equal(dupFree.conflict_active, true);

    // 3. monitor lock and fenced update
    const lock1 = await db.tryAcquireMonitorLock(lockName, lockOwner, 30);
    assert.equal(lock1.acquired, true, 'tryAcquireMonitorLock must acquire lock');
    lockHeld = true;

    const fencedOk = await db.fencedUpdateSessionStatus(
      beginFree.session_id,
      'expired',
      lockName,
      lockOwner,
      lock1.fence_token
    );
    assert.equal(fencedOk, true, 'fencedUpdateSessionStatus must succeed with valid lock & fence_token');

    const fencedBadToken = await db.fencedUpdateSessionStatus(
      beginFree.session_id,
      'disconnected',
      lockName,
      lockOwner,
      lock1.fence_token + 99
    );
    assert.equal(fencedBadToken, false, 'fencedUpdateSessionStatus must reject wrong fence_token');

    await db.releaseMonitorLock(lockName, lockOwner);
    lockHeld = false;

    // 4. create user
    const usr = await db.createUser({
      username: `integ_user_${Date.now()}_${runSuffix}`,
      password_hash: hashPassword('TestPass123!'),
      duration_minutes: 30,
    });
    createdUserIds.push(usr.id);
    assert.equal(usr.started_at, null, 'New user started_at must be null before first login');

    // 5. begin/finalize user session
    const beginUser = await db.beginUserProvisioning({
      userId: usr.id,
      macAddress: userMac,
      ipAddress: '192.168.20.89',
      hotspotUsername: `usr-${usr.username}`,
      hotspotProfile: `rawad-sess-usr-${usr.id.slice(0, 8)}`,
    });
    assert.equal(beginUser.allowed, true, 'beginUserProvisioning must allow valid user');
    assert.ok(beginUser.session_id);
    createdSessionIds.push(beginUser.session_id);

    const finUser = await db.finalizeUserSession(beginUser.session_id);
    assert.equal(finUser.allowed, true, 'finalizeUserSession must succeed');
    assert.ok(finUser.started_at, 'finalizeUserSession must set started_at on first login');
    assert.ok(finUser.expires_at, 'finalizeUserSession must set expires_at on first login');

    console.log('ALL LOCAL SUPABASE/POSTGRESQL INTEGRATION TESTS PASSED');
  } finally {
    if (lockHeld) {
      await db.releaseMonitorLock(lockName, lockOwner).catch(() => {});
    }
    await deleteByIn('sessions', 'id', createdSessionIds).catch(() => {});
    await deleteByIn('free_quotas', 'mac_address', createdFreeMacs).catch(() => {});
    await deleteByIn('users', 'id', createdUserIds).catch(() => {});
  }
}

run().catch((err) => {
  console.error('Integration test failed:', err);
  process.exitCode = 1;
});
