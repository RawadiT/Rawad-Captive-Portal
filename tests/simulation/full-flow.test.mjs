import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openDatabase } from '../../backend/dist/config/db.js';
import { AuditService } from '../../backend/dist/audit-logs/auditService.js';
import { AdminService } from '../../backend/dist/authentication/adminService.js';
import { MockMikroTikAdapter } from '../../backend/dist/mikrotik/mockAdapter.js';
import { QuotaService } from '../../backend/dist/quota-manager/quotaService.js';
import { SessionMonitor } from '../../backend/dist/session-monitor/sessionMonitor.js';
import { createApp } from '../../backend/dist/api/app.js';

const SCHEMA_DIR = path.resolve(process.cwd(), 'database', 'schema');

test('End-to-End HTTP Simulation: Guest Free + Admin Dashboard + RFC 8908 Capport', async () => {
  const db = openDatabase(':memory:', SCHEMA_DIR);
  const audit = new AuditService(db);
  const adminService = new AdminService(db, audit, 'sim-secret');
  adminService.ensureDefaultSuperAdmin('superadmin', 'SuperPass123!');
  const mikrotik = new MockMikroTikAdapter();
  const quota = new QuotaService(db, mikrotik, audit, {
    freeQuotaSeconds: 1800,
    profileFree: 'rawad-free-30m',
    profileUser: 'rawad-user',
  });
  const monitor = new SessionMonitor(db, mikrotik, audit);
  const app = createApp({
    config: {
      nodeEnv: 'test',
      port: 0,
      host: '127.0.0.1',
      databasePath: ':memory:',
      schemaDir: SCHEMA_DIR,
      tokenSecret: 'sim-secret',
      mikrotikMode: 'mock',
      mikrotikHost: '192.168.20.1',
      mikrotikPort: 443,
      mikrotikUsername: 'rawad-api',
      mikrotikPassword: '',
      mikrotikTlsRejectUnauthorized: true,
      mikrotikCaCertPath: null,
      mikrotikHotspotServer: 'rawad-guest-hotspot',
      mikrotikProfileFree: 'rawad-free-30m',
      mikrotikProfileUser: 'rawad-user',
      freeQuotaSeconds: 1800,
      sessionSyncIntervalMs: 5000,
      guestPortalOrigin: 'https://wifi.rawad-tech.example',
      adminDashboardOrigin: 'http://127.0.0.1:3001',
      defaultSuperAdminUsername: 'superadmin',
      defaultSuperAdminPassword: 'SuperPass123!',
      trustProxy: true,
      allowDevMacFallback: false,
    },
    adminService,
    quotaService: quota,
    sessionMonitor: monitor,
    auditService: audit,
    mikrotik,
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const mac = '00:11:22:33:44:55';
    const ip = '192.168.20.99';
    mikrotik.registerHost(ip, mac);

    // 1. Capport before login (no ?mac= param!) -> captive: true
    const capBefore = await fetch(`${base}/api/guest/capport`, {
      headers: { 'x-real-ip': ip },
    }).then((r) => r.json());
    assert.equal(capBefore.captive, true);

    // 2. Guest requests free 30 minutes
    const freeRes = await fetch(`${base}/api/guest/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    assert.equal(freeRes.ok, true);
    assert.equal(freeRes.remainingSeconds, 1800);

    // 3. Capport after login -> captive: false + seconds-remaining
    const capAfter = await fetch(`${base}/api/guest/capport`, {
      headers: { 'x-real-ip': ip },
    }).then((r) => r.json());
    assert.equal(capAfter.captive, false);
    assert.ok(capAfter['seconds-remaining'] > 0);

    // 4. Admin logs in and views active session + terminates it
    const adminLogin = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'superadmin', password: 'SuperPass123!' }),
    }).then((r) => r.json());

    const activeList = await fetch(`${base}/api/admin/sessions/active`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` },
    }).then((r) => r.json());
    assert.equal(activeList.sessions.length, 1);

    await fetch(`${base}/api/admin/sessions/${activeList.sessions[0].id}/terminate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}` },
    });

    const activeAfter = await fetch(`${base}/api/admin/sessions/active`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` },
    }).then((r) => r.json());
    assert.equal(activeAfter.sessions.length, 0);
  } finally {
    server.closeAllConnections?.();
    server.close();
    db.close();
  }
});
