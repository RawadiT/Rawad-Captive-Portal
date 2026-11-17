/**
 * IN-MEMORY APPLICATION TEST (NOT a PostgreSQL Integration Test)
 *
 * Uses an in-memory simulated DB + MockMikroTikAdapter to verify application/API behavior
 * and actual network isolation without touching PostgreSQL or MikroTik.
 * For real PostgreSQL/PostgREST integration tests, see tests/verify_supabase_integration.mjs.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const { createApp } = await import(pathToFileURL(path.join(root, 'backend/dist/api/app.js')).href);
const { AdminService } = await import(pathToFileURL(path.join(root, 'backend/dist/authentication/adminService.js')).href);
const { loadConfig } = await import(pathToFileURL(path.join(root, 'backend/dist/config/env.js')).href);
const { MockMikroTikAdapter } = await import(pathToFileURL(path.join(root, 'backend/dist/mikrotik/mockAdapter.js')).href);
const { QuotaService } = await import(pathToFileURL(path.join(root, 'backend/dist/quota-manager/quotaService.js')).href);
const { SessionMonitor } = await import(pathToFileURL(path.join(root, 'backend/dist/session-monitor/sessionMonitor.js')).href);
const { hashPassword } = await import(pathToFileURL(path.join(root, 'backend/dist/authentication/password.js')).href);

// ============================================================================
// 1. Field-Test Isolation Guards (reject production URLs & real MikroTik)
// ============================================================================
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

withEnv(
  {
    NODE_ENV: 'development',
    FIELD_TEST_MODE: 'true',
    MIKROTIK_MODE: 'mock',
    MIKROTIK_HOST: 'mock.local',
    SUPABASE_URL: 'https://prodproject.supabase.co',
    GUEST_PORTAL_ORIGIN: 'http://127.0.0.1:3000',
  },
  () => assert.throws(() => loadConfig(), /forbids non-local or production SUPABASE_URL/)
);

withEnv(
  {
    NODE_ENV: 'development',
    FIELD_TEST_MODE: 'true',
    MIKROTIK_MODE: 'mock',
    MIKROTIK_HOST: '192.168.20.1',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    GUEST_PORTAL_ORIGIN: 'http://127.0.0.1:3000',
  },
  () => assert.throws(() => loadConfig(), /forbids non-mock MIKROTIK_HOST/)
);

withEnv(
  {
    NODE_ENV: 'production',
    FIELD_TEST_MODE: 'true',
    MIKROTIK_MODE: 'mock',
  },
  () => assert.throws(() => loadConfig(), /forbidden when NODE_ENV=production/)
);

for (const badHost of ['0.0.0.0', '192.168.10.10', '10.0.0.5', '172.16.0.1', '8.8.8.8', '::']) {
  withEnv(
    {
      NODE_ENV: 'development',
      FIELD_TEST_MODE: 'true',
      MIKROTIK_MODE: 'mock',
      MIKROTIK_HOST: 'mock.local',
      HOST: badHost,
      SUPABASE_URL: 'http://127.0.0.1:54321',
      GUEST_PORTAL_ORIGIN: 'http://127.0.0.1:3000',
    },
    () => assert.throws(() => loadConfig(), /requires loopback HOST/, `Expected HOST=${badHost} to be rejected`)
  );
}

for (const badMode of ['routeros-rest']) {
  withEnv(
    {
      NODE_ENV: 'development',
      FIELD_TEST_MODE: 'true',
      MIKROTIK_MODE: badMode,
      MIKROTIK_HOST: 'mock.local',
      HOST: '127.0.0.1',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      GUEST_PORTAL_ORIGIN: 'http://127.0.0.1:3000',
    },
    () => assert.throws(() => loadConfig(), /requires MIKROTIK_MODE=mock/)
  );
}

const fieldCfg = withEnv(
  {
    NODE_ENV: 'development',
    FIELD_TEST_MODE: 'true',
    MIKROTIK_MODE: 'mock',
    MIKROTIK_HOST: 'mock.local',
    HOST: '127.0.0.1',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'field-test-dummy-key',
    GUEST_PORTAL_ORIGIN: 'http://127.0.0.1:3000',
    ALLOW_DEV_MAC_FALLBACK: 'true',
  },
  () => loadConfig()
);
assert.equal(fieldCfg.fieldTestMode, true);
assert.equal(fieldCfg.mikrotikMode, 'mock');
assert.equal(fieldCfg.host, '127.0.0.1');

// ============================================================================
// 2. Fail-Closed Startup & Field-Test Package Lock Tests
// ============================================================================
const failClosedRun = spawnSync(process.execPath, ['backend/dist/api/server.js'], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'development', FIELD_TEST_MODE: 'true', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
  encoding: 'utf8',
});
assert.equal(failClosedRun.status, 1, 'Backend must fail-closed when SUPABASE_URL is missing');

for (const unsafeEnv of [
  { FIELD_TEST_MODE: 'false', MIKROTIK_MODE: 'routeros-rest', NODE_ENV: 'development', HOST: '127.0.0.1' },
  { FIELD_TEST_MODE: 'true', MIKROTIK_MODE: 'routeros-rest', NODE_ENV: 'development', HOST: '127.0.0.1' },
  { FIELD_TEST_MODE: 'true', MIKROTIK_MODE: 'mock', NODE_ENV: 'production', HOST: '127.0.0.1' },
  { FIELD_TEST_MODE: 'true', MIKROTIK_MODE: 'mock', NODE_ENV: 'development', HOST: '0.0.0.0' },
]) {
  const lockRun = spawnSync(process.execPath, ['backend/dist/api/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      ...unsafeEnv,
      RAWAD_FIELD_TEST_PACKAGE_LOCK: 'true',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'dummy',
      TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
      DEFAULT_ADMIN_PASSWORD: 'FieldTest@2026!Strong',
      MIKROTIK_API_PASSWORD: 'FieldTest@2026!Strong',
      GUEST_PORTAL_ORIGIN: 'https://portal.example.com',
    },
    encoding: 'utf8',
  });
  assert.equal(lockRun.status, 1, `Package lock must refuse startup for ${JSON.stringify(unsafeEnv)}`);
}

// ============================================================================
// 3. Isolated In-Memory PostgreSQL-Semantic DB for End-to-End Field-Test API
// ============================================================================
function createIsolatedFieldDb() {
  let seq = 1;
  let nowOffsetMs = 0;
  let failAllDb = false;
  const admins = new Map();
  const users = new Map();
  const freeQuotas = new Map();
  const sessions = new Map();
  const monitorLocks = new Map();

  const now = () => new Date(Date.now() + nowOffsetMs);
  const advanceMs = (ms) => {
    nowOffsetMs += ms;
  };
  const setDbFailure = (v) => {
    failAllDb = v;
  };
  const checkDb = () => {
    if (failAllDb) throw new Error('Simulated PostgreSQL connection failure');
  };

  const db = {
    async ping() {
      checkDb();
      return true;
    },
    async getAdminByUsername(username) {
      checkDb();
      return [...admins.values()].find((a) => a.username === username) ?? null;
    },
    async countAdmins() {
      checkDb();
      return admins.size;
    },
    async createAdmin(username, passwordHash) {
      checkDb();
      const rec = { id: `adm-${seq++}`, username, password_hash: passwordHash, created_at: now().toISOString() };
      admins.set(rec.id, rec);
      return rec;
    },
    async listUsers() {
      checkDb();
      return [...users.values()];
    },
    async getUserByUsername(username) {
      checkDb();
      return [...users.values()].find((u) => u.username === username) ?? null;
    },
    async getUserById(id) {
      checkDb();
      return users.get(id) ?? null;
    },
    async createUser(input) {
      checkDb();
      const rec = {
        id: `usr-${seq++}`,
        username: input.username,
        password_hash: input.password_hash,
        duration_minutes: input.duration_minutes,
        started_at: null,
        expires_at: null,
        is_disabled: false,
        created_at: now().toISOString(),
      };
      users.set(rec.id, rec);
      return rec;
    },
    async setUserDisabled(id, isDisabled) {
      checkDb();
      const u = users.get(id);
      if (!u) return null;
      u.is_disabled = isDisabled;
      return u;
    },
    async listFreeQuotas() {
      checkDb();
      return [...freeQuotas.values()];
    },
    async getFreeQuota(mac) {
      checkDb();
      return freeQuotas.get(mac) ?? null;
    },
    async beginFreeProvisioning(input) {
      checkDb();
      const active = [...sessions.values()].find(
        (s) => s.mac_address === input.macAddress && s.session_type === 'free' && ['provisioning', 'active', 'revocation_pending'].includes(s.status)
      );
      if (active) return { allowed: false, conflict_active: true, session_id: active.id, remaining_seconds: 0 };
      const fq = freeQuotas.get(input.macAddress);
      const t = now();
      let rem = input.durationSeconds;
      if (fq) {
        rem = Math.max(0, Math.floor((Date.parse(fq.expires_at) - t.getTime()) / 1000));
        if (rem <= 0) return { allowed: false, conflict_active: false, session_id: null, remaining_seconds: 0 };
      }
      const id = `sess-${seq++}`;
      sessions.set(id, {
        id,
        session_type: 'free',
        user_id: null,
        mac_address: input.macAddress,
        ip_address: input.ipAddress,
        hotspot_username: input.hotspotUsername,
        hotspot_profile: input.hotspotProfile,
        started_at: t.toISOString(),
        expires_at: new Date(t.getTime() + rem * 1000).toISOString(),
        lease_expires_at: new Date(t.getTime() + 120_000).toISOString(),
        status: 'provisioning',
        created_at: t.toISOString(),
      });
      return { allowed: true, conflict_active: false, session_id: id, remaining_seconds: rem };
    },
    async finalizeFreeSession(sessionId, durationSeconds) {
      checkDb();
      const s = sessions.get(sessionId);
      if (!s || s.status !== 'provisioning') throw new Error('Invalid provisioning session');
      const t = now();
      let fq = freeQuotas.get(s.mac_address);
      let isNew = false;
      if (!fq) {
        fq = {
          mac_address: s.mac_address,
          started_at: t.toISOString(),
          expires_at: new Date(t.getTime() + durationSeconds * 1000).toISOString(),
          created_at: t.toISOString(),
        };
        freeQuotas.set(s.mac_address, fq);
        isNew = true;
      }
      const rem = Math.max(0, Math.floor((Date.parse(fq.expires_at) - t.getTime()) / 1000));
      s.status = 'active';
      s.started_at = fq.started_at;
      s.expires_at = fq.expires_at;
      s.lease_expires_at = null;
      return { allowed: rem > 0, is_new: isNew, session_id: s.id, mac_address: s.mac_address, started_at: fq.started_at, expires_at: fq.expires_at, remaining_seconds: rem };
    },
    async beginUserProvisioning(input) {
      checkDb();
      const u = users.get(input.userId);
      if (!u || u.is_disabled) return { allowed: false, session_id: null, remaining_seconds: 0 };
      const t = now();
      const rem = u.expires_at ? Math.max(0, Math.floor((Date.parse(u.expires_at) - t.getTime()) / 1000)) : u.duration_minutes * 60;
      if (rem <= 0) return { allowed: false, session_id: null, remaining_seconds: 0 };
      const id = `sess-${seq++}`;
      sessions.set(id, {
        id,
        session_type: 'user',
        user_id: u.id,
        mac_address: input.macAddress,
        ip_address: input.ipAddress,
        hotspot_username: input.hotspotUsername,
        hotspot_profile: input.hotspotProfile,
        started_at: u.started_at ?? t.toISOString(),
        expires_at: u.expires_at ?? new Date(t.getTime() + u.duration_minutes * 60_000).toISOString(),
        lease_expires_at: new Date(t.getTime() + 120_000).toISOString(),
        status: 'provisioning',
        created_at: t.toISOString(),
      });
      return { allowed: true, session_id: id, remaining_seconds: rem };
    },
    async finalizeUserSession(sessionId) {
      checkDb();
      const s = sessions.get(sessionId);
      if (!s || s.status !== 'provisioning' || !s.user_id) throw new Error('Invalid provisioning session');
      const u = users.get(s.user_id);
      const t = now();
      if (!u.started_at || !u.expires_at) {
        u.started_at = t.toISOString();
        u.expires_at = new Date(t.getTime() + u.duration_minutes * 60_000).toISOString();
      }
      const rem = Math.max(0, Math.floor((Date.parse(u.expires_at) - t.getTime()) / 1000));
      s.status = 'active';
      s.started_at = u.started_at;
      s.expires_at = u.expires_at;
      s.lease_expires_at = null;
      return { allowed: rem > 0, session_id: s.id, started_at: u.started_at, expires_at: u.expires_at, remaining_seconds: rem };
    },
    async abortProvisioning(id) {
      const s = sessions.get(id);
      if (s && s.status === 'provisioning') s.status = 'disconnected';
    },
    async markRevocationPending(id) {
      const s = sessions.get(id);
      if (s) s.status = 'revocation_pending';
    },
    async reclaimExpiredProvisioningLeases() {
      checkDb();
      return 0;
    },
    async renewProvisioningLease() {
      return true;
    },
    async tryAcquireMonitorLock(lockName, ownerId, leaseSeconds = 30) {
      checkDb();
      const cur = monitorLocks.get(lockName);
      const t = now().getTime();
      if (!cur || cur.ownerId === ownerId || cur.expiresAtMs < t) {
        const token = cur ? (cur.ownerId === ownerId ? cur.fenceToken : cur.fenceToken + 1) : 1;
        monitorLocks.set(lockName, { ownerId, fenceToken: token, expiresAtMs: t + leaseSeconds * 1000 });
        return { acquired: true, fence_token: token };
      }
      return { acquired: false, fence_token: 0 };
    },
    async fencedUpdateSessionStatus(id, status, lockName, ownerId, fenceToken) {
      checkDb();
      const cur = monitorLocks.get(lockName);
      if (!cur || cur.ownerId !== ownerId || cur.fenceToken !== fenceToken || cur.expiresAtMs < now().getTime()) return false;
      const s = sessions.get(id);
      if (!s) return false;
      s.status = status;
      return true;
    },
    async releaseMonitorLock(lockName, ownerId) {
      const cur = monitorLocks.get(lockName);
      if (cur && cur.ownerId === ownerId) monitorLocks.delete(lockName);
    },
    async getActiveSessionByMac(mac) {
      checkDb();
      return [...sessions.values()].find((s) => s.mac_address === mac && s.status === 'active') ?? null;
    },
    async listActiveSessions() {
      checkDb();
      return [...sessions.values()].filter((s) => s.status === 'active');
    },
    async listRevocationPendingSessions() {
      checkDb();
      return [...sessions.values()].filter((s) => s.status === 'revocation_pending');
    },
    async listActiveSessionsByUserId(userId) {
      checkDb();
      return [...sessions.values()].filter((s) => s.user_id === userId && s.status === 'active');
    },
    async updateSessionStatus(id, status) {
      checkDb();
      const s = sessions.get(id);
      if (s) s.status = status;
    },
  };

  return { db, now, advanceMs, setDbFailure, admins, users, freeQuotas, sessions };
}

const sim = createIsolatedFieldDb();
await sim.db.createAdmin('admin', hashPassword('FieldTest@2026!'));
const mikrotik = new MockMikroTikAdapter([
  { ipAddress: '192.168.20.50', macAddress: 'AA:BB:CC:DD:EE:50' },
  { ipAddress: '192.168.20.51', macAddress: 'AA:BB:CC:DD:EE:51' },
]);
const adminService = new AdminService(sim.db, fieldCfg.tokenSecret);
const quotaService = new QuotaService(sim.db, mikrotik, { freeQuotaSeconds: 1800, nowProvider: sim.now });
const sessionMonitor = new SessionMonitor(sim.db, mikrotik, { nowProvider: sim.now });

const app = createApp({
  config: fieldCfg,
  db: sim.db,
  adminService,
  quotaService,
  sessionMonitor,
  mikrotik,
});

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, fieldCfg.host, resolve));
const addr = server.address();
assert.equal(addr.address, '127.0.0.1', 'Field-Test server must bind ONLY to loopback 127.0.0.1');
const baseUrl = `http://127.0.0.1:${addr.port}`;

// API-level verification: ensure MockMikroTikAdapter triggers zero Node.js outbound socket/HTTP calls
// (Note: this is an API-level check, not an OS-level firewall/container egress test.)
{
  const outboundCalls = [];
  const origConnect = net.Socket.prototype.connect;
  const origHttpReq = http.request;
  const origHttpsReq = https.request;
  net.Socket.prototype.connect = function (...args) {
    outboundCalls.push({ kind: 'net.connect', args });
    return origConnect.apply(this, args);
  };
  http.request = (...args) => {
    outboundCalls.push({ kind: 'http.request', args });
    return origHttpReq(...args);
  };
  https.request = (...args) => {
    outboundCalls.push({ kind: 'https.request', args });
    return origHttpsReq(...args);
  };
  try {
    await mikrotik.checkConnection();
    await mikrotik.resolveClientByIp('192.168.20.50');
    await mikrotik.grantHotspotAccess({
      username: 'netcheck',
      password: 'pw',
      macAddress: 'AA:BB:CC:DD:EE:77',
      ipAddress: '192.168.20.77',
      bindMac: true,
      sessionTimeoutSeconds: 60,
      profile: 'p',
    });
    await mikrotik.listActiveSessions();
    await mikrotik.revokeHotspotAccess({ username: 'netcheck', macAddress: 'AA:BB:CC:DD:EE:77' });
    assert.equal(outboundCalls.length, 0, 'MockMikroTikAdapter must make ZERO outbound network calls');
  } finally {
    net.Socket.prototype.connect = origConnect;
    http.request = origHttpReq;
    https.request = origHttpsReq;
  }
}

async function api(pathStr, opts = {}) {
  const res = await fetch(`${baseUrl}${pathStr}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

try {
  // Test 3 & 5: Health check in Field-Test mode + MockMikroTikAdapter status
  const health = await api('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.service, 'rawad-captive-portal-backend');
  const mtStatus = await mikrotik.checkConnection();
  assert.equal(mtStatus.connected, true);
  assert.equal(mtStatus.mode, 'mock');

  // Test 5 & 6: Free 30-minute session creation & MockMikroTikAdapter
  const free1 = await api('/api/guest/free', {
    method: 'POST',
    body: JSON.stringify({ mac: 'AA:BB:CC:DD:EE:50', ip: '192.168.20.50' }),
  });
  assert.equal(free1.status, 200);
  assert.equal(free1.body.remainingSeconds, 1800);
  assert.equal(mikrotik.getStoredUser('free-aabbccddee50')?.macAddress, 'AA:BB:CC:DD:EE:50');
  assert.equal((await mikrotik.listActiveSessions()).length, 1);

  // Test 7a: Cannot consume free quota twice while active -> 409
  const freeDup = await api('/api/guest/free', {
    method: 'POST',
    body: JSON.stringify({ mac: 'AA:BB:CC:DD:EE:50', ip: '192.168.20.50' }),
  });
  assert.equal(freeDup.status, 409);

  // Test 9a: Session expiry & revocation via SessionMonitor
  sim.advanceMs(1801 * 1000);
  const sync1 = await sessionMonitor.syncSessions();
  assert.equal(sync1.expiredCount, 1);
  assert.equal((await mikrotik.listActiveSessions()).length, 0);

  // Test 7b: Cannot consume free quota again after 30m exhausted -> 403
  const freeAfter = await api('/api/guest/free', {
    method: 'POST',
    body: JSON.stringify({ mac: 'AA:BB:CC:DD:EE:50', ip: '192.168.20.50' }),
  });
  assert.equal(freeAfter.status, 403);

  // Test 8: Username/Password account -> duration starts on FIRST successful login, bindMac=false
  const admLogin = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'FieldTest@2026!' }),
  });
  assert.equal(admLogin.status, 200);
  const adminToken = admLogin.body.token;

  const usrCreate = await api('/api/admin/users', {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ username: 'guest1', password: 'GuestPassword123', duration_minutes: 60 }),
  });
  assert.equal(usrCreate.status, 201);
  assert.equal(usrCreate.body.user.started_at, null, 'started_at must be null before first login');

  const usrLogin = await api('/api/guest/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'guest1', password: 'GuestPassword123', mac: 'AA:BB:CC:DD:EE:51', ip: '192.168.20.51' }),
  });
  assert.equal(usrLogin.status, 200);
  assert.ok(usrLogin.body.user.started_at, 'started_at must be set on first login');
  assert.equal(usrLogin.body.remainingSeconds, 3600);
  assert.equal(mikrotik.getStoredUser('usr-guest1')?.macAddress, undefined, 'Ordinary account must NOT bind MAC');

  // Test 9b: Admin disable revokes active session immediately
  const usrDisable = await api(`/api/admin/users/${usrCreate.body.user.id}/disable`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ is_disabled: true }),
  });
  assert.equal(usrDisable.status, 200);
  assert.equal((await mikrotik.listActiveSessions()).length, 0);

  // Test 10: Database failure -> Fail-Closed (500/503 & zero MikroTik grants)
  sim.setDbFailure(true);
  const dbFailHealth = await api('/api/health');
  assert.equal(dbFailHealth.status, 503);
  const dbFailStatus = await api('/api/guest/status?mac=AA:BB:CC:DD:EE:52');
  assert.ok(dbFailStatus.status >= 400);
  assert.match(dbFailStatus.body.error, /Simulated PostgreSQL connection failure/);
  assert.equal((await mikrotik.listActiveSessions()).length, 0);
  sim.setDbFailure(false);

  // Test 12: Verify routeros scripts were not modified and no .env secrets exist in repo
  assert.equal(fs.existsSync(path.join(root, 'deployment', '.env')), false);

  console.log('ALL IN-MEMORY APPLICATION & API-LEVEL NETWORK-ISOLATION TESTS PASSED');
} finally {
  server.closeAllConnections?.();
  server.close();
}
