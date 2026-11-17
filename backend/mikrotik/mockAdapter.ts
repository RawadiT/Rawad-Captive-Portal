import type { MikroTikActiveSession, MikroTikStatus } from '../types/index.js';
import type {
  GrantHotspotAccessInput,
  GrantHotspotAccessResult,
  MikroTikAdapter,
  ResolvedHotspotClient,
  RevokeHotspotAccessInput,
} from './adapter.js';

interface MockHotspotUser {
  id: string;
  name: string;
  password: string;
  macAddress?: string;
  profile: string;
  limitUptimeSeconds: number;
}

/**
 * In-memory MikroTik HotSpot simulator for isolated Field-Test mode.
 * Never opens network sockets or contacts any physical RouterOS device.
 */
export class MockMikroTikAdapter implements MikroTikAdapter {
  private seq = 1;
  private readonly users = new Map<string, MockHotspotUser>();
  private readonly activeByKey = new Map<string, MikroTikActiveSession>();
  private readonly ipToMac = new Map<string, string>();

  constructor(seedClients: Array<{ ipAddress: string; macAddress: string }> = []) {
    for (const c of seedClients) {
      this.ipToMac.set(c.ipAddress, c.macAddress.toUpperCase());
    }
  }

  seedClient(ipAddress: string, macAddress: string): void {
    this.ipToMac.set(ipAddress, macAddress.toUpperCase());
  }

  getStoredUser(username: string): MockHotspotUser | undefined {
    return this.users.get(username);
  }

  async checkConnection(): Promise<MikroTikStatus> {
    return {
      connected: true,
      mode: 'mock',
      identity: 'mock-field-test-router',
      lastCheckedAt: new Date().toISOString(),
      error: null,
    };
  }

  async resolveClientByIp(ipAddress: string): Promise<ResolvedHotspotClient | null> {
    const mac = this.ipToMac.get(ipAddress);
    if (!mac) return null;
    return { macAddress: mac, ipAddress };
  }

  async grantHotspotAccess(input: GrantHotspotAccessInput): Promise<GrantHotspotAccessResult> {
    const mac = input.macAddress.toUpperCase();
    const userId = `mock-usr-${this.seq++}`;
    const activeId = `mock-act-${this.seq++}`;

    this.users.set(input.username, {
      id: userId,
      name: input.username,
      password: input.password,
      macAddress: input.bindMac ? mac : undefined,
      profile: input.profile,
      limitUptimeSeconds: input.sessionTimeoutSeconds,
    });

    const key = `${input.username}|${mac}`;
    this.activeByKey.set(key, {
      id: activeId,
      user: input.username,
      address: input.ipAddress,
      macAddress: mac,
      uptimeSeconds: 0,
      sessionTimeLeftSeconds: input.sessionTimeoutSeconds,
    });

    return { hotspotUserId: userId, activeSessionId: activeId };
  }

  async revokeHotspotAccess(input: RevokeHotspotAccessInput): Promise<void> {
    this.users.delete(input.username);
    for (const [key, sess] of this.activeByKey.entries()) {
      const macMatches = !input.macAddress || sess.macAddress === input.macAddress.toUpperCase();
      if (sess.user === input.username && macMatches) {
        this.activeByKey.delete(key);
      }
    }
  }

  async listActiveSessions(): Promise<MikroTikActiveSession[]> {
    return [...this.activeByKey.values()];
  }
}
