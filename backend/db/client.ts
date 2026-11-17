import type {
  AdminRecord,
  FreeQuotaRecord,
  SessionRecord,
  SessionStatus,
  UserRecord,
} from '../types/index.js';

export interface ClaimFreeQuotaResult {
  allowed: boolean;
  is_new: boolean;
  mac_address: string;
  started_at: string;
  expires_at: string;
  remaining_seconds: number;
}

export interface ActivatedUserResult {
  id: string;
  username: string;
  duration_minutes: number;
  started_at: string;
  expires_at: string;
  is_disabled: boolean;
  remaining_seconds: number;
}

export interface DatabaseClient {
  // Health check
  ping(): Promise<boolean>;

  // Admins
  getAdminByUsername(username: string): Promise<AdminRecord | null>;
  countAdmins(): Promise<number>;
  createAdmin(username: string, passwordHash: string): Promise<AdminRecord>;

  // Users
  listUsers(): Promise<UserRecord[]>;
  getUserByUsername(username: string): Promise<UserRecord | null>;
  getUserById(id: string): Promise<UserRecord | null>;
  createUser(input: { username: string; password_hash: string; duration_minutes: number }): Promise<UserRecord>;
  setUserDisabled(id: string, isDisabled: boolean): Promise<UserRecord | null>;
  activateUserOnFirstLogin(userId: string): Promise<ActivatedUserResult | null>;

  // Free Quotas (One-time 30 minutes per MAC, never deleted)
  listFreeQuotas(): Promise<FreeQuotaRecord[]>;
  getFreeQuota(macAddress: string): Promise<FreeQuotaRecord | null>;
  claimFreeQuota(macAddress: string, durationSeconds: number): Promise<ClaimFreeQuotaResult>;

  // Sessions
  createSession(input: Omit<SessionRecord, 'id' | 'created_at'>): Promise<SessionRecord>;
  getActiveSessionByMac(macAddress: string): Promise<SessionRecord | null>;
  listActiveSessions(): Promise<SessionRecord[]>;
  listActiveSessionsByUserId(userId: string): Promise<SessionRecord[]>;
  updateSessionStatus(id: string, status: SessionStatus): Promise<void>;
}
