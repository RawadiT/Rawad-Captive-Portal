export interface AppConfig {
  nodeEnv: string;
  fieldTestMode: boolean;
  mikrotikMode: 'routeros-rest' | 'mock';
  port: number;
  host: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  tokenSecret: string;
  mikrotikHost: string;
  mikrotikPort: number;
  mikrotikUsername: string;
  mikrotikPassword: string;
  mikrotikTlsRejectUnauthorized: boolean;
  mikrotikCaCertPath: string | null;
  mikrotikHotspotServer: string;
  freeQuotaSeconds: number;
  sessionSyncIntervalMs: number;
  guestPortalOrigin: string;
  adminDashboardOrigin: string;
  defaultAdminUsername: string;
  defaultAdminPassword: string;
  trustProxy: boolean;
  allowDevMacFallback: boolean;
}

const INSECURE_PLACEHOLDERS = new Set([
  '',
  'rawad-tech-local-dev-secret-change-in-production',
  'REPLACE_WITH_LONG_RANDOM_SECRET_64_CHARS',
  'Rawad@2026!',
  'Rawad@2026!ChangeMe',
  'REPLACE_WITH_API_PASSWORD',
  'CHANGE_THIS_STRONG_API_PASSWORD',
  'REPLACE_WITH_SUPABASE_SERVICE_ROLE_KEY',
  'https://YOUR_PROJECT_ID.supabase.co',
]);

export function validateFieldTestIsolation(cfg: AppConfig): void {
  if (!cfg.fieldTestMode) return;

  if (cfg.nodeEnv === 'production') {
    throw new Error('FATAL: FIELD_TEST_MODE=true is forbidden when NODE_ENV=production');
  }
  if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
    throw new Error(`FATAL: FIELD_TEST_MODE requires loopback HOST (127.0.0.1 or localhost), got '${cfg.host}'`);
  }
  if (cfg.mikrotikMode !== 'mock') {
    throw new Error('FATAL: FIELD_TEST_MODE requires MIKROTIK_MODE=mock (never connect to real MikroTik)');
  }
  if (cfg.mikrotikHost && cfg.mikrotikHost !== 'mock.local' && cfg.mikrotikHost !== '127.0.0.1') {
    throw new Error(`FATAL: FIELD_TEST_MODE forbids non-mock MIKROTIK_HOST (${cfg.mikrotikHost})`);
  }
  if (
    cfg.supabaseUrl &&
    (/^https?:\/\/[^/]*\.supabase\.(co|in)/i.test(cfg.supabaseUrl) ||
      !(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(cfg.supabaseUrl)))
  ) {
    throw new Error(`FATAL: FIELD_TEST_MODE forbids non-local or production SUPABASE_URL (${cfg.supabaseUrl})`);
  }
  if (
    cfg.guestPortalOrigin &&
    !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(cfg.guestPortalOrigin)
  ) {
    throw new Error(`FATAL: FIELD_TEST_MODE requires local GUEST_PORTAL_ORIGIN (${cfg.guestPortalOrigin})`);
  }
  if (
    cfg.adminDashboardOrigin &&
    !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(cfg.adminDashboardOrigin)
  ) {
    throw new Error(`FATAL: FIELD_TEST_MODE requires local ADMIN_DASHBOARD_ORIGIN (${cfg.adminDashboardOrigin})`);
  }
}

export function validateProductionSecrets(cfg: AppConfig): void {
  if (cfg.nodeEnv !== 'production') return;

  if (cfg.fieldTestMode || cfg.mikrotikMode === 'mock') {
    throw new Error('FATAL: FIELD_TEST_MODE and MIKROTIK_MODE=mock are forbidden in production');
  }

  if (!cfg.supabaseUrl || !cfg.supabaseUrl.startsWith('https://') || INSECURE_PLACEHOLDERS.has(cfg.supabaseUrl)) {
    throw new Error('FATAL: SUPABASE_URL must be a valid https:// URL in production');
  }
  if (!cfg.supabaseServiceRoleKey || INSECURE_PLACEHOLDERS.has(cfg.supabaseServiceRoleKey)) {
    throw new Error('FATAL: SUPABASE_SERVICE_ROLE_KEY must be set in production');
  }
  if (!cfg.tokenSecret || cfg.tokenSecret.length < 32 || INSECURE_PLACEHOLDERS.has(cfg.tokenSecret)) {
    throw new Error('FATAL: TOKEN_SECRET must be at least 32 chars and not a placeholder in production');
  }
  if (!cfg.defaultAdminPassword || INSECURE_PLACEHOLDERS.has(cfg.defaultAdminPassword)) {
    throw new Error('FATAL: DEFAULT_ADMIN_PASSWORD must be changed from default in production');
  }
  if (!cfg.guestPortalOrigin || cfg.guestPortalOrigin.includes('.local') || cfg.guestPortalOrigin.includes('YOUR_COMPANY_DOMAIN')) {
    throw new Error('FATAL: GUEST_PORTAL_ORIGIN must be set to a real domain in production');
  }
  if (process.env.GUEST_PROXY_BIND_IP === '0.0.0.0') {
    throw new Error('FATAL: GUEST_PROXY_BIND_IP must not be 0.0.0.0 in production');
  }
  if (!cfg.mikrotikPassword || INSECURE_PLACEHOLDERS.has(cfg.mikrotikPassword)) {
    throw new Error('FATAL: MIKROTIK_API_PASSWORD must be set in production');
  }
  if (!cfg.mikrotikTlsRejectUnauthorized) {
    throw new Error('FATAL: MIKROTIK_TLS_VERIFY must be true in production');
  }
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const fieldTestMode = process.env.FIELD_TEST_MODE === 'true';
  const mikrotikModeRaw = process.env.MIKROTIK_MODE || (fieldTestMode ? 'mock' : 'routeros-rest');
  if (mikrotikModeRaw !== 'mock' && mikrotikModeRaw !== 'routeros-rest') {
    throw new Error(`FATAL: Invalid MIKROTIK_MODE '${mikrotikModeRaw}'`);
  }

  const cfg: AppConfig = {
    nodeEnv,
    fieldTestMode,
    mikrotikMode: mikrotikModeRaw,
    port: Number(process.env.PORT || 4000),
    host: process.env.HOST || '127.0.0.1',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    tokenSecret: process.env.TOKEN_SECRET || (isProd ? '' : 'rawad-tech-local-dev-secret-change-in-production'),
    mikrotikHost: process.env.MIKROTIK_HOST || (fieldTestMode ? 'mock.local' : '192.168.20.1'),
    mikrotikPort: Number(process.env.MIKROTIK_REST_PORT || 443),
    mikrotikUsername: process.env.MIKROTIK_API_USER || 'rawad-api',
    mikrotikPassword: process.env.MIKROTIK_API_PASSWORD || '',
    mikrotikTlsRejectUnauthorized:
      process.env.MIKROTIK_TLS_VERIFY !== undefined
        ? process.env.MIKROTIK_TLS_VERIFY === 'true'
        : true,
    mikrotikCaCertPath: process.env.MIKROTIK_CA_CERT_PATH || null,
    mikrotikHotspotServer: process.env.MIKROTIK_HOTSPOT_SERVER || 'rawad-guest-hotspot',
    freeQuotaSeconds: Number(process.env.FREE_QUOTA_SECONDS || 1800),
    sessionSyncIntervalMs: Number(process.env.SESSION_SYNC_INTERVAL_MS || 5000),
    guestPortalOrigin:
      process.env.GUEST_PORTAL_ORIGIN ||
      (fieldTestMode ? 'http://127.0.0.1:3000' : 'https://wifi.YOUR_COMPANY_DOMAIN.com'),
    adminDashboardOrigin: process.env.ADMIN_DASHBOARD_ORIGIN || 'http://127.0.0.1:3001',
    defaultAdminUsername: process.env.DEFAULT_ADMIN_USER || 'admin',
    defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || (isProd ? '' : 'Rawad@2026!'),
    trustProxy: process.env.TRUST_PROXY === 'true',
    allowDevMacFallback: !isProd && process.env.ALLOW_DEV_MAC_FALLBACK === 'true',
  };

  validateFieldTestIsolation(cfg);
  validateProductionSecrets(cfg);
  return cfg;
}
