/**
 * Real Two-Connection PostgreSQL Concurrency & Fencing Test
 *
 * Requires TEST_DATABASE_URL pointing to a disposable/local PostgreSQL 16 test database
 * (NEVER point this at production Supabase).
 *
 * Usage:
 *   TEST_DATABASE_URL="postgres://postgres:...@127.0.0.1:5432/rawad_test" node tests/verify_fencing_race.mjs
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dbUrl = process.env.TEST_DATABASE_URL?.trim();
if (!dbUrl) {
  console.log('SKIPPED: TEST_DATABASE_URL is not set. Real 2-connection PostgreSQL test was NOT executed.');
  process.exit(0);
}

const root = process.cwd();
const schemaPath = path.join(root, 'supabase', 'schema.sql');
const lockName = `test_fence_lock_${Date.now()}`;
const s1Id = '11111111-1111-4111-8111-111111111101';
const s2Id = '11111111-1111-4111-8111-111111111102';
const missingId = '11111111-1111-4111-8111-111111111199';

function runPsql(sql, { filePath = null } = {}) {
  return new Promise((resolve, reject) => {
    const args = [dbUrl, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
    if (filePath) {
      args.push('-f', filePath);
    } else {
      args.push('-c', sql);
    }
    const child = spawn('psql', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      const endMs = Date.now();
      if (code !== 0) {
        reject(new Error(`psql exited with ${code}: ${stderr.trim() || stdout.trim()}`));
      } else {
        resolve({ stdout: stdout.trim(), endMs });
      }
    });
  });
}

async function cleanup() {
  await runPsql(
    `DELETE FROM public.sessions WHERE id IN ('${s1Id}', '${s2Id}');
     DELETE FROM public.monitor_locks WHERE lock_name = '${lockName}';`
  ).catch(() => {});
}

// Ensure schema is loaded (roles anon/authenticated/service_role created if absent in local PG)
await runPsql(`
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  END $$;
`);
await runPsql('', { filePath: schemaPath });
assert.ok(fs.existsSync(schemaPath));

try {
  await cleanup();

  await runPsql(`
    INSERT INTO public.sessions (
      id, session_type, user_id, mac_address, ip_address,
      hotspot_username, hotspot_profile, started_at, expires_at, status
    ) VALUES
      ('${s1Id}', 'free', NULL, 'AA:BB:CC:DD:EE:91', '192.168.20.91', 'free-test91', 'rawad-test-91', now(), now() + interval '30 minutes', 'active'),
      ('${s2Id}', 'free', NULL, 'AA:BB:CC:DD:EE:92', '192.168.20.92', 'free-test92', 'rawad-test-92', now(), now() + interval '30 minutes', 'active');
  `);

  // 1 & 2. Backend A acquires lock, begins fenced_update_session_status, holds FOR UPDATE for 800ms;
  //        Backend B attempts try_acquire_monitor_lock on an independent connection and MUST block until A commits.
  const acqA = await runPsql(`SELECT acquired, fence_token FROM public.try_acquire_monitor_lock('${lockName}', 'backend-A', 5);`);
  assert.equal(acqA.stdout, 't|1');

  const pA = runPsql(`
    BEGIN;
    SELECT public.fenced_update_session_status('${s1Id}', 'expired', '${lockName}', 'backend-A', 1);
    SELECT pg_sleep(0.8);
    COMMIT;
  `);

  await new Promise((r) => setTimeout(r, 150));
  const pB = runPsql(`SELECT acquired, fence_token FROM public.try_acquire_monitor_lock('${lockName}', 'backend-B', 5);`);

  const [resA, resB] = await Promise.all([pA, pB]);
  assert.ok(resB.endMs >= resA.endMs - 20, `B (${resB.endMs}) must block until A (${resA.endMs}) commits`);
  assert.equal(resB.stdout, 'f|0', 'B cannot steal non-expired lock before A finishes');
  assert.equal((await runPsql(`SELECT status FROM public.sessions WHERE id = '${s1Id}';`)).stdout, 'expired');

  // 3. After lease expires and B acquires lock (fence_token = 2), A's old token 1 MUST be rejected
  await runPsql(`UPDATE public.monitor_locks SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE lock_name = '${lockName}';`);
  const acqB = await runPsql(`SELECT acquired, fence_token FROM public.try_acquire_monitor_lock('${lockName}', 'backend-B', 10);`);
  assert.equal(acqB.stdout, 't|2');

  const staleA = await runPsql(`SELECT public.fenced_update_session_status('${s2Id}', 'expired', '${lockName}', 'backend-A', 1);`);
  assert.equal(staleA.stdout, 'f');
  assert.equal((await runPsql(`SELECT status FROM public.sessions WHERE id = '${s2Id}';`)).stdout, 'active');

  // 4. Reject NULL fence_token, empty lock_name/owner_id, and wrong fence_token
  assert.equal((await runPsql(`SELECT public.fenced_update_session_status('${s2Id}', 'expired', '${lockName}', 'backend-B', NULL::BIGINT);`)).stdout, 'f');
  assert.equal((await runPsql(`SELECT public.fenced_update_session_status('${s2Id}', 'expired', '', 'backend-B', 2);`)).stdout, 'f');
  assert.equal((await runPsql(`SELECT public.fenced_update_session_status('${s2Id}', 'expired', '${lockName}', '', 2);`)).stdout, 'f');
  assert.equal((await runPsql(`SELECT public.fenced_update_session_status('${s2Id}', 'expired', '${lockName}', 'backend-B', 999);`)).stdout, 'f');

  // 5. Reject already-expired lease before starting update
  await runPsql(`UPDATE public.monitor_locks SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE lock_name = '${lockName}';`);
  assert.equal((await runPsql(`SELECT public.fenced_update_session_status('${s2Id}', 'expired', '${lockName}', 'backend-B', 2);`)).stdout, 'f');

  // 6. Reject lease that expires WHILE waiting on the FOR UPDATE row lock
  await runPsql(`UPDATE public.monitor_locks SET lease_expires_at = clock_timestamp() + interval '0.4 seconds' WHERE lock_name = '${lockName}';`);
  const holder = runPsql(`
    BEGIN;
    SELECT 1 FROM public.monitor_locks WHERE lock_name = '${lockName}' FOR UPDATE;
    SELECT pg_sleep(0.8);
    COMMIT;
  `);
  await new Promise((r) => setTimeout(r, 100));
  const waiter = runPsql(`SELECT public.fenced_update_session_status('${s2Id}', 'expired', '${lockName}', 'backend-B', 2);`);
  const [, waiterRes] = await Promise.all([holder, waiter]);
  assert.equal(waiterRes.stdout, 'f', 'Lease that expired while waiting for row lock must be rejected');
  assert.equal((await runPsql(`SELECT status FROM public.sessions WHERE id = '${s2Id}';`)).stdout, 'active');

  // 7. Reject invalid p_status
  await runPsql(`UPDATE public.monitor_locks SET lease_expires_at = clock_timestamp() + interval '10 seconds' WHERE lock_name = '${lockName}';`);
  await assert.rejects(
    () => runPsql(`SELECT public.fenced_update_session_status('${s2Id}', 'invalid_status', '${lockName}', 'backend-B', 2);`),
    /Invalid session status/
  );

  // 8. Return false when session does not exist
  assert.equal((await runPsql(`SELECT public.fenced_update_session_status('${missingId}', 'expired', '${lockName}', 'backend-B', 2);`)).stdout, 'f');

  console.log('ALL REAL 2-CONNECTION POSTGRESQL FENCING TESTS PASSED (8/8)');
} finally {
  await cleanup();
}
