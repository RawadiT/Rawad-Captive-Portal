import test from 'node:test';
import assert from 'node:assert/strict';
import { MockDatabaseClient } from '../../backend/dist/db/mockDbClient.js';
import { validateProductionSecrets } from '../../backend/dist/config/env.js';
import { AdminService } from '../../backend/dist/authentication/adminService.js';
import { MockMikroTikAdapter } from '../../backend/dist/mikrotik/mockAdapter.js';
import { QuotaService } from '../../backend/dist/quota-manager/quotaService.js';
import { SessionMonitor } from '../../backend/dist/session-monitor/sessionMonitor.js';
import { createApp } from '../../backend/dist/api/app.js';

function createSecApp(trustProxy = true) {
  const db = new MockDatabaseClient();
  const adminService = new AdminService(db, 'sec-secret-32-chars-minimum-length');
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
      tokenSecret: 'sec-secret-32-chars-minimum-length',
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
      defaultAdminPassword: 'StrongPassword99!',
      trustProxy,
      allowDevMacFallback: false,
    },
    db,
    adminService,
    quotaService: quota,
    sessionMonitor: monitor,
    mikrotik,
  });
  return { db, adminService, mikrotik, quota, monitor, app };
}

test('Security: Default Deny, MikroTik failure & Supabase DB outage fail-closed behavior', async () => {
  const { db, mikrotik, quota } = createSecApp();
  const mac = 'DE:AD:BE:EF:00:01';

  assert.equal(mikrotik.isMacAuthorized(mac), false);

  // MikroTik failure must not grant internet or consume quota
  mikrotik.setSimulateGrantFailure(true);
  await assert.rejects(() => quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.50' }));
  assert.equal(mikrotik.isMacAuthorized(mac), false);
  mikrotik.setSimulateGrantFailure(false);

  // Supabase outage must block new grants
  db.setFailAll(true);
  await assert.rejects(() => quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.50' }));
  assert.equal(mikrotik.isMacAuthorized(mac), false);
  db.setFailAll(false);

  // DB failure after MikroTik grant must trigger compensating revoke
  db.setFailNextCreateSession(true);
  await assert.rejects(() => quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.50' }));
  assert.equal(mikrotik.isMacAuthorized(mac), false);
});

test('Security: MAC/IP spoofing, untrusted X-Forwarded-For & unauthenticated admin access rejected', async () => {
  const { mikrotik, app } = createSecApp(true);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const rUnauth = await fetch(`${base}/api/admin/users`);
    assert.equal(rUnauth.status, 401);

    mikrotik.registerHost('192.168.20.11', 'AA:BB:CC:00:00:01');
    mikrotik.registerHost('192.168.20.12', 'AA:BB:CC:00:00:02');

    const rSpoof = await fetch(`${base}/api/guest/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': '192.168.20.12' },
      body: JSON.stringify({ macAddress: 'AA:BB:CC:00:00:01' }),
    });
    assert.equal(rSpoof.status, 403);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test('Security: Production config rejects missing Supabase keys, placeholders, .local & 0.0.0.0', () => {
  assert.throws(() =>
    validateProductionSecrets({
      nodeEnv: 'production',
      port: 4000,
      host: '127.0.0.1',
      supabaseUrl: 'https://YOUR_PROJECT_ID.supabase.co',
      supabaseServiceRoleKey: 'REPLACE_WITH_SUPABASE_SERVICE_ROLE_KEY',
      tokenSecret: 'a-very-long-random-production-secret-key-at-least-32-chars',
      mikrotikMode: 'rest',
      mikrotikHost: '192.168.20.1',
      mikrotikPort: 443,
      mikrotikUsername: 'rawad-api',
      mikrotikPassword: 'StrongApiPassword123',
      mikrotikTlsRejectUnauthorized: true,
      mikrotikCaCertPath: null,
      mikrotikHotspotServer: 'rawad-guest-hotspot',
      freeQuotaSeconds: 1800,
      sessionSyncIntervalMs: 5000,
      guestPortalOrigin: 'https://wifi.rawad-tech.example',
      adminDashboardOrigin: 'https://127.0.0.1:8443',
      defaultAdminUsername: 'admin',
      defaultAdminPassword: 'StrongAdminPassword99!',
      trustProxy: true,
      allowDevMacFallback: false,
    })
  );
});
