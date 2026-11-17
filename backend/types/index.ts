export type AdminRole = 'super_admin' | 'admin';
export type UserStatus = 'active' | 'disabled' | 'banned' | 'expired';
export type SessionType = 'free' | 'user';
export type SessionStatus = 'active' | 'expired' | 'terminated' | 'disconnected';

export interface AdminRecord {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: AdminRole;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface PublicAdmin {
  id: string;
  username: string;
  display_name: string;
  role: AdminRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRecord {
  id: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  quota_seconds: number | null;
  used_seconds: number;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
  display_name: string | null;
  quota_seconds: number | null;
  used_seconds: number;
  remaining_seconds: number | null;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export interface SessionRecord {
  id: string;
  session_type: SessionType;
  user_id: string | null;
  mac_address: string;
  ip_address: string;
  device_name: string | null;
  device_type: string | null;
  device_model: string | null;
  hotspot_username: string;
  status: SessionStatus;
  allowed_seconds: number | null;
  consumed_seconds: number;
  baghdad_date: string;
  started_at: string;
  last_synced_at: string;
  expires_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
}

export interface AuditLogRecord {
  id: string;
  admin_id: string | null;
  admin_username: string;
  action: string;
  target_type: string;
  target_id: string | null;
  target_label: string | null;
  ip_address: string;
  previous_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface MikroTikActiveSession {
  id: string;
  user: string;
  address: string;
  macAddress: string;
  uptimeSeconds: number;
  sessionTimeLeftSeconds: number | null;
}

export interface MikroTikStatus {
  connected: boolean;
  mode: 'mock' | 'routeros-rest';
  identity: string | null;
  lastCheckedAt: string;
  error: string | null;
}
