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
  username: string;
  password: string;
  macAddress: string;
  limitUptimeSeconds: number | null;
  profile: string;
}

interface MockActiveEntry {
  id: string;
  user: string;
  address: string;
  macAddress: string;
  startedAtMs: number;
  limitUptimeSeconds: number | null;
}

export class MockMikroTikAdapter implements MikroTikAdapter {
  private connected = true;
  private simulateGrantFailure = false;
  private simulateRevokeFailure = false;
  private hosts = new Map<string, ResolvedHotspotClient>();
  private users = new Map<string, MockHotspotUser>();
  private active = new Map<string, MockActiveEntry>();
  private counter = 1;
  private nowProvider: () => number;

  constructor(nowProvider: () => number = () => Date.now()) {
    this.nowProvider = nowProvider;
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  setSimulateGrantFailure(fail: boolean): void {
    this.simulateGrantFailure = fail;
  }

  setSimulateRevokeFailure(fail: boolean): void {
    this.simulateRevokeFailure = fail;
  }

  registerHost(ipAddress: string, macAddress: string): void {
    const mac = macAddress.toUpperCase();
    this.hosts.set(ipAddress, { ipAddress, macAddress: mac });
  }

  unregisterHost(ipAddress: string): void {
    this.hosts.delete(ipAddress);
  }

  simulateActiveDrop(macAddress: string): void {
    const mac = macAddress.toUpperCase();
    for (const [key, entry] of this.active.entries()) {
      if (entry.macAddress.toUpperCase() === mac) {
        this.active.delete(key);
      }
    }
  }

  simulateReboot(): void {
    this.active.clear();
  }

  isMacAuthorized(macAddress: string): boolean {
    const normalized = macAddress.toUpperCase();
    for (const entry of this.active.values()) {
      if (entry.macAddress.toUpperCase() === normalized) {
        if (entry.limitUptimeSeconds === null) return true;
        const elapsed = Math.floor((this.nowProvider() - entry.startedAtMs) / 1000);
        return elapsed < entry.limitUptimeSeconds;
      }
    }
    return false;
  }

  async resolveClientByIp(ipAddress: string): Promise<ResolvedHotspotClient | null> {
    if (!this.connected) return null;
    return this.hosts.get(ipAddress) ?? null;
  }

  async checkConnection(): Promise<MikroTikStatus> {
    return {
      connected: this.connected,
      mode: 'mock',
      identity: this.connected ? 'Rawad-RB4011-MOCK' : null,
      lastCheckedAt: new Date(this.nowProvider()).toISOString(),
      error: this.connected ? null : 'Simulated MikroTik connection offline',
    };
  }

  async grantHotspotAccess(input: GrantHotspotAccessInput): Promise<GrantHotspotAccessResult> {
    if (!this.connected || this.simulateGrantFailure) {
      throw new Error('MikroTik unreachable or failed to create HotSpot session');
    }

    const normalizedMac = input.macAddress.toUpperCase();
    this.hosts.set(input.ipAddress, { ipAddress: input.ipAddress, macAddress: normalizedMac });

    for (const [key, entry] of this.active.entries()) {
      if (entry.macAddress.toUpperCase() === normalizedMac || entry.user === input.username) {
        this.active.delete(key);
      }
    }

    const userId = `*U${this.counter++}`;
    this.users.set(input.username, {
      id: userId,
      username: input.username,
      password: input.password,
      macAddress: normalizedMac,
      limitUptimeSeconds: input.limitUptimeSeconds,
      profile: input.profile,
    });

    const activeId = `*A${this.counter++}`;
    this.active.set(activeId, {
      id: activeId,
      user: input.username,
      address: input.ipAddress,
      macAddress: normalizedMac,
      startedAtMs: this.nowProvider(),
      limitUptimeSeconds: input.limitUptimeSeconds,
    });

    return {
      hotspotUserId: userId,
      activeSessionId: activeId,
    };
  }

  async revokeHotspotAccess(input: RevokeHotspotAccessInput): Promise<void> {
    if (!this.connected || this.simulateRevokeFailure) {
      throw new Error('MikroTik unreachable during revoke');
    }

    const normalizedMac = input.macAddress?.toUpperCase();
    for (const [key, entry] of this.active.entries()) {
      if (
        entry.user === input.username ||
        (normalizedMac && entry.macAddress.toUpperCase() === normalizedMac)
      ) {
        this.active.delete(key);
      }
    }
    this.users.delete(input.username);
  }

  async listActiveSessions(): Promise<MikroTikActiveSession[]> {
    if (!this.connected) {
      throw new Error('MikroTik unreachable during listActiveSessions');
    }

    const now = this.nowProvider();
    const result: MikroTikActiveSession[] = [];

    for (const [key, entry] of this.active.entries()) {
      const uptimeSeconds = Math.max(0, Math.floor((now - entry.startedAtMs) / 1000));
      let left: number | null = null;
      if (entry.limitUptimeSeconds !== null) {
        left = Math.max(0, entry.limitUptimeSeconds - uptimeSeconds);
        if (left === 0) {
          this.active.delete(key);
          continue;
        }
      }
      result.push({
        id: entry.id,
        user: entry.user,
        address: entry.address,
        macAddress: entry.macAddress,
        uptimeSeconds,
        sessionTimeLeftSeconds: left,
      });
    }

    return result;
  }
}
