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

// Check if local PostgREST gateway is reachable
try {
  const probe = await fetch(`${supabaseUrl}/rest/v1/`, { method: 'GET' });
  if (!probe.ok && probe.status !== 401 && probe.status !== 404) {
    throw new Error(`Unexpected status ${probe.status}`);
  }
} catch (err) {
  const msg = `NOT TESTED: Local PostgreSQL/PostgREST test service is not running at ${supabaseUrl} (${err instanceof Error ? err.message : err}).`;
  if (process.env.REQUIRE_LOCAL_SUPABASE === 'true') {
    console.error(msg);
    process.exit(1);
  }
  console.log(msg);
  process.exit(0);
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

const { SupabaseDatabaseClient } = await import(
  pathToFileURL(path.join(root, 'backend/dist/db/supabaseClient.js')).href
);
const { hashPassword } = await import(
  pathToFileURL(path.join(root, 'backend/dist/authentication/password.js')).href
);

const serviceKey = signLocalJwt('service_role');
const db = new SupabaseDatabaseClient(supabaseUrl, serviceKey);

assert.equal(await db.ping(), true);

const mac = 'AA:BB:CC:DD:EE:88';
const beginFree = await db.beginFreeProvisioning({
  macAddress: mac,
  ipAddress: '192.168.20.88',
  hotspotUsername: 'free-aabbccddee88',
  hotspotProfile: 'rawad-sess-free-aabbccddee88',
  durationSeconds: 1800,
});
assert.equal(beginFree.allowed, true);
assert.ok(beginFree.session_id);

const finFree = await db.finalizeFreeSession(beginFree.session_id, 1800);
assert.equal(finFree.allowed, true);
assert.equal(finFree.is_new, true);

const lockName = `local_integ_${Date.now()}`;
const lock1 = await db.tryAcquireMonitorLock(lockName, 'integ-owner', 30);
assert.equal(lock1.acquired, true);
const fencedOk = await db.fencedUpdateSessionStatus(
  beginFree.session_id,
  'expired',
  lockName,
  'integ-owner',
  lock1.fence_token
);
assert.equal(fencedOk, true);
await db.releaseMonitorLock(lockName, 'integ-owner');

const usr = await db.createUser({
  username: `integ_user_${Date.now()}`,
  password_hash: hashPassword('TestPass123!'),
  duration_minutes: 30,
});
assert.equal(usr.started_at, null);

const beginUser = await db.beginUserProvisioning({
  userId: usr.id,
  macAddress: 'AA:BB:CC:DD:EE:89',
  ipAddress: '192.168.20.89',
  hotspotUsername: `usr-${usr.username}`,
  hotspotProfile: `rawad-sess-usr-${usr.id.slice(0, 8)}`,
});
assert.equal(beginUser.allowed, true);
const finUser = await db.finalizeUserSession(beginUser.session_id);
assert.equal(finUser.allowed, true);
assert.ok(finUser.started_at);

console.log('ALL LOCAL SUPABASE/POSTGRESQL INTEGRATION TESTS PASSED');
