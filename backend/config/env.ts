import path from 'node:path';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  databasePath: string;
  schemaDir: string;
  tokenSecret: string;
  mikrotikMode: 'mock' | 'rest';
  mikrotikHost: string;
  mikrotikPort: number;
  mikrotikUsername: string;
  mikrotikPassword: string;
  mikrotikTlsRejectUnauthorized: boolean;
  mikrotikCaCertPath: string | null;
  mikrotikHotspotServer: string;
  mikrotikProfileFree: string;
  mikrotikProfileUser: string;
  freeQuotaSeconds: number;
  sessionSyncIntervalMs: number;
  guestPortalOrigin: string;
  adminDashboardOrigin: string;
  defaultSuperAdminUsername: string;
  defaultSuperAdminPassword: string;
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
]);

export function validateProductionSecrets(cfg: AppConfig): void {
  if (cfg.nodeEnv !== 'production') return;

  if (!cfg.tokenSecret || cfg.tokenSecret.length < 32 || INSECURE_PLACEHOLDERS.has(cfg.tokenSecret)) {
    throw new Error('FATAL: TOKEN_SECRET must be at least 32 chars and not a default placeholder in production');
  }
  if (!cfg.defaultSuperAdminPassword || INSECURE_PLACEHOLDERS.has(cfg.defaultSuperAdminPassword)) {
    throw new Error('FATAL: DEFAULT_SUPER_ADMIN_PASSWORD must be changed from default in production');
  }
  if (!cfg.guestPortalOrigin || cfg.guestPortalOrigin.includes('.local') || cfg.guestPortalOrigin.includes('YOUR_COMPANY_DOMAIN')) {
    throw new Error('FATAL: GUEST_PORTAL_ORIGIN must be set to a real company-owned domain in production');
  }
  if (process.env.GUEST_PROXY_BIND_IP === '0.0.0.0') {
    throw new Error('FATAL: GUEST_PROXY_BIND_IP must not be 0.0.0.0 in production; bind to explicit server IP');
  }
  if (cfg.mikrotikMode === 'rest') {
    if (!cfg.mikrotikPassword || INSECURE_PLACEHOLDERS.has(cfg.mikrotikPassword)) {
      throw new Error('FATAL: MIKROTIK_API_PASSWORD must be set and not a placeholder in production');
    }
    if (!cfg.mikrotikTlsRejectUnauthorized) {
      throw new Error('FATAL: MIKROTIK_TLS_VERIFY must be true in production');
    }
  }
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const rootDir = process.env.PROJECT_ROOT || path.resolve(process.cwd(), '..');
  const mikrotikMode = process.env.MIKROTIK_MODE === 'rest' ? 'rest' : 'mock';
  const isProd = nodeEnv === 'production';

  const cfg: AppConfig = {
    nodeEnv,
    port: Number(process.env.PORT || 4000),
    host: process.env.HOST || '127.0.0.1',
    databasePath: process.env.DATABASE_PATH || path.resolve(rootDir, 'database', 'rawad_portal.db'),
    schemaDir: process.env.SCHEMA_DIR || path.resolve(rootDir, 'database', 'schema'),
    tokenSecret: process.env.TOKEN_SECRET || (isProd ? '' : 'rawad-tech-local-dev-secret-change-in-production'),
    mikrotikMode,
    mikrotikHost: process.env.MIKROTIK_HOST || '192.168.20.1',
    mikrotikPort: Number(process.env.MIKROTIK_REST_PORT || 443),
    mikrotikUsername: process.env.MIKROTIK_API_USER || 'rawad-api',
    mikrotikPassword: process.env.MIKROTIK_API_PASSWORD || '',
    mikrotikTlsRejectUnauthorized:
      process.env.MIKROTIK_TLS_VERIFY !== undefined
        ? process.env.MIKROTIK_TLS_VERIFY === 'true'
        : true,
    mikrotikCaCertPath: process.env.MIKROTIK_CA_CERT_PATH || null,
    mikrotikHotspotServer: process.env.MIKROTIK_HOTSPOT_SERVER || 'rawad-guest-hotspot',
    mikrotikProfileFree: process.env.MIKROTIK_PROFILE_FREE || 'rawad-free-30m',
    mikrotikProfileUser: process.env.MIKROTIK_PROFILE_USER || 'rawad-user',
    freeQuotaSeconds: Number(process.env.FREE_QUOTA_SECONDS || 1800),
    sessionSyncIntervalMs: Number(process.env.SESSION_SYNC_INTERVAL_MS || 5000),
    guestPortalOrigin: process.env.GUEST_PORTAL_ORIGIN || 'https://wifi.YOUR_COMPANY_DOMAIN.com',
    adminDashboardOrigin: process.env.ADMIN_DASHBOARD_ORIGIN || 'http://127.0.0.1:3001',
    defaultSuperAdminUsername: process.env.DEFAULT_SUPER_ADMIN_USER || 'superadmin',
    defaultSuperAdminPassword:
      process.env.DEFAULT_SUPER_ADMIN_PASSWORD || (isProd ? '' : 'Rawad@2026!'),
    trustProxy: process.env.TRUST_PROXY === 'true',
    allowDevMacFallback: !isProd && process.env.ALLOW_DEV_MAC_FALLBACK === 'true',
  };

  validateProductionSecrets(cfg);
  return cfg;
}
