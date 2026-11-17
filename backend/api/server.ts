import { AuditService } from '../audit-logs/auditService.js';
import { AdminService } from '../authentication/adminService.js';
import { openDatabase } from '../config/db.js';
import { loadConfig } from '../config/env.js';
import type { MikroTikAdapter } from '../mikrotik/adapter.js';
import { MockMikroTikAdapter } from '../mikrotik/mockAdapter.js';
import { RouterOSRestClient } from '../mikrotik/restClient.js';
import { QuotaService } from '../quota-manager/quotaService.js';
import { SessionMonitor } from '../session-monitor/sessionMonitor.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = openDatabase(config.databasePath, config.schemaDir);

const auditService = new AuditService(db);
const adminService = new AdminService(db, auditService, config.tokenSecret);
adminService.ensureDefaultSuperAdmin(config.defaultSuperAdminUsername, config.defaultSuperAdminPassword);

const mikrotik: MikroTikAdapter =
  config.mikrotikMode === 'rest'
    ? new RouterOSRestClient({
        host: config.mikrotikHost,
        port: config.mikrotikPort,
        username: config.mikrotikUsername,
        password: config.mikrotikPassword,
        rejectUnauthorized: config.mikrotikTlsRejectUnauthorized,
        caCertPath: config.mikrotikCaCertPath,
        hotspotServer: config.mikrotikHotspotServer,
      })
    : new MockMikroTikAdapter();

const quotaService = new QuotaService(db, mikrotik, auditService, {
  freeQuotaSeconds: config.freeQuotaSeconds,
  profileFree: config.mikrotikProfileFree,
  profileUser: config.mikrotikProfileUser,
});

const sessionMonitor = new SessionMonitor(db, mikrotik, auditService);
sessionMonitor.start(config.sessionSyncIntervalMs);

const app = createApp({
  config,
  adminService,
  quotaService,
  sessionMonitor,
  auditService,
  mikrotik,
});

const server = app.listen(config.port, config.host, () => {
  console.log(
    `[Rawad Captive Portal Backend] running on http://${config.host}:${config.port} (MikroTik mode: ${config.mikrotikMode})`
  );
});

process.on('SIGINT', () => {
  sessionMonitor.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
