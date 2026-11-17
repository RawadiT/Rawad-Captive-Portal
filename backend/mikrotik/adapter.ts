import type { MikroTikActiveSession, MikroTikStatus } from '../types/index.js';

export interface GrantHotspotAccessInput {
  username: string;
  password: string;
  macAddress: string;
  ipAddress: string;
  sessionTimeoutSeconds: number;
  profile: string;
}

export interface GrantHotspotAccessResult {
  hotspotUserId: string;
  activeSessionId: string;
}

export interface RevokeHotspotAccessInput {
  username: string;
  macAddress?: string;
  profile?: string;
}

export interface ResolvedHotspotClient {
  macAddress: string;
  ipAddress: string;
}

export interface MikroTikAdapter {
  checkConnection(): Promise<MikroTikStatus>;
  resolveClientByIp(ipAddress: string): Promise<ResolvedHotspotClient | null>;
  grantHotspotAccess(input: GrantHotspotAccessInput): Promise<GrantHotspotAccessResult>;
  revokeHotspotAccess(input: RevokeHotspotAccessInput): Promise<void>;
  listActiveSessions(): Promise<MikroTikActiveSession[]>;
}
