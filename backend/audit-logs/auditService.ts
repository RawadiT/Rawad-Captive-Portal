import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AuditLogRecord } from '../types/index.js';

export type AuditAction =
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'USER_BAN'
  | 'SESSION_TERMINATE'
  | 'ADMIN_CREATE'
  | 'ADMIN_UPDATE'
  | 'ADMIN_DISABLE'
  | 'ADMIN_LOGIN';

export interface LogAuditInput {
  adminId: string | null;
  adminUsername: string;
  action: AuditAction;
  targetType: 'user' | 'session' | 'admin' | 'system';
  targetId?: string | null;
  targetLabel?: string | null;
  ipAddress: string;
  previousValue?: unknown;
  newValue?: unknown;
}

export class AuditService {
  constructor(private readonly db: DatabaseSync) {}

  record(input: LogAuditInput): AuditLogRecord {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const prevJson = input.previousValue !== undefined ? JSON.stringify(input.previousValue) : null;
    const nextJson = input.newValue !== undefined ? JSON.stringify(input.newValue) : null;

    this.db
      .prepare(
        `INSERT INTO audit_logs (
          id, admin_id, admin_username, action, target_type, target_id,
          target_label, ip_address, previous_value, new_value, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.adminId,
        input.adminUsername,
        input.action,
        input.targetType,
        input.targetId ?? null,
        input.targetLabel ?? null,
        input.ipAddress,
        prevJson,
        nextJson,
        createdAt
      );

    return {
      id,
      admin_id: input.adminId,
      admin_username: input.adminUsername,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId ?? null,
      target_label: input.targetLabel ?? null,
      ip_address: input.ipAddress,
      previous_value: prevJson,
      new_value: nextJson,
      created_at: createdAt,
    };
  }

  list(limit = 100, offset = 0): AuditLogRecord[] {
    return this.db
      .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as unknown as AuditLogRecord[];
  }
}
