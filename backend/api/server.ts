import { AdminService } from '../authentication/adminService.js';
import { loadConfig } from '../config/env.js';
import { SupabaseDatabaseClient } from '../db/supabaseClient.js';
import type { MikroTikAdapter } from '../mikrotik/adapter.js';
import { MockMikroTikAdapter } from '../mikrotik/mockAdapter.js';
import { RouterOSRestClient } from '../mikrotik/restClient.js';
import { QuotaService } from '../quota-manager/quotaService.js';
import { SessionMonitor } from '../session-monitor/sessionMonitor.js';
import { createApp } from './app.js';

async function main() {
  const config = loadConfig();
  if (process.env.RAWAD_FIELD_TEST_PACKAGE_LOCK === 'true') {
    if (
      !config.fieldTestMode ||
      config.mikrotikMode !== 'mock' ||
      config.nodeEnv !== 'development' ||
      config.host !== '127.0.0.1'
    ) {
      throw new Error(
        'FATAL: Field-Test package requires FIELD_TEST_MODE=true, MIKROTIK_MODE=mock, NODE_ENV=development, and HOST=127.0.0.1'
      );
    }
  }
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const db = new SupabaseDatabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  await db.ping();

  const adminService = new AdminService(db, config.tokenSecret);
  await adminService.ensureDefaultAdmin(config.defaultAdminUsername, config.defaultAdminPassword);

  const mikrotik: MikroTikAdapter =
    config.mikrotikMode === 'mock'
      ? new MockMikroTikAdapter()
      : new RouterOSRestClient({
          host: config.mikrotikHost,
          port: config.mikrotikPort,
          username: config.mikrotikUsername,
          password: config.mikrotikPassword,
          rejectUnauthorized: config.mikrotikTlsRejectUnauthorized,
          caCertPath: config.mikrotikCaCertPath,
          hotspotServer: config.mikrotikHotspotServer,
        });

  const quotaService = new QuotaService(db, mikrotik, {
    freeQuotaSeconds: config.freeQuotaSeconds,
  });

  const sessionMonitor = new SessionMonitor(db, mikrotik);
  sessionMonitor.start(config.sessionSyncIntervalMs);

  const app = createApp({
    config,
    db,
    adminService,
    quotaService,
    sessionMonitor,
    mikrotik,
  });

  const server = app.listen(config.port, config.host, () => {
    console.log(
      `[Rawad Captive Portal Backend] running on http://${config.host}:${config.port} (DB: Supabase HTTPS, MikroTik: ${config.mikrotikMode}, FieldTest: ${config.fieldTestMode})`
    );
  });

  process.on('SIGINT', () => {
    sessionMonitor.stop();
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('[Startup Error]', err instanceof Error ? err.message : err);
  process.exit(1);
});
