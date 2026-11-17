import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../../backend/dist/config/db.js';
import { validateProductionSecrets } from '../../backend/dist/config/env.js';
import { AuditService } from '../../backend/dist/audit-logs/auditService.js';
import { AdminService } from '../../backend/dist/authentication/adminService.js';
import { MockMikroTikAdapter } from '../../backend/dist/mikrotik/mockAdapter.js';
import { QuotaService } from '../../backend/dist/quota-manager/quotaService.js';
import { SessionMonitor } from '../../backend/dist/session-monitor/sessionMonitor.js';
import { createApp } from '../../backend/dist/api/app.js';

const SCHEMA_DIR = path.resolve(process.cwd(), 'database', 'schema');
const ROOT = process.cwd();

function buildTestServer(trustProxy = true) {
  const db = openDatabase(':memory:', SCHEMA_DIR);
  const audit = new AuditService(db);
  const adminService = new AdminService(db, audit, 'audit-secret-key-32-chars-minimum');
  adminService.ensureDefaultSuperAdmin('superadmin', 'StrongAdminPass99!');
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
      tokenSecret: 'audit-secret-key-32-chars-minimum',
      mikrotikMode: 'mock',
      mikrotikHost: '192.168.10.1',
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
      adminDashboardOrigin: 'https://127.0.0.1:8443',
      defaultSuperAdminUsername: 'superadmin',
      defaultSuperAdminPassword: 'StrongAdminPass99!',
      trustProxy,
      allowDevMacFallback: false,
    },
    adminService,
    quotaService: quota,
    sessionMonitor: monitor,
    auditService: audit,
    mikrotik,
  });

  return { db, mikrotik, quota, monitor, app };
}

test('Audit 2: MAC/IP spoofing & unauthorized disconnect attempts are rejected (403)', async () => {
  const { db, mikrotik, app } = buildTestServer(true);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const ipA = '192.168.20.11';
    const macA = 'AA:BB:CC:00:00:01';
    const ipB = '192.168.20.12';
    const macB = 'AA:BB:CC:00:00:02';

    mikrotik.registerHost(ipA, macA);
    mikrotik.registerHost(ipB, macB);

    // Device A activates its own session
    const grantA = await fetch(`${base}/api/guest/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': ipA },
      body: JSON.stringify({}),
    });
    assert.equal(grantA.status, 200);

    // Device B tries to spoof Device A's MAC to disconnect Device A -> 403
    const spoofDisconnect = await fetch(`${base}/api/guest/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': ipB },
      body: JSON.stringify({ macAddress: macA }),
    });
    assert.equal(spoofDisconnect.status, 403);
    assert.equal(mikrotik.isMacAuthorized(macA), true);

    // Device B tries to spoof Device A's MAC to read Device A's status -> 403
    const spoofStatus = await fetch(`${base}/api/guest/status?mac=${encodeURIComponent(macA)}`, {
      headers: { 'x-real-ip': ipB },
    });
    assert.equal(spoofStatus.status, 403);

    // Unregistered IP tries to call /api/guest/free -> 403
    const unknownClient = await fetch(`${base}/api/guest/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': '192.168.20.250' },
      body: JSON.stringify({ macAddress: macA }),
    });
    assert.equal(unknownClient.status, 403);
  } finally {
    server.closeAllConnections?.();
    server.close();
    db.close();
  }
});

test('Audit 2b: Untrusted X-Forwarded-For cannot spoof client IP when trustProxy=false', async () => {
  const { db, mikrotik, app } = buildTestServer(false);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    mikrotik.registerHost('192.168.20.11', 'AA:BB:CC:00:00:01');
    const res = await fetch(`${base}/api/guest/free`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '192.168.20.11',
      },
      body: JSON.stringify({}),
    });
    // Socket peer is 127.0.0.1 which is not in HotSpot Host Table -> rejected!
    assert.equal(res.status, 403);
  } finally {
    server.closeAllConnections?.();
    server.close();
    db.close();
  }
});

test('Audit 6: Session reconciliation on Wi-Fi drop & MikroTik reboot + orphan fail-closed sweep', async () => {
  const { db, mikrotik, quota, monitor } = buildTestServer(true);
  const mac = 'AA:BB:CC:11:22:33';
  const ip = '192.168.20.30';
  mikrotik.registerHost(ip, mac);

  await quota.grantFreeAccess({ macAddress: mac, ipAddress: ip });
  assert.equal(monitor.getActiveSessions().length, 1);

  // Simulate Wi-Fi / AP disconnect or MikroTik reboot dropping the active HotSpot entry
  mikrotik.simulateReboot();
  const sync1 = await monitor.syncSessions();
  assert.equal(sync1.disconnectedCount, 1);
  // Admin Dashboard must NO LONGER show the device as connected
  assert.equal(monitor.getActiveSessions().length, 0);

  // Device reconnects -> resumes remaining free quota
  const resumed = await quota.grantFreeAccess({ macAddress: mac, ipAddress: ip });
  assert.equal(resumed.resumed, true);
  assert.equal(monitor.getActiveSessions().length, 1);

  // Simulate an orphaned HotSpot session on MikroTik without a DB active record -> fail-closed sweep revokes it!
  await mikrotik.grantHotspotAccess({
    username: 'free-deadbeef0001-20261117',
    password: 'x',
    macAddress: 'DE:AD:BE:EF:00:01',
    ipAddress: '192.168.20.88',
    limitUptimeSeconds: 1800,
    profile: 'rawad-free-30m',
  });
  const sync2 = await monitor.syncSessions();
  assert.equal(sync2.orphansRevoked, 1);
  assert.equal(mikrotik.isMacAuthorized('DE:AD:BE:EF:00:01'), false);
  db.close();
});

test('Audit 7: Database failure after MikroTik grant triggers compensating revoke (fail-closed)', async () => {
  const { db, mikrotik, quota } = buildTestServer(true);
  const mac = 'AA:BB:CC:99:88:77';
  const ip = '192.168.20.45';
  mikrotik.registerHost(ip, mac);

  // Force DB failure when inserting into free_quotas
  db.exec(`
    CREATE TRIGGER fail_free_quotas_insert
    BEFORE INSERT ON free_quotas
    BEGIN
      SELECT RAISE(ABORT, 'simulated disk full');
    END;
  `);

  await assert.rejects(() => quota.grantFreeAccess({ macAddress: mac, ipAddress: ip }), /simulated disk full/);
  // Compensating revoke MUST have removed the MikroTik HotSpot session
  assert.equal(mikrotik.isMacAuthorized(mac), false);
  db.close();
});

test('Audit 9: Production secrets validation rejects placeholders and insecure TLS settings', () => {
  assert.throws(() =>
    validateProductionSecrets({
      nodeEnv: 'production',
      port: 4000,
      host: '127.0.0.1',
      databasePath: ':memory:',
      schemaDir: SCHEMA_DIR,
      tokenSecret: 'REPLACE_WITH_LONG_RANDOM_SECRET_64_CHARS',
      mikrotikMode: 'rest',
      mikrotikHost: '192.168.10.1',
      mikrotikPort: 443,
      mikrotikUsername: 'rawad-api',
      mikrotikPassword: 'RealPassword123',
      mikrotikTlsRejectUnauthorized: true,
      mikrotikCaCertPath: null,
      mikrotikHotspotServer: 'rawad-guest-hotspot',
      mikrotikProfileFree: 'rawad-free-30m',
      mikrotikProfileUser: 'rawad-user',
      freeQuotaSeconds: 1800,
      sessionSyncIntervalMs: 5000,
      guestPortalOrigin: 'https://wifi.rawad-tech.example',
      adminDashboardOrigin: 'https://127.0.0.1:8443',
      defaultSuperAdminUsername: 'superadmin',
      defaultSuperAdminPassword: 'RealSuperAdminPassword99!',
      trustProxy: true,
      allowDevMacFallback: false,
    })
  );

  assert.throws(() =>
    validateProductionSecrets({
      nodeEnv: 'production',
      port: 4000,
      host: '127.0.0.1',
      databasePath: ':memory:',
      schemaDir: SCHEMA_DIR,
      tokenSecret: 'a-very-long-random-production-secret-key-at-least-32-chars',
      mikrotikMode: 'rest',
      mikrotikHost: '192.168.10.1',
      mikrotikPort: 443,
      mikrotikUsername: 'rawad-api',
      mikrotikPassword: 'RealPassword123',
      mikrotikTlsRejectUnauthorized: false,
      mikrotikCaCertPath: null,
      mikrotikHotspotServer: 'rawad-guest-hotspot',
      mikrotikProfileFree: 'rawad-free-30m',
      mikrotikProfileUser: 'rawad-user',
      freeQuotaSeconds: 1800,
      sessionSyncIntervalMs: 5000,
      guestPortalOrigin: 'https://wifi.rawad-tech.example',
      adminDashboardOrigin: 'https://127.0.0.1:8443',
      defaultSuperAdminUsername: 'superadmin',
      defaultSuperAdminPassword: 'RealSuperAdminPassword99!',
      trustProxy: true,
      allowDevMacFallback: false,
    })
  );
});

test('Audit 1, 8, 10: Static verification of RouterOS safety, idempotency, IPv6 priority, Nginx isolation & pre-built Docker', () => {
  const deployRsc = fs.readFileSync(path.join(ROOT, 'routeros/deploy.rsc'), 'utf8');
  const rollbackRsc = fs.readFileSync(path.join(ROOT, 'routeros/rollback.rsc'), 'utf8');
  const nginxConf = fs.readFileSync(path.join(ROOT, 'deployment/nginx/nginx.conf'), 'utf8');
  const composeYml = fs.readFileSync(path.join(ROOT, 'deployment/docker-compose.yml'), 'utf8');

  // deploy.rsc must abort on bridge conflict, never remove bridge ports automatically
  assert.equal(deployRsc.includes('/interface bridge port remove'), false);
  assert.ok(deployRsc.includes(':error "ABORT:'));
  assert.ok(deployRsc.includes('rawad-portal-state'));
  assert.ok(deployRsc.includes('https://'));
  assert.equal(deployRsc.includes('.local'), false, 'deploy.rsc must not use .local as CAPPORT domain');
  assert.ok(deployRsc.includes('/system ntp client set enabled=yes'));
  assert.ok(deployRsc.includes('place-before=0 comment=$cV6Fwd'));
  assert.ok(deployRsc.includes('place-before=0 comment=$cV6In'));

  // rollback.rsc must restore previous DNS/www-ssl and check ownership flags
  assert.ok(rollbackRsc.includes('/system script run rawad-portal-state'));
  assert.ok(rollbackRsc.includes('$rawadPrevDnsRemote'));
  assert.ok(rollbackRsc.includes('$rawadPrevWwwSslDis'));
  assert.ok(rollbackRsc.includes('$rawadCreatedApiUser = true'));
  assert.ok(rollbackRsc.includes('$rawadCreatedApiGroup = true'));

  // Nginx must block /api/admin/ on guest listener, use fullchain.pem, NOT use OCSP stapling (retired by LE in 2025) & Docker must not run npm ci
  assert.ok(nginxConf.includes('location /api/admin/'));
  assert.ok(nginxConf.includes('return 403;'));
  assert.ok(nginxConf.includes('fullchain.pem'));
  assert.equal(/^\s*ssl_stapling\s+on/m.test(nginxConf), false, 'nginx.conf must not enable OCSP stapling for Let\'s Encrypt');
  assert.equal(composeYml.includes('npm ci'), false);

  const envEx = fs.readFileSync(path.join(ROOT, 'deployment/.env.example'), 'utf8');
  const apiJson = fs.readFileSync(path.join(ROOT, 'hotspot/api.json'), 'utf8');
  assert.equal(envEx.includes('.local'), false, '.env.example must not use .local');
  assert.equal(apiJson.includes('.local'), false, 'hotspot/api.json must not use .local');
});

test('Audit CAPPORT: Unauthenticated and authenticated client CAPPORT API responses (RFC 8908)', async () => {
  const { db, mikrotik, app } = buildTestServer(true);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const ip = '192.168.20.77';
    const mac = 'AA:BB:CC:77:77:77';
    mikrotik.registerHost(ip, mac);

    // Unauthenticated client queries CAPPORT
    const resBefore = await fetch(`${base}/api/guest/capport`, {
      headers: { 'x-real-ip': ip },
    });
    assert.equal(resBefore.status, 200);
    assert.ok(resBefore.headers.get('content-type')?.includes('application/captive+json'));
    assert.equal(resBefore.headers.get('cache-control'), 'private, no-store');
    const bodyBefore = await resBefore.json();
    assert.equal(bodyBefore.captive, true);
    assert.ok(bodyBefore['user-portal-url']);

    // Client authenticates via free access
    await fetch(`${base}/api/guest/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
      body: JSON.stringify({}),
    });

    // Authenticated client queries CAPPORT
    const resAfter = await fetch(`${base}/api/guest/capport`, {
      headers: { 'x-real-ip': ip },
    });
    const bodyAfter = await resAfter.json();
    assert.equal(bodyAfter.captive, false);
    assert.ok(typeof bodyAfter['seconds-remaining'] === 'number' && bodyAfter['seconds-remaining'] > 0);
  } finally {
    server.closeAllConnections?.();
    server.close();
    db.close();
  }
});

test('Audit CAPPORT IP Change: Same MAC with new IP in HotSpot Host Table retains active CAPPORT & status', async () => {
  const { db, mikrotik, app } = buildTestServer(true);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const mac = 'AA:BB:CC:00:00:11';
    const ip1 = '192.168.20.11';
    const ip2 = '192.168.20.99';
    mikrotik.registerHost(ip1, mac);

    const grant = await fetch(`${base}/api/guest/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': ip1 },
      body: JSON.stringify({}),
    });
    assert.equal(grant.status, 200);

    // Device roams / renews DHCP lease and gets a new IP (ip2) with the same MAC
    mikrotik.unregisterHost(ip1);
    mikrotik.registerHost(ip2, mac);

    const statusNewIp = await fetch(`${base}/api/guest/status`, {
      headers: { 'x-real-ip': ip2 },
    }).then((r) => r.json());
    assert.equal(statusNewIp.connected, true);
    assert.equal(statusNewIp.macAddress, mac);

    const capNewIp = await fetch(`${base}/api/guest/capport`, {
      headers: { 'x-real-ip': ip2 },
    }).then((r) => r.json());
    assert.equal(capNewIp.captive, false);
  } finally {
    server.closeAllConnections?.();
    server.close();
    db.close();
  }
});
