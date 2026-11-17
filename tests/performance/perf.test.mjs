import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { openDatabase } from '../../backend/dist/config/db.js';
import { AuditService } from '../../backend/dist/audit-logs/auditService.js';
import { AdminService } from '../../backend/dist/authentication/adminService.js';
import { MockMikroTikAdapter } from '../../backend/dist/mikrotik/mockAdapter.js';
import { QuotaService } from '../../backend/dist/quota-manager/quotaService.js';
import { SessionMonitor } from '../../backend/dist/session-monitor/sessionMonitor.js';
import { createApp } from '../../backend/dist/api/app.js';

const SCHEMA_DIR = path.resolve(process.cwd(), 'database', 'schema');

test('Performance: 50 concurrent guest grants & status checks complete within budget', async () => {
  const db = openDatabase(':memory:', SCHEMA_DIR);
  const audit = new AuditService(db);
  const adminService = new AdminService(db, audit, 'perf-secret');
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
      tokenSecret: 'perf-secret',
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
    for (let i = 0; i < 50; i++) {
      mikrotik.registerHost(`192.168.20.${10 + i}`, `02:00:00:00:01:${String(i).padStart(2, '0')}`);
    }

    const t0 = performance.now();
    const promises = Array.from({ length: 50 }, (_, i) =>
      fetch(`${base}/api/guest/free`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-real-ip': `192.168.20.${10 + i}`,
        },
        body: JSON.stringify({}),
      }).then((r) => r.status)
    );
    const statuses = await Promise.all(promises);
    const elapsedMs = performance.now() - t0;

    assert.ok(statuses.every((s) => s === 200), 'All 50 concurrent grants should return 200');
    assert.ok(elapsedMs < 3000, `50 concurrent requests took ${elapsedMs.toFixed(1)}ms (< 3000ms)`);
    console.log(`[Perf] 50 concurrent free-access grants completed in ${elapsedMs.toFixed(1)}ms`);
  } finally {
    server.closeAllConnections?.();
    server.close();
    db.close();
  }
});
