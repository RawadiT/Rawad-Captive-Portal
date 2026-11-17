-- Rawad Tech Captive Portal - Initial SQLite Schema
-- Version: 001_initial

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  quota_seconds INTEGER NULL CHECK (quota_seconds IS NULL OR quota_seconds > 0),
  used_seconds INTEGER NOT NULL DEFAULT 0 CHECK (used_seconds >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'banned', 'expired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  session_type TEXT NOT NULL CHECK (session_type IN ('free', 'user')),
  user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  mac_address TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  device_name TEXT NULL,
  device_type TEXT NULL,
  device_model TEXT NULL,
  hotspot_username TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'terminated', 'disconnected')),
  allowed_seconds INTEGER NULL CHECK (allowed_seconds IS NULL OR allowed_seconds >= 0),
  consumed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (consumed_seconds >= 0),
  baghdad_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  expires_at TEXT NULL,
  ended_at TEXT NULL,
  end_reason TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_mac_status ON sessions(mac_address, status);
CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON sessions(user_id, status);

CREATE TABLE IF NOT EXISTS free_quotas (
  id TEXT PRIMARY KEY,
  mac_address TEXT NOT NULL,
  baghdad_date TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE(mac_address, baghdad_date)
);

CREATE INDEX IF NOT EXISTS idx_free_quotas_mac_date ON free_quotas(mac_address, baghdad_date);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT NULL,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NULL,
  target_label TEXT NULL,
  ip_address TEXT NOT NULL,
  previous_value TEXT NULL,
  new_value TEXT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Enforce immutability of audit_logs at the database engine level
CREATE TRIGGER IF NOT EXISTS prevent_audit_logs_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is immutable: UPDATE is forbidden');
END;

CREATE TRIGGER IF NOT EXISTS prevent_audit_logs_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is immutable: DELETE is forbidden');
END;
