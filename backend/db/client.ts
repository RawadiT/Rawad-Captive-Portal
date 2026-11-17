import type {
  AdminRecord,
  FreeQuotaRecord,
  SessionRecord,
  SessionStatus,
  UserRecord,
} from '../types/index.js';

export interface BeginFreeProvisioningResult {
  allowed: boolean;
  conflict_active: boolean;
  session_id: string | null;
  remaining_seconds: number;
}

export interface FinalizeFreeSessionResult {
  allowed: boolean;
  is_new: boolean;
  session_id: string;
  mac_address: string;
  started_at: string;
  expires_at: string;
  remaining_seconds: number;
}

export interface BeginUserProvisioningResult {
  allowed: boolean;
  session_id: string | null;
  remaining_seconds: number;
}

export interface FinalizeUserSessionResult {
  allowed: boolean;
  session_id: string;
  started_at: string | null;
  expires_at: string | null;
  remaining_seconds: number;
}

export interface MonitorLockResult {
  acquired: boolean;
  fence_token: number;
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

  // Free Quotas
  listFreeQuotas(): Promise<FreeQuotaRecord[]>;
  getFreeQuota(macAddress: string): Promise<FreeQuotaRecord | null>;

  // 3-Step PostgreSQL-Locked Provisioning RPCs
  beginFreeProvisioning(input: {
    macAddress: string;
    ipAddress: string;
    hotspotUsername: string;
    hotspotProfile: string;
    durationSeconds: number;
  }): Promise<BeginFreeProvisioningResult>;

  finalizeFreeSession(sessionId: string, durationSeconds: number): Promise<FinalizeFreeSessionResult>;

  beginUserProvisioning(input: {
    userId: string;
    macAddress: string;
    ipAddress: string;
    hotspotUsername: string;
    hotspotProfile: string;
  }): Promise<BeginUserProvisioningResult>;

  finalizeUserSession(sessionId: string): Promise<FinalizeUserSessionResult>;

  abortProvisioning(sessionId: string): Promise<void>;

  markRevocationPending(sessionId: string): Promise<void>;

  reclaimExpiredProvisioningLeases(): Promise<number>;

  renewProvisioningLease(sessionId: string, extendSeconds?: number): Promise<boolean>;

  tryAcquireMonitorLock(lockName: string, ownerId: string, leaseSeconds?: number): Promise<MonitorLockResult>;

  fencedUpdateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    lockName: string,
    ownerId: string,
    fenceToken: number
  ): Promise<boolean>;

  releaseMonitorLock(lockName: string, ownerId: string): Promise<void>;

  // Sessions
  getActiveSessionByMac(macAddress: string): Promise<SessionRecord | null>;
  listActiveSessions(): Promise<SessionRecord[]>;
  listRevocationPendingSessions(): Promise<SessionRecord[]>;
  listActiveSessionsByUserId(userId: string): Promise<SessionRecord[]>;
  updateSessionStatus(id: string, status: SessionStatus): Promise<void>;
}
