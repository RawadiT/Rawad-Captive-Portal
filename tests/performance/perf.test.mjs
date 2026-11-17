import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { MockDatabaseClient } from '../../backend/dist/db/mockDbClient.js';
import { AdminService } from '../../backend/dist/authentication/adminService.js';
import { MockMikroTikAdapter } from '../../backend/dist/mikrotik/mockAdapter.js';
import { QuotaService } from '../../backend/dist/quota-manager/quotaService.js';
import { SessionMonitor } from '../../backend/dist/session-monitor/sessionMonitor.js';
import { createApp } from '../../backend/dist/api/app.js';

test('Performance: 50 concurrent guest grants complete within budget', async () => {
  const db = new MockDatabaseClient();
  const adminService = new AdminService(db, 'perf-secret-32-chars-minimum-length');
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
      tokenSecret: 'perf-secret-32-chars-minimum-length',
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
    for (let i = 0; i < 50; i++) {
      mikrotik.registerHost(`192.168.20.${10 + i}`, `02:00:00:00:01:${String(i).padStart(2, '0')}`);
    }

    const t0 = performance.now();
    const statuses = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        fetch(`${base}/api/guest/free`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-real-ip': `192.168.20.${10 + i}` },
          body: JSON.stringify({}),
        }).then((r) => r.status)
      )
    );
    const elapsedMs = performance.now() - t0;
    assert.ok(statuses.every((s) => s === 200));
    assert.ok(elapsedMs < 3000);
    console.log(`[Perf] 50 concurrent free-access grants completed in ${elapsedMs.toFixed(1)}ms`);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
