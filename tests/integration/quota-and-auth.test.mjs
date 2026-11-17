import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../backend/dist/config/db.js';
import { AuditService } from '../../backend/dist/audit-logs/auditService.js';
import { AdminService } from '../../backend/dist/authentication/adminService.js';
import { MockMikroTikAdapter } from '../../backend/dist/mikrotik/mockAdapter.js';
import { QuotaService } from '../../backend/dist/quota-manager/quotaService.js';
import { SessionMonitor } from '../../backend/dist/session-monitor/sessionMonitor.js';

const SCHEMA_DIR = path.resolve(process.cwd(), 'database', 'schema');

function createHarness(initialIso = '2026-11-17T10:00:00.000Z', dbPath = ':memory:') {
  let nowMs = Date.parse(initialIso);
  const nowProvider = () => new Date(nowMs);
  const advanceSeconds = (sec) => {
    nowMs += sec * 1000;
  };

  const db = openDatabase(dbPath, SCHEMA_DIR);
  const audit = new AuditService(db);
  const adminService = new AdminService(db, audit, 'test-secret');
  adminService.ensureDefaultSuperAdmin('superadmin', 'SuperPass123!');
  const mikrotik = new MockMikroTikAdapter(() => nowMs);
  const quota = new QuotaService(db, mikrotik, audit, {
    freeQuotaSeconds: 1800,
    profileFree: 'rawad-free-30m',
    profileUser: 'rawad-user',
    nowProvider,
  });
  const monitor = new SessionMonitor(db, mikrotik, audit, nowProvider);

  return { db, audit, adminService, mikrotik, quota, monitor, advanceSeconds };
}

test('Free 30-min lifecycle: grant, resume after disconnect, block 2nd grant same day, reset at 00:00 Baghdad', async () => {
  const h = createHarness('2026-11-17T10:00:00.000Z');
  const mac = 'AA:BB:CC:11:22:33';

  // 1. New device gets 30 minutes
  const grant1 = await h.quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.11' });
  assert.equal(grant1.remainingSeconds, 1800);
  assert.equal(h.mikrotik.isMacAuthorized(mac), true);

  // 2. Advance 10 minutes, disconnect, then reconnect -> resumes with 20 minutes (1200s)
  h.advanceSeconds(600);
  await h.monitor.disconnectByMac(mac);
  assert.equal(h.mikrotik.isMacAuthorized(mac), false);

  const resumed = await h.quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.11' });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.remainingSeconds, 1200);
  assert.equal(h.mikrotik.isMacAuthorized(mac), true);

  // 3. Advance 20 minutes -> session expires and MikroTik revokes access
  h.advanceSeconds(1200);
  const syncRes = await h.monitor.syncSessions();
  assert.equal(syncRes.expiredCount, 1);
  assert.equal(h.mikrotik.isMacAuthorized(mac), false);

  // 4. Same device cannot get a second free quota on the same Baghdad day
  await assert.rejects(
    () => h.quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.11' }),
    /تم استهلاك الحصة المجانية/
  );

  // 5. Advance past 00:00 Asia/Baghdad (21:00 UTC) -> eligible again
  h.advanceSeconds(12 * 3600);
  const grantNextDay = await h.quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.11' });
  assert.equal(grantNextDay.remainingSeconds, 1800);
  h.db.close();
});

test('Session started before midnight Baghdad keeps original 30-min limit without extending or cutting', async () => {
  // 23:50 Baghdad == 20:50 UTC
  const h = createHarness('2026-11-17T20:50:00.000Z');
  const mac = 'AA:BB:CC:44:55:66';

  await h.quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.12' });
  // Advance 15 min -> now 00:05 Baghdad next day; session should STILL be active with 15 min left!
  h.advanceSeconds(900);
  const sync1 = await h.monitor.syncSessions();
  assert.equal(sync1.expiredCount, 0);
  assert.equal(h.mikrotik.isMacAuthorized(mac), true);

  // Advance remaining 15 min -> expires normally at 30 min total
  h.advanceSeconds(900);
  const sync2 = await h.monitor.syncSessions();
  assert.equal(sync2.expiredCount, 1);
  assert.equal(h.mikrotik.isMacAuthorized(mac), false);
  h.db.close();
});

test('Concurrent free requests from same MAC only grant ONE quota', async () => {
  const h = createHarness('2026-11-17T10:00:00.000Z');
  const mac = 'AA:BB:CC:77:88:99';

  const results = await Promise.all([
    h.quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.15' }),
    h.quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.15' }),
    h.quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.15' }),
  ]);

  const ids = new Set(results.map((r) => r.session.id));
  assert.equal(ids.size, 1);
  const countRow = h.db.prepare('SELECT COUNT(*) AS cnt FROM free_quotas WHERE mac_address = ?').get(mac);
  assert.equal(countRow.cnt, 1);
  h.db.close();
});

test('Backend restart persists consumed quota in SQLite', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rawad-persist-'));
  const dbPath = path.join(tmpDir, 'portal.db');
  const mac = 'AA:BB:CC:AA:BB:CC';

  const h1 = createHarness('2026-11-17T10:00:00.000Z', dbPath);
  await h1.quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.20' });
  h1.advanceSeconds(1800);
  await h1.monitor.syncSessions();
  h1.db.close();

  // Simulate restart with fresh service instances on the same DB file
  const h2 = createHarness('2026-11-17T11:00:00.000Z', dbPath);
  await assert.rejects(
    () => h2.quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.20' }),
    /تم استهلاك الحصة المجانية/
  );
  h2.db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('User login: cumulative quota (120m - 40m = 80m left), disabled, banned, unlimited, and terminate', async () => {
  const h = createHarness('2026-11-17T10:00:00.000Z');
  const { admin } = h.adminService.login('superadmin', 'SuperPass123!', '127.0.0.1');
  const actor = { id: admin.id, username: admin.username, role: admin.role };

  const uLimited = h.quota.createUser(actor, { username: 'ali', password: 'Password1', quota_minutes: 120 }, '127.0.0.1');
  const uOpen = h.quota.createUser(actor, { username: 'vip', password: 'Password1', quota_minutes: null }, '127.0.0.1');

  // Wrong password
  await assert.rejects(
    () => h.quota.loginUser({ username: 'ali', password: 'wrong', macAddress: '11:22:33:44:55:66', ipAddress: '192.168.20.30' }),
    /غير صحيحة/
  );

  // Login limited user -> use 40 minutes -> disconnect -> reconnect -> 80 minutes (4800s) left
  const s1 = await h.quota.loginUser({ username: 'ali', password: 'Password1', macAddress: '11:22:33:44:55:66', ipAddress: '192.168.20.30' });
  assert.equal(s1.remainingSeconds, 7200);
  h.advanceSeconds(2400);
  await h.monitor.disconnectByMac('11:22:33:44:55:66');

  const s2 = await h.quota.loginUser({ username: 'ali', password: 'Password1', macAddress: '11:22:33:44:55:66', ipAddress: '192.168.20.30' });
  assert.equal(s2.remainingSeconds, 4800);

  // Exhaust remaining 80 minutes
  h.advanceSeconds(4800);
  await h.monitor.syncSessions();
  await assert.rejects(
    () => h.quota.loginUser({ username: 'ali', password: 'Password1', macAddress: '11:22:33:44:55:66', ipAddress: '192.168.20.30' }),
    /انتهت مدة استخدام/
  );

  // Unlimited user
  const sOpen = await h.quota.loginUser({ username: 'vip', password: 'Password1', macAddress: '11:22:33:44:55:77', ipAddress: '192.168.20.31' });
  assert.equal(sOpen.remainingSeconds, null);

  // Admin terminates active session
  await h.monitor.terminateSession(actor, sOpen.session.id, '127.0.0.1');
  assert.equal(h.mikrotik.isMacAuthorized('11:22:33:44:55:77'), false);

  // Ban user
  await h.quota.updateUser(actor, uOpen.id, { status: 'banned' }, '127.0.0.1');
  await assert.rejects(
    () => h.quota.loginUser({ username: 'vip', password: 'Password1', macAddress: '11:22:33:44:55:77', ipAddress: '192.168.20.31' }),
    /حظر/
  );

  // Disable user
  await h.quota.updateUser(actor, uLimited.id, { status: 'disabled' }, '127.0.0.1');
  await assert.rejects(
    () => h.quota.loginUser({ username: 'ali', password: 'Password1', macAddress: '11:22:33:44:55:66', ipAddress: '192.168.20.30' }),
    /معطل/
  );
  h.db.close();
});

test('Admin RBAC: regular admin cannot create/edit/disable super_admin, and audit logs are immutable', () => {
  const h = createHarness('2026-11-17T10:00:00.000Z');
  const { admin: superAdmin } = h.adminService.login('superadmin', 'SuperPass123!', '127.0.0.1');
  const regularAdmin = h.adminService.createAdmin(
    { id: superAdmin.id, username: superAdmin.username, role: 'super_admin' },
    { username: 'staff1', password: 'StaffPassword1', display_name: 'موظف', role: 'admin' },
    '127.0.0.1'
  );

  assert.throws(() => {
    h.adminService.updateAdmin(
      { id: regularAdmin.id, username: regularAdmin.username, role: 'admin' },
      superAdmin.id,
      { is_active: false },
      '127.0.0.1'
    );
  }, /المدير الرئيسي/);

  assert.throws(() => {
    h.db.prepare("DELETE FROM audit_logs").run();
  }, /immutable/);
  h.db.close();
});
