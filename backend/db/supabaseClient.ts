import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AdminRecord,
  FreeQuotaRecord,
  SessionRecord,
  SessionStatus,
  UserRecord,
} from '../types/index.js';
import type {
  BeginFreeProvisioningResult,
  BeginUserProvisioningResult,
  DatabaseClient,
  FinalizeFreeSessionResult,
  FinalizeUserSessionResult,
  MonitorLockResult,
} from './client.js';

export class SupabaseDatabaseClient implements DatabaseClient {
  private readonly client: SupabaseClient;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.client = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  async ping(): Promise<boolean> {
    const { error } = await this.client.from('admins').select('id', { count: 'exact', head: true });
    if (error) throw new Error(`Supabase connection error: ${error.message}`);
    return true;
  }

  async getAdminByUsername(username: string): Promise<AdminRecord | null> {
    const { data, error } = await this.client
      .from('admins')
      .select('*')
      .eq('username', username.trim())
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as AdminRecord | null) ?? null;
  }

  async countAdmins(): Promise<number> {
    const { count, error } = await this.client.from('admins').select('*', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async createAdmin(username: string, passwordHash: string): Promise<AdminRecord> {
    const { data, error } = await this.client
      .from('admins')
      .insert({ username: username.trim(), password_hash: passwordHash })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as AdminRecord;
  }

  async listUsers(): Promise<UserRecord[]> {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as UserRecord[]) ?? [];
  }

  async getUserByUsername(username: string): Promise<UserRecord | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('username', username.trim())
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as UserRecord | null) ?? null;
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    const { data, error } = await this.client.from('users').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as UserRecord | null) ?? null;
  }

  async createUser(input: {
    username: string;
    password_hash: string;
    duration_minutes: number;
  }): Promise<UserRecord> {
    const { data, error } = await this.client
      .from('users')
      .insert({
        username: input.username.trim(),
        password_hash: input.password_hash,
        duration_minutes: input.duration_minutes,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as UserRecord;
  }

  async setUserDisabled(id: string, isDisabled: boolean): Promise<UserRecord | null> {
    const { data, error } = await this.client
      .from('users')
      .update({ is_disabled: isDisabled })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as UserRecord | null) ?? null;
  }

  async listFreeQuotas(): Promise<FreeQuotaRecord[]> {
    const { data, error } = await this.client
      .from('free_quotas')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as FreeQuotaRecord[]) ?? [];
  }

  async getFreeQuota(macAddress: string): Promise<FreeQuotaRecord | null> {
    const { data, error } = await this.client
      .from('free_quotas')
      .select('*')
      .eq('mac_address', macAddress.toUpperCase())
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as FreeQuotaRecord | null) ?? null;
  }

  async beginFreeProvisioning(input: {
    macAddress: string;
    ipAddress: string;
    hotspotUsername: string;
    hotspotProfile: string;
    durationSeconds: number;
  }): Promise<BeginFreeProvisioningResult> {
    const { data, error } = await this.client.rpc('begin_free_provisioning', {
      p_mac: input.macAddress.toUpperCase(),
      p_ip: input.ipAddress,
      p_hs_user: input.hotspotUsername,
      p_hs_profile: input.hotspotProfile,
      p_duration_seconds: input.durationSeconds,
    });
    if (error) throw new Error(error.message);
    const rows = data as BeginFreeProvisioningResult[] | null;
    if (!rows || rows.length === 0) throw new Error('begin_free_provisioning returned empty');
    return rows[0];
  }

  async finalizeFreeSession(sessionId: string, durationSeconds: number): Promise<FinalizeFreeSessionResult> {
    const { data, error } = await this.client.rpc('finalize_free_session', {
      p_session_id: sessionId,
      p_duration_seconds: durationSeconds,
    });
    if (error) throw new Error(error.message);
    const rows = data as FinalizeFreeSessionResult[] | null;
    if (!rows || rows.length === 0) throw new Error('finalize_free_session returned empty');
    return rows[0];
  }

  async beginUserProvisioning(input: {
    userId: string;
    macAddress: string;
    ipAddress: string;
    hotspotUsername: string;
    hotspotProfile: string;
  }): Promise<BeginUserProvisioningResult> {
    const { data, error } = await this.client.rpc('begin_user_provisioning', {
      p_user_id: input.userId,
      p_mac: input.macAddress.toUpperCase(),
      p_ip: input.ipAddress,
      p_hs_user: input.hotspotUsername,
      p_hs_profile: input.hotspotProfile,
    });
    if (error) throw new Error(error.message);
    const rows = data as BeginUserProvisioningResult[] | null;
    if (!rows || rows.length === 0) throw new Error('begin_user_provisioning returned empty');
    return rows[0];
  }

  async finalizeUserSession(sessionId: string): Promise<FinalizeUserSessionResult> {
    const { data, error } = await this.client.rpc('finalize_user_session', {
      p_session_id: sessionId,
    });
    if (error) throw new Error(error.message);
    const rows = data as FinalizeUserSessionResult[] | null;
    if (!rows || rows.length === 0) throw new Error('finalize_user_session returned empty');
    return rows[0];
  }

  async abortProvisioning(sessionId: string): Promise<void> {
    const { error } = await this.client.rpc('abort_provisioning', {
      p_session_id: sessionId,
    });
    if (error) throw new Error(error.message);
  }

  async markRevocationPending(sessionId: string): Promise<void> {
    const { error } = await this.client.rpc('mark_revocation_pending', {
      p_session_id: sessionId,
    });
    if (error) throw new Error(error.message);
  }

  async reclaimExpiredProvisioningLeases(): Promise<number> {
    const { data, error } = await this.client.rpc('reclaim_expired_provisioning_leases');
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  }

  async renewProvisioningLease(sessionId: string, extendSeconds = 60): Promise<boolean> {
    const { data, error } = await this.client.rpc('renew_provisioning_lease', {
      p_session_id: sessionId,
      p_extend_seconds: extendSeconds,
    });
    if (error) throw new Error(error.message);
    return Boolean(data);
  }

  async tryAcquireMonitorLock(lockName: string, ownerId: string, leaseSeconds = 30): Promise<MonitorLockResult> {
    const { data, error } = await this.client.rpc('try_acquire_monitor_lock', {
      p_lock_name: lockName,
      p_owner_id: ownerId,
      p_lease_seconds: leaseSeconds,
    });
    if (error) throw new Error(error.message);
    const rows = data as MonitorLockResult[] | null;
    if (!rows || rows.length === 0) return { acquired: false, fence_token: 0 };
    return { acquired: Boolean(rows[0].acquired), fence_token: Number(rows[0].fence_token ?? 0) };
  }

  async fencedUpdateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    lockName: string,
    ownerId: string,
    fenceToken: number
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc('fenced_update_session_status', {
      p_session_id: sessionId,
      p_status: status,
      p_lock_name: lockName,
      p_owner_id: ownerId,
      p_fence_token: fenceToken,
    });
    if (error) throw new Error(error.message);
    return Boolean(data);
  }

  async releaseMonitorLock(lockName: string, ownerId: string): Promise<void> {
    const { error } = await this.client.rpc('release_monitor_lock', {
      p_lock_name: lockName,
      p_owner_id: ownerId,
    });
    if (error) throw new Error(error.message);
  }

  async getActiveSessionByMac(macAddress: string): Promise<SessionRecord | null> {
    const { data, error } = await this.client
      .from('sessions')
      .select('*')
      .eq('mac_address', macAddress.toUpperCase())
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as SessionRecord | null) ?? null;
  }

  async listActiveSessions(): Promise<SessionRecord[]> {
    const { data, error } = await this.client
      .from('sessions')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as SessionRecord[]) ?? [];
  }

  async listRevocationPendingSessions(): Promise<SessionRecord[]> {
    const { data, error } = await this.client
      .from('sessions')
      .select('*')
      .eq('status', 'revocation_pending')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data as SessionRecord[]) ?? [];
  }

  async listActiveSessionsByUserId(userId: string): Promise<SessionRecord[]> {
    const { data, error } = await this.client
      .from('sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) throw new Error(error.message);
    return (data as SessionRecord[]) ?? [];
  }

  async updateSessionStatus(id: string, status: SessionStatus): Promise<void> {
    const { error } = await this.client.from('sessions').update({ status }).eq('id', id);
    if (error) throw new Error(error.message);
  }
}
