import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AdminRecord,
  FreeQuotaRecord,
  SessionRecord,
  SessionStatus,
  UserRecord,
} from '../types/index.js';
import type { ActivatedUserResult, ClaimFreeQuotaResult, DatabaseClient } from './client.js';

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

  async activateUserOnFirstLogin(userId: string): Promise<ActivatedUserResult | null> {
    const { data, error } = await this.client.rpc('activate_user_on_first_login', {
      p_user_id: userId,
    });
    if (error) throw new Error(error.message);
    const rows = data as ActivatedUserResult[] | null;
    return rows && rows.length > 0 ? rows[0] : null;
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

  async claimFreeQuota(macAddress: string, durationSeconds: number): Promise<ClaimFreeQuotaResult> {
    const { data, error } = await this.client.rpc('claim_free_quota', {
      p_mac: macAddress.toUpperCase(),
      p_duration_seconds: durationSeconds,
    });
    if (error) throw new Error(error.message);
    const rows = data as ClaimFreeQuotaResult[] | null;
    if (!rows || rows.length === 0) {
      throw new Error('claim_free_quota returned empty result');
    }
    return rows[0];
  }

  async createSession(input: Omit<SessionRecord, 'id' | 'created_at'>): Promise<SessionRecord> {
    const { data, error } = await this.client
      .from('sessions')
      .insert(input)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as SessionRecord;
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
