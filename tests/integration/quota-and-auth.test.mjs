import test from 'node:test';
import assert from 'node:assert/strict';
import { MockDatabaseClient } from '../../backend/dist/db/mockDbClient.js';
import { AdminService } from '../../backend/dist/authentication/adminService.js';
import { MockMikroTikAdapter } from '../../backend/dist/mikrotik/mockAdapter.js';
import { QuotaService } from '../../backend/dist/quota-manager/quotaService.js';
import { SessionMonitor } from '../../backend/dist/session-monitor/sessionMonitor.js';

function createHarness(initialIso = '2026-11-17T10:00:00.000Z') {
  let nowMs = Date.parse(initialIso);
  const nowProvider = () => new Date(nowMs);
  const advanceSeconds = (sec) => {
    nowMs += sec * 1000;
  };

  const db = new MockDatabaseClient(nowProvider);
  const adminService = new AdminService(db, 'test-secret');
  const mikrotik = new MockMikroTikAdapter(() => nowMs);
  const quota = new QuotaService(db, mikrotik, {
    freeQuotaSeconds: 1800,
    nowProvider,
  });
  const monitor = new SessionMonitor(db, mikrotik, nowProvider);

  return { db, adminService, mikrotik, quota, monitor, advanceSeconds, nowProvider };
}

test('Free Access 1-8: 30m once per MAC, Wall-Clock countdown across disconnect, persistent after restart, different MAC is separate', async () => {
  const h = createHarness('2026-11-17T10:00:00.000Z');
  const mac1 = 'AA:BB:CC:11:22:33';
  const mac2 = 'AA:BB:CC:11:22:44';

  // 1. New MAC gets 30 minutes (1800s) & MikroTik profile uses session-timeout=1800
  const g1 = await h.quota.grantFreeAccess({ macAddress: mac1, ipAddress: '192.168.20.11' });
  assert.equal(g1.remainingSeconds, 1800);
  assert.equal(h.mikrotik.isMacAuthorized(mac1), true);
  assert.equal(h.mikrotik.getProfileSessionTimeout(g1.session.hotspot_profile), 1800);

  // 4. Disconnect after 10 min, wait 10 min (now 10:20), reconnect -> 10 min (600s) left (Wall-Clock!)
  h.advanceSeconds(600);
  await h.monitor.disconnectByMac(mac1);
  assert.equal(h.mikrotik.isMacAuthorized(mac1), false);

  h.advanceSeconds(600);
  const gResumed = await h.quota.grantFreeAccess({ macAddress: mac1, ipAddress: '192.168.20.11' });
  assert.equal(gResumed.resumed, true);
  assert.equal(gResumed.remainingSeconds, 600);
  assert.equal(h.mikrotik.getProfileSessionTimeout(gResumed.session.hotspot_profile), 600);

  // 5 & 6 & 7. Simulate Backend/PC restart (new QuotaService instance on same DB) & session expiration
  h.advanceSeconds(600); // now 10:30 -> expired!
  await h.monitor.syncSessions();
  assert.equal(h.mikrotik.isMacAuthorized(mac1), false);

  const freshQuotaService = new QuotaService(h.db, h.mikrotik, {
    freeQuotaSeconds: 1800,
    nowProvider: h.nowProvider,
  });

  // 2. Same MAC blocked permanently after expiration
  await assert.rejects(
    () => freshQuotaService.grantFreeAccess({ macAddress: mac1, ipAddress: '192.168.20.11' }),
    /تم استهلاك الحصة المجانية/
  );

  // 8. Different MAC is treated as a different device
  const gOther = await freshQuotaService.grantFreeAccess({ macAddress: mac2, ipAddress: '192.168.20.12' });
  assert.equal(gOther.remainingSeconds, 1800);
});

test('Free Access 3: Concurrent requests for same MAC cannot grant two quotas', async () => {
  const h = createHarness('2026-11-17T10:00:00.000Z');
  const mac = 'AA:BB:CC:77:88:99';

  await Promise.all([
    h.quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.15' }),
    h.quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.15' }),
    h.quota.grantFreeAccess({ macAddress: mac, ipAddress: '192.168.20.15' }),
  ]);

  const quotas = await h.quota.listFreeQuotas();
  assert.equal(quotas.length, 1);
});

test('Account Tests 1-6: 120m starts on first login, Wall-Clock continues when disconnected, not tied to MAC, disable blocks', async () => {
  const h = createHarness('2026-11-17T10:00:00.000Z');
  const user = await h.quota.createUser({
    username: 'ali',
    password: 'Password123',
    duration_minutes: 120,
  });
  assert.equal(user.started_at, null);
  assert.equal(user.expires_at, null);

  // First login starts Wall-Clock timer (10:00 -> 12:00)
  const s1 = await h.quota.loginUser({
    username: 'ali',
    password: 'Password123',
    macAddress: '11:22:33:44:55:66',
    ipAddress: '192.168.20.30',
  });
  assert.equal(s1.remainingSeconds, 7200);
  assert.ok(s1.user.started_at);
  assert.ok(s1.user.expires_at);

  // Disconnect and wait 90 minutes (5400s) -> return from a DIFFERENT MAC -> 30 minutes (1800s) left!
  await h.monitor.disconnectByMac('11:22:33:44:55:66');
  h.advanceSeconds(5400);

  const s2 = await h.quota.loginUser({
    username: 'ali',
    password: 'Password123',
    macAddress: 'AA:BB:CC:DD:EE:FF',
    ipAddress: '192.168.20.31',
  });
  assert.equal(s2.remainingSeconds, 1800);

  // Disable account -> immediately revokes & blocks login
  await h.quota.setUserDisabled(user.id, true);
  assert.equal(h.mikrotik.isMacAuthorized('AA:BB:CC:DD:EE:FF'), false);
  await assert.rejects(
    () =>
      h.quota.loginUser({
        username: 'ali',
        password: 'Password123',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        ipAddress: '192.168.20.31',
      }),
    /معطل/
  );

  // Re-enable after total 120 min elapsed -> expired!
  await h.quota.setUserDisabled(user.id, false);
  h.advanceSeconds(1800);
  await assert.rejects(
    () =>
      h.quota.loginUser({
        username: 'ali',
        password: 'Password123',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        ipAddress: '192.168.20.31',
      }),
    /انتهت صلاحية/
  );
});
