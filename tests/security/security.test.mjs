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

test('Security: Default Deny + MikroTik failure never grants internet or consumes quota', async () => {
  const db = openDatabase(':memory:', SCHEMA_DIR);
  const audit = new AuditService(db);
  const adminService = new AdminService(db, audit, 'sec-secret');
  adminService.ensureDefaultSuperAdmin('superadmin', 'SuperPass123!');
  const mikrotik = new MockMikroTikAdapter();
  const quota = new QuotaService(db, mikrotik, audit, {
    freeQuotaSeconds: 1800,
    profileFree: 'rawad-free-30m',
    profileUser: 'rawad-user',
  });

  const mac = 'DE:AD:BE:EF:00:01';
  // Before auth: Default Deny
  assert.equal(mikrotik.isMacAuthorized(mac), false);

  // Simulate MikroTik failure
  mikrotik.setSimulateGrantFailure(true);
  await assert.rejects(() => quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.50' }));
  assert.equal(mikrotik.isMacAuthorized(mac), false);

  // Quota must NOT be marked used when router failed
  mikrotik.setSimulateGrantFailure(false);
  const eligibility = quota.getFreeEligibility(mac);
  assert.equal(eligibility.eligible, true);
  db.close();
});

test('Security: Admin endpoints reject unauthenticated requests (401) and enforce RBAC (403)', async () => {
  const db = openDatabase(':memory:', SCHEMA_DIR);
  const audit = new AuditService(db);
  const adminService = new AdminService(db, audit, 'sec-secret');
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
      tokenSecret: 'sec-secret',
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
      trustProxy: false,
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
    // 1. Unauthenticated admin access -> 401
    const r1 = await fetch(`${base}/api/admin/users`);
    assert.equal(r1.status, 401);

    // 2. Super admin creates regular admin, regular admin tries to disable super admin -> 403
    const loginSuper = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'superadmin', password: 'SuperPass123!' }),
    }).then((r) => r.json());

    const createdStaff = await fetch(`${base}/api/admin/admins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginSuper.token}`,
      },
      body: JSON.stringify({
        username: 'staff2',
        password: 'StaffPassword2',
        display_name: 'Staff 2',
        role: 'admin',
      }),
    }).then((r) => r.json());
    assert.ok(createdStaff.admin.id);

    const loginStaff = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'staff2', password: 'StaffPassword2' }),
    }).then((r) => r.json());

    const attemptDisableSuper = await fetch(`${base}/api/admin/admins/${loginSuper.admin.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginStaff.token}`,
      },
      body: JSON.stringify({ is_active: false }),
    });
    assert.equal(attemptDisableSuper.status, 403);
  } finally {
    server.closeAllConnections?.();
    server.close();
    db.close();
  }
});
