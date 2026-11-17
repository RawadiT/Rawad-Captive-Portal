import type { DatabaseClient } from '../db/client.js';
import type { PublicAdmin } from '../types/index.js';
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

export class AdminService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly tokenSecret: string
  ) {}

  async ensureDefaultAdmin(username: string, password: string): Promise<void> {
    const count = await this.db.countAdmins();
    if (count > 0) return;
    await this.db.createAdmin(username, hashPassword(password));
  }

  async login(username: string, password: string): Promise<{ token: string; admin: PublicAdmin }> {
    const row = await this.db.getAdminByUsername(username.trim());
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new UnauthorizedError('اسم المستخدم أو كلمة المرور غير صحيحة');
    }

    const token = signAdminToken({ sub: row.id, username: row.username }, this.tokenSecret);
    return {
      token,
      admin: {
        id: row.id,
        username: row.username,
        created_at: row.created_at,
      },
    };
  }
}
