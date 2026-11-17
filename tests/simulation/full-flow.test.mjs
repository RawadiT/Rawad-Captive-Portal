import test from 'node:test';
import assert from 'node:assert/strict';
import { MockDatabaseClient } from '../../backend/dist/db/mockDbClient.js';
import { AdminService } from '../../backend/dist/authentication/adminService.js';
import { MockMikroTikAdapter } from '../../backend/dist/mikrotik/mockAdapter.js';
import { QuotaService } from '../../backend/dist/quota-manager/quotaService.js';
import { SessionMonitor } from '../../backend/dist/session-monitor/sessionMonitor.js';
import { createApp } from '../../backend/dist/api/app.js';

test('End-to-End HTTP Simulation: Health, CAPPORT, Free 30m, Admin User Create & Login', async () => {
  const db = new MockDatabaseClient();
  const adminService = new AdminService(db, 'sim-secret-32-chars-minimum-length');
  await adminService.ensureDefaultAdmin('admin', 'StrongAdminPass99!');
  const mikrotik = new MockMikroTikAdapter();
  const quota = new QuotaService(db, mikrotik, { freeQuotaSeconds: 1800 });
  const monitor = new SessionMonitor(db, mikrotik);
  const app = createApp({
    config: {
      nodeEnv: 'test',
      port: 0,
      host: '127.0.0.1',
      supabaseUrl: 'https://test.supabase.co',
      supabaseServiceRoleKey: 'test-key',
      tokenSecret: 'sim-secret-32-chars-minimum-length',
      mikrotikMode: 'mock',
      mikrotikHost: '192.168.20.1',
      mikrotikPort: 443,
      mikrotikUsername: 'rawad-api',
      mikrotikPassword: '',
      mikrotikTlsRejectUnauthorized: true,
      mikrotikCaCertPath: null,
      mikrotikHotspotServer: 'rawad-guest-hotspot',
      freeQuotaSeconds: 1800,
      sessionSyncIntervalMs: 5000,
      guestPortalOrigin: 'https://wifi.rawad-tech.example',
      adminDashboardOrigin: 'https://127.0.0.1:8443',
      defaultAdminUsername: 'admin',
      defaultAdminPassword: 'StrongAdminPass99!',
      trustProxy: true,
      allowDevMacFallback: false,
    },
    db,
    adminService,
    quotaService: quota,
    sessionMonitor: monitor,
    mikrotik,
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    assert.equal(health.ok, true);

    const ip = '192.168.20.99';
    mikrotik.registerHost(ip, '00:11:22:33:44:55');

    const capBefore = await fetch(`${base}/api/guest/capport`, { headers: { 'x-real-ip': ip } }).then((r) => r.json());
    assert.equal(capBefore.captive, true);

    const freeRes = await fetch(`${base}/api/guest/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    assert.equal(freeRes.ok, true);
    assert.equal(freeRes.remainingSeconds, 1800);

    const capAfter = await fetch(`${base}/api/guest/capport`, { headers: { 'x-real-ip': ip } }).then((r) => r.json());
    assert.equal(capAfter.captive, false);

    // Admin creates a 60-min account and views free-quotas
    const adm = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'StrongAdminPass99!' }),
    }).then((r) => r.json());
    assert.ok(adm.token);

    const created = await fetch(`${base}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adm.token}` },
      body: JSON.stringify({ username: 'guest1', password: 'UserPass1', duration_minutes: 60 }),
    });
    assert.equal(created.status, 201);

    const quotas = await fetch(`${base}/api/admin/free-quotas`, {
      headers: { Authorization: `Bearer ${adm.token}` },
    }).then((r) => r.json());
    assert.equal(quotas.quotas.length, 1);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
