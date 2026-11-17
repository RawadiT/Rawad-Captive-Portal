import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AuditService } from '../audit-logs/auditService.js';
import type { AdminRecord, AdminRole, PublicAdmin } from '../types/index.js';
import { hashPassword, verifyPassword } from './password.js';
import { signAdminToken } from './tokens.js';

export class ForbiddenError extends Error {
  readonly statusCode = 403;
}

export class UnauthorizedError extends Error {
  readonly statusCode = 401;
}

export class ConflictError extends Error {
  readonly statusCode = 409;
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
}

function toPublicAdmin(row: AdminRecord): PublicAdmin {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class AdminService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly audit: AuditService,
    private readonly tokenSecret: string
  ) {}

  ensureDefaultSuperAdmin(username: string, password: string): void {
    const existing = this.db
      .prepare("SELECT id FROM admins WHERE role = 'super_admin' LIMIT 1")
      .get() as { id: string } | undefined;

    if (existing) return;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO admins (id, username, password_hash, display_name, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'super_admin', 1, ?, ?)`
      )
      .run(crypto.randomUUID(), username, hashPassword(password), 'المدير الرئيسي', now, now);
  }

  login(username: string, password: string, ipAddress: string): { token: string; admin: PublicAdmin } {
    const row = this.db
      .prepare('SELECT * FROM admins WHERE username = ?')
      .get(username.trim()) as AdminRecord | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new UnauthorizedError('اسم المستخدم أو كلمة المرور غير صحيحة');
    }
    if (row.is_active !== 1) {
      throw new ForbiddenError('حساب المدير معطل');
    }

    const token = signAdminToken(
      { sub: row.id, username: row.username, role: row.role },
      this.tokenSecret
    );

    this.audit.record({
      adminId: row.id,
      adminUsername: row.username,
      action: 'ADMIN_LOGIN',
      targetType: 'admin',
      targetId: row.id,
      targetLabel: row.username,
      ipAddress,
      newValue: { role: row.role },
    });

    return { token, admin: toPublicAdmin(row) };
  }

  listAdmins(): PublicAdmin[] {
    const rows = this.db
      .prepare('SELECT * FROM admins ORDER BY role DESC, created_at ASC')
      .all() as unknown as AdminRecord[];
    return rows.map(toPublicAdmin);
  }

  createAdmin(
    actor: { id: string; username: string; role: AdminRole },
    input: { username: string; password: string; display_name: string; role: AdminRole },
    ipAddress: string
  ): PublicAdmin {
    if (actor.role !== 'super_admin') {
      if (input.role === 'super_admin') {
        throw new ForbiddenError('لا يملك المدير العادي صلاحية إنشاء حساب مدير رئيسي');
      }
      throw new ForbiddenError('إنشاء حسابات المدراء مقتصر على المدير الرئيسي');
    }

    const cleanUsername = input.username.trim();
    const exists = this.db.prepare('SELECT id FROM admins WHERE username = ?').get(cleanUsername);
    if (exists) {
      throw new ConflictError('اسم المستخدم موجود مسبقاً');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO admins (id, username, password_hash, display_name, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(id, cleanUsername, hashPassword(input.password), input.display_name.trim(), input.role, now, now);

    const created = this.db.prepare('SELECT * FROM admins WHERE id = ?').get(id) as unknown as AdminRecord;
    const pub = toPublicAdmin(created);

    this.audit.record({
      adminId: actor.id,
      adminUsername: actor.username,
      action: 'ADMIN_CREATE',
      targetType: 'admin',
      targetId: id,
      targetLabel: cleanUsername,
      ipAddress,
      newValue: pub,
    });

    return pub;
  }

  updateAdmin(
    actor: { id: string; username: string; role: AdminRole },
    targetId: string,
    input: { display_name?: string; password?: string; is_active?: boolean; role?: AdminRole },
    ipAddress: string
  ): PublicAdmin {
    const target = this.db.prepare('SELECT * FROM admins WHERE id = ?').get(targetId) as AdminRecord | undefined;
    if (!target) {
      throw new NotFoundError('حساب المدير غير موجود');
    }

    // Critical RBAC rule: regular admin can NEVER modify, disable, or touch super_admin
    if (target.role === 'super_admin' && actor.role !== 'super_admin') {
      throw new ForbiddenError('لا يمكن للمدير العادي تعديل أو تعطيل حساب المدير الرئيسي');
    }
    if (actor.role !== 'super_admin' && actor.id !== target.id) {
      throw new ForbiddenError('لا تملك صلاحية تعديل حسابات مدراء آخرين');
    }
    if (input.role === 'super_admin' && actor.role !== 'super_admin') {
      throw new ForbiddenError('لا تملك صلاحية الترقية إلى مدير رئيسي');
    }
    if (target.id === actor.id && input.is_active === false) {
      throw new ForbiddenError('لا يمكنك تعطيل حسابك الحالي');
    }

    const prevPub = toPublicAdmin(target);
    const nextDisplay = input.display_name !== undefined ? input.display_name.trim() : target.display_name;
    const nextActive = input.is_active !== undefined ? (input.is_active ? 1 : 0) : target.is_active;
    const nextRole = input.role !== undefined ? input.role : target.role;
    const nextHash = input.password ? hashPassword(input.password) : target.password_hash;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE admins SET display_name = ?, password_hash = ?, is_active = ?, role = ?, updated_at = ? WHERE id = ?`
      )
      .run(nextDisplay, nextHash, nextActive, nextRole, now, targetId);

    const updated = toPublicAdmin(
      this.db.prepare('SELECT * FROM admins WHERE id = ?').get(targetId) as unknown as AdminRecord
    );

    const action = input.is_active === false && target.is_active === 1 ? 'ADMIN_DISABLE' : 'ADMIN_UPDATE';
    this.audit.record({
      adminId: actor.id,
      adminUsername: actor.username,
      action,
      targetType: 'admin',
      targetId,
      targetLabel: target.username,
      ipAddress,
      previousValue: prevPub,
      newValue: updated,
    });

    return updated;
  }
}
