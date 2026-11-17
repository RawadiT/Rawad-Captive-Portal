import crypto from 'node:crypto';
import type {
  AdminRecord,
  FreeQuotaRecord,
  SessionRecord,
  SessionStatus,
  UserRecord,
} from '../types/index.js';
import type { ActivatedUserResult, ClaimFreeQuotaResult, DatabaseClient } from './client.js';

/**
 * In-memory DatabaseClient for automated testing (mirrors Supabase PostgreSQL RPC semantics).
 * Never writes to local disk.
 */
export class MockDatabaseClient implements DatabaseClient {
  private admins = new Map<string, AdminRecord>();
  private users = new Map<string, UserRecord>();
  private freeQuotas = new Map<string, FreeQuotaRecord>();
  private sessions = new Map<string, SessionRecord>();
  private failAll = false;
  private failNextCreateSession = false;
  private nowProvider: () => Date;

  constructor(nowProvider: () => Date = () => new Date()) {
    this.nowProvider = nowProvider;
  }

  setFailAll(fail: boolean): void {
    this.failAll = fail;
  }

  setFailNextCreateSession(fail: boolean): void {
    this.failNextCreateSession = fail;
  }

  private guard(): void {
    if (this.failAll) {
      throw new Error('Simulated Supabase connection outage');
    }
  }

  async ping(): Promise<boolean> {
    this.guard();
    return true;
  }

  async getAdminByUsername(username: string): Promise<AdminRecord | null> {
    this.guard();
    const clean = username.trim().toLowerCase();
    for (const a of this.admins.values()) {
      if (a.username.toLowerCase() === clean) return { ...a };
    }
    return null;
  }

  async countAdmins(): Promise<number> {
    this.guard();
    return this.admins.size;
  }

  async createAdmin(username: string, passwordHash: string): Promise<AdminRecord> {
    this.guard();
    const rec: AdminRecord = {
      id: crypto.randomUUID(),
      username: username.trim(),
      password_hash: passwordHash,
      created_at: this.nowProvider().toISOString(),
    };
    this.admins.set(rec.id, rec);
    return { ...rec };
  }

  async listUsers(): Promise<UserRecord[]> {
    this.guard();
    return Array.from(this.users.values()).map((u) => ({ ...u }));
  }

  async getUserByUsername(username: string): Promise<UserRecord | null> {
    this.guard();
    const clean = username.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === clean) return { ...u };
    }
    return null;
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    this.guard();
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async createUser(input: {
    username: string;
    password_hash: string;
    duration_minutes: number;
  }): Promise<UserRecord> {
    this.guard();
    const existing = await this.getUserByUsername(input.username);
    if (existing) throw new Error('duplicate key value violates unique constraint');
    const rec: UserRecord = {
      id: crypto.randomUUID(),
      username: input.username.trim(),
      password_hash: input.password_hash,
      duration_minutes: input.duration_minutes,
      started_at: null,
      expires_at: null,
      is_disabled: false,
      created_at: this.nowProvider().toISOString(),
    };
    this.users.set(rec.id, rec);
    return { ...rec };
  }

  async setUserDisabled(id: string, isDisabled: boolean): Promise<UserRecord | null> {
    this.guard();
    const u = this.users.get(id);
    if (!u) return null;
    u.is_disabled = isDisabled;
    return { ...u };
  }

  async activateUserOnFirstLogin(userId: string): Promise<ActivatedUserResult | null> {
    this.guard();
    const u = this.users.get(userId);
    if (!u) return null;
    const now = this.nowProvider();
    if (!u.started_at || !u.expires_at) {
      u.started_at = now.toISOString();
      u.expires_at = new Date(now.getTime() + u.duration_minutes * 60 * 1000).toISOString();
    }
    const rem = Math.max(0, Math.floor((Date.parse(u.expires_at) - now.getTime()) / 1000));
    return {
      id: u.id,
      username: u.username,
      duration_minutes: u.duration_minutes,
      started_at: u.started_at,
      expires_at: u.expires_at,
      is_disabled: u.is_disabled,
      remaining_seconds: rem,
    };
  }

  async listFreeQuotas(): Promise<FreeQuotaRecord[]> {
    this.guard();
    return Array.from(this.freeQuotas.values()).map((q) => ({ ...q }));
  }

  async getFreeQuota(macAddress: string): Promise<FreeQuotaRecord | null> {
    this.guard();
    const q = this.freeQuotas.get(macAddress.toUpperCase());
    return q ? { ...q } : null;
  }

  async claimFreeQuota(macAddress: string, durationSeconds: number): Promise<ClaimFreeQuotaResult> {
    this.guard();
    const mac = macAddress.toUpperCase().trim();
    const now = this.nowProvider();
    const existing = this.freeQuotas.get(mac);
    if (!existing) {
      const started = now.toISOString();
      const expires = new Date(now.getTime() + durationSeconds * 1000).toISOString();
      this.freeQuotas.set(mac, {
        mac_address: mac,
        started_at: started,
        expires_at: expires,
        created_at: started,
      });
      return {
        allowed: true,
        is_new: true,
        mac_address: mac,
        started_at: started,
        expires_at: expires,
        remaining_seconds: durationSeconds,
      };
    }

    const rem = Math.max(0, Math.floor((Date.parse(existing.expires_at) - now.getTime()) / 1000));
    return {
      allowed: rem > 0,
      is_new: false,
      mac_address: mac,
      started_at: existing.started_at,
      expires_at: existing.expires_at,
      remaining_seconds: rem,
    };
  }

  async createSession(input: Omit<SessionRecord, 'id' | 'created_at'>): Promise<SessionRecord> {
    this.guard();
    if (this.failNextCreateSession) {
      this.failNextCreateSession = false;
      throw new Error('Simulated DB error during session insert');
    }
    const rec: SessionRecord = {
      ...input,
      id: crypto.randomUUID(),
      created_at: this.nowProvider().toISOString(),
    };
    this.sessions.set(rec.id, rec);
    return { ...rec };
  }

  async getActiveSessionByMac(macAddress: string): Promise<SessionRecord | null> {
    this.guard();
    const mac = macAddress.toUpperCase();
    const matches = Array.from(this.sessions.values())
      .filter((s) => s.mac_address === mac && s.status === 'active')
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return matches[0] ? { ...matches[0] } : null;
  }

  async listActiveSessions(): Promise<SessionRecord[]> {
    this.guard();
    return Array.from(this.sessions.values())
      .filter((s) => s.status === 'active')
      .map((s) => ({ ...s }));
  }

  async listActiveSessionsByUserId(userId: string): Promise<SessionRecord[]> {
    this.guard();
    return Array.from(this.sessions.values())
      .filter((s) => s.user_id === userId && s.status === 'active')
      .map((s) => ({ ...s }));
  }

  async updateSessionStatus(id: string, status: SessionStatus): Promise<void> {
    this.guard();
    const s = this.sessions.get(id);
    if (s) s.status = status;
  }
}
