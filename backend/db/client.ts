import type {
  AdminRecord,
  FreeQuotaRecord,
  SessionRecord,
  SessionStatus,
  UserRecord,
} from '../types/index.js';

export interface CommitFreeSessionResult {
  allowed: boolean;
  is_new: boolean;
  session_id: string | null;
  mac_address: string;
  started_at: string;
  expires_at: string;
  remaining_seconds: number;
}

export interface CommitUserSessionResult {
  allowed: boolean;
  session_id: string | null;
  started_at: string | null;
  expires_at: string | null;
  remaining_seconds: number;
}

export interface DatabaseClient {
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

  // Free Quotas (One-time 30 minutes per MAC, never deleted)
  listFreeQuotas(): Promise<FreeQuotaRecord[]>;
  getFreeQuota(macAddress: string): Promise<FreeQuotaRecord | null>;

  // Atomic PostgreSQL RPCs (with pg_advisory_xact_lock)
  commitFreeSession(input: {
    macAddress: string;
    ipAddress: string;
    hotspotUsername: string;
    hotspotProfile: string;
    durationSeconds: number;
  }): Promise<CommitFreeSessionResult>;

  commitUserSession(input: {
    userId: string;
    macAddress: string;
    ipAddress: string;
    hotspotUsername: string;
    hotspotProfile: string;
  }): Promise<CommitUserSessionResult>;

  // Sessions
  getActiveSessionByMac(macAddress: string): Promise<SessionRecord | null>;
  listActiveSessions(): Promise<SessionRecord[]>;
  listActiveSessionsByUserId(userId: string): Promise<SessionRecord[]>;
  updateSessionStatus(id: string, status: SessionStatus): Promise<void>;
}
