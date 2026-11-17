export type SessionType = 'free' | 'user';
export type SessionStatus = 'provisioning' | 'active' | 'expired' | 'disconnected';

export interface AdminRecord {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface PublicAdmin {
  id: string;
  username: string;
  created_at: string;
}

export interface UserRecord {
  id: string;
  username: string;
  password_hash: string;
  duration_minutes: number;
  started_at: string | null;
  expires_at: string | null;
  is_disabled: boolean;
  created_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
  duration_minutes: number;
  started_at: string | null;
  expires_at: string | null;
  remaining_seconds: number | null;
  is_disabled: boolean;
  is_expired: boolean;
  created_at: string;
}

export interface FreeQuotaRecord {
  mac_address: string;
  started_at: string;
  expires_at: string;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  session_type: SessionType;
  user_id: string | null;
  mac_address: string;
  ip_address: string;
  hotspot_username: string;
  hotspot_profile: string;
  started_at: string;
  expires_at: string;
  status: SessionStatus;
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
