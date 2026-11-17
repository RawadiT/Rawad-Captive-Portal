import fs from 'node:fs';
import https from 'node:https';
import type { MikroTikActiveSession, MikroTikStatus } from '../types/index.js';
import type {
  GrantHotspotAccessInput,
  GrantHotspotAccessResult,
  MikroTikAdapter,
  ResolvedHotspotClient,
  RevokeHotspotAccessInput,
} from './adapter.js';

export interface RouterOSRestConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  rejectUnauthorized: boolean;
  caCertPath?: string | null;
  hotspotServer: string;
  timeoutMs?: number;
}

function formatRouterOSDuration(seconds: number): string {
  const s = Math.max(1, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function parseRouterOSDuration(value?: string): number | null {
  if (!value) return null;
  let total = 0;
  const weeks = value.match(/(\d+)w/);
  const days = value.match(/(\d+)d/);
  const hours = value.match(/(\d+)h/);
  const mins = value.match(/(\d+)m(?!s)/);
  const secs = value.match(/(\d+)s/);
  if (weeks) total += Number(weeks[1]) * 7 * 86400;
  if (days) total += Number(days[1]) * 86400;
  if (hours) total += Number(hours[1]) * 3600;
  if (mins) total += Number(mins[1]) * 60;
  if (secs) total += Number(secs[1]);
  return total;
}

export class RouterOSRestClient implements MikroTikAdapter {
  private readonly cfg: RouterOSRestConfig;
  private readonly authHeader: string;
  private readonly agent: https.Agent;

  constructor(cfg: RouterOSRestConfig) {
    this.cfg = cfg;
    this.authHeader = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`;
    const ca =
      cfg.caCertPath && fs.existsSync(cfg.caCertPath)
        ? fs.readFileSync(cfg.caCertPath, 'utf8')
        : undefined;
    this.agent = new https.Agent({
      rejectUnauthorized: cfg.rejectUnauthorized,
      ...(ca ? { ca } : {}),
      keepAlive: true,
    });
  }

  private async request<T>(method: string, path: string, body?: unknown, retries = 2): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.requestOnce<T>(method, path, body);
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private requestOnce<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const req = https.request(
        {
          hostname: this.cfg.host,
          port: this.cfg.port,
          path: `/rest${path}`,
          method,
          agent: this.agent,
          timeout: this.cfg.timeoutMs ?? 5000,
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 500;
            if (status >= 200 && status < 300) {
              if (!raw) return resolve(undefined as T);
              try {
                resolve(JSON.parse(raw) as T);
              } catch {
                resolve(raw as unknown as T);
              }
            } else {
              reject(new Error(`RouterOS REST HTTP ${status}: ${raw}`));
            }
          });
        }
      );

      req.on('timeout', () => req.destroy(new Error('RouterOS REST request timed out')));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async resolveClientByIp(ipAddress: string): Promise<ResolvedHotspotClient | null> {
    const cleanIp = ipAddress.replace(/^::ffff:/, '').trim();
    if (!cleanIp) return null;

    const hosts = await this.request<Array<{ address?: string; 'mac-address'?: string }>>(
      'GET',
      `/ip/hotspot/host?address=${encodeURIComponent(cleanIp)}`
    );
    const match = hosts.find((h) => h.address === cleanIp && h['mac-address']);
    if (!match || !match['mac-address']) return null;

    return {
      ipAddress: cleanIp,
      macAddress: match['mac-address'].toUpperCase(),
    };
  }

  async checkConnection(): Promise<MikroTikStatus> {
    try {
      const res = await this.request<{ name?: string }>('GET', '/system/identity', undefined, 0);
      return {
        connected: true,
        mode: 'routeros-rest',
        identity: res?.name || 'MikroTik-RouterOS',
        lastCheckedAt: new Date().toISOString(),
        error: null,
      };
    } catch (err) {
      return {
        connected: false,
        mode: 'routeros-rest',
        identity: null,
        lastCheckedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Enforces per-session wall-clock expiration using a dedicated HotSpot User Profile
   * with `session-timeout` (NOT `limit-uptime`).
   * - Cleans up partial resources on failure.
   * - Never claims ownership of pre-existing non-project profiles/users.
   * - Never stores a permanent MAC restriction on ordinary accounts (`bindMac=false`).
   */
  async grantHotspotAccess(input: GrantHotspotAccessInput): Promise<GrantHotspotAccessResult> {
    const timeoutStr = formatRouterOSDuration(input.sessionTimeoutSeconds);
    let createdProfile = false;
    let createdUserId: string | null = null;

    // 1. Verify or create project-owned HotSpot User Profile
    const existingProfiles = await this.request<Array<{ '.id': string; comment?: string }>>(
      'GET',
      `/ip/hotspot/user/profile?name=${encodeURIComponent(input.profile)}`
    );
    if (existingProfiles.length > 0) {
      if (existingProfiles[0].comment !== 'rawad-guest-portal-managed') {
        throw new Error(`Conflict: HotSpot profile '${input.profile}' already exists and is not project-owned`);
      }
      await this.request(
        'PATCH',
        `/ip/hotspot/user/profile/${encodeURIComponent(existingProfiles[0]['.id'])}`,
        {
          'session-timeout': timeoutStr,
          'keepalive-timeout': '00:02:00',
          'shared-users': '1',
        }
      );
    } else {
      await this.request('PUT', '/ip/hotspot/user/profile', {
        name: input.profile,
        'session-timeout': timeoutStr,
        'keepalive-timeout': '00:02:00',
        'shared-users': '1',
        comment: 'rawad-guest-portal-managed',
      });
      createdProfile = true;
    }

    try {
      // 2. Verify no pre-existing non-project HotSpot user conflict, replace only project-owned user
      const existingUsers = await this.request<Array<{ '.id': string; comment?: string }>>(
        'GET',
        `/ip/hotspot/user?name=${encodeURIComponent(input.username)}`
      );
      for (const u of existingUsers) {
        if (u.comment !== 'rawad-guest-portal-managed') {
          throw new Error(`Conflict: HotSpot user '${input.username}' already exists and is not project-owned`);
        }
        await this.request('DELETE', `/ip/hotspot/user/${encodeURIComponent(u['.id'])}`);
      }

      const userPayload: Record<string, string> = {
        name: input.username,
        password: input.password,
        profile: input.profile,
        server: this.cfg.hotspotServer,
        comment: 'rawad-guest-portal-managed',
      };
      // Free quota remains associated with MAC; ordinary accounts must NOT store a MAC restriction
      if (input.bindMac) {
        userPayload['mac-address'] = input.macAddress.toUpperCase();
      }

      const createdUser = await this.request<{ '.id': string }>('PUT', '/ip/hotspot/user', userPayload);
      createdUserId = createdUser?.['.id'] || null;

      // 3. Programmatically log the device in to HotSpot active table
      const loginResult = await this.request<{ ret?: string }>('POST', '/ip/hotspot/active/login', {
        user: input.username,
        password: input.password,
        ip: input.ipAddress,
        'mac-address': input.macAddress.toUpperCase(),
      });

      return {
        hotspotUserId: createdUserId || input.username,
        activeSessionId: loginResult?.ret || input.username,
      };
    } catch (err) {
      // Partial provisioning cleanup on RouterOS failure
      if (createdUserId) {
        await this.request('DELETE', `/ip/hotspot/user/${encodeURIComponent(createdUserId)}`).catch(() => {});
      }
      if (createdProfile) {
        const profiles = await this.request<Array<{ '.id': string; comment?: string }>>(
          'GET',
          `/ip/hotspot/user/profile?name=${encodeURIComponent(input.profile)}`
        ).catch(() => []);
        for (const p of profiles) {
          if (p.comment === 'rawad-guest-portal-managed') {
            await this.request('DELETE', `/ip/hotspot/user/profile/${encodeURIComponent(p['.id'])}`).catch(() => {});
          }
        }
      }
      throw err;
    }
  }

  async revokeHotspotAccess(input: RevokeHotspotAccessInput): Promise<void> {
    const actives = await this.request<Array<{ '.id': string; user?: string; 'mac-address'?: string }>>(
      'GET',
      '/ip/hotspot/active'
    );
    const macUpper = input.macAddress?.toUpperCase();
    for (const a of actives) {
      // Never disconnect unrelated sessions belonging to other accounts merely because they share a MAC
      const userMatches = a.user === input.username;
      const macMatches = !macUpper || a['mac-address']?.toUpperCase() === macUpper;
      if (userMatches && macMatches) {
        await this.request('DELETE', `/ip/hotspot/active/${encodeURIComponent(a['.id'])}`);
      }
    }

    const users = await this.request<Array<{ '.id': string; comment?: string }>>(
      'GET',
      `/ip/hotspot/user?name=${encodeURIComponent(input.username)}`
    );
    for (const u of users) {
      if (u.comment === 'rawad-guest-portal-managed') {
        await this.request('DELETE', `/ip/hotspot/user/${encodeURIComponent(u['.id'])}`);
      }
    }

    if (input.profile) {
      const profiles = await this.request<Array<{ '.id': string; comment?: string }>>(
        'GET',
        `/ip/hotspot/user/profile?name=${encodeURIComponent(input.profile)}`
      );
      for (const p of profiles) {
        if (p.comment === 'rawad-guest-portal-managed') {
          await this.request('DELETE', `/ip/hotspot/user/profile/${encodeURIComponent(p['.id'])}`);
        }
      }
    }
  }

  async listActiveSessions(): Promise<MikroTikActiveSession[]> {
    const rows = await this.request<
      Array<{
        '.id': string;
        user?: string;
        address?: string;
        'mac-address'?: string;
        uptime?: string;
        'session-time-left'?: string;
      }>
    >('GET', '/ip/hotspot/active');

    return rows.map((r) => ({
      id: r['.id'],
      user: r.user || '',
      address: r.address || '',
      macAddress: (r['mac-address'] || '').toUpperCase(),
      uptimeSeconds: parseRouterOSDuration(r.uptime) ?? 0,
      sessionTimeLeftSeconds: parseRouterOSDuration(r['session-time-left']),
    }));
  }
}
