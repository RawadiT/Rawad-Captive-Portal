import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AuditService } from '../audit-logs/auditService.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../authentication/adminService.js';
import { hashPassword, verifyPassword } from '../authentication/password.js';
import type { MikroTikAdapter } from '../mikrotik/adapter.js';
import type { AdminRole, PublicUser, SessionRecord, UserRecord, UserStatus } from '../types/index.js';
import { getBaghdadDateString, getNextBaghdadMidnightIso } from './baghdadTime.js';
import { detectDeviceFromUserAgent, normalizeMac } from './macUtils.js';

export interface QuotaServiceConfig {
  freeQuotaSeconds: number;
  profileFree: string;
  profileUser: string;
  nowProvider?: () => Date;
}

function toPublicUser(u: UserRecord): PublicUser {
  const remaining =
    u.quota_seconds === null ? null : Math.max(0, u.quota_seconds - u.used_seconds);
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    quota_seconds: u.quota_seconds,
    used_seconds: u.used_seconds,
    remaining_seconds: remaining,
    status: u.status,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

export class QuotaService {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly now: () => Date;

  constructor(
    private readonly db: DatabaseSync,
    private readonly mikrotik: MikroTikAdapter,
    private readonly audit: AuditService,
    private readonly cfg: QuotaServiceConfig
  ) {
    this.now = cfg.nowProvider ?? (() => new Date());
  }

  private async revokeWithRetry(username: string, macAddress: string, attempts = 3): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      try {
        await this.mikrotik.revokeHotspotAccess({ username, macAddress });
        return;
      } catch {
        if (i < attempts - 1) {
          await new Promise((r) => setTimeout(r, 150 * (i + 1)));
        }
      }
    }
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(key, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(key) === next) {
        this.locks.delete(key);
      }
    }
  }

  getActiveSessionByMac(macAddress: string): SessionRecord | null {
    const mac = normalizeMac(macAddress);
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE mac_address = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1")
      .get(mac) as SessionRecord | undefined;
    return row ?? null;
  }

  getFreeEligibility(macAddress: string): {
    eligible: boolean;
    reason: string | null;
    baghdadDate: string;
    nextResetAt: string;
    activeSession: SessionRecord | null;
  } {
    const mac = normalizeMac(macAddress);
    const current = this.now();
    const baghdadDate = getBaghdadDateString(current);
    const nextResetAt = getNextBaghdadMidnightIso(current);

    const activeSession = this.getActiveSessionByMac(mac);
    if (activeSession) {
      return {
        eligible: false,
        reason: 'لديك جلسة نشطة حالياً',
        baghdadDate,
        nextResetAt,
        activeSession,
      };
    }

    const usedToday = this.db
      .prepare('SELECT id FROM free_quotas WHERE mac_address = ? AND baghdad_date = ?')
      .get(mac, baghdadDate) as { id: string } | undefined;

    if (usedToday) {
      return {
        eligible: false,
        reason: 'تم استهلاك الحصة المجانية (30 دقيقة) لهذا اليوم. تتجدد عند الساعة 00:00 بتوقيت بغداد.',
        baghdadDate,
        nextResetAt,
        activeSession: null,
      };
    }

    return {
      eligible: true,
      reason: null,
      baghdadDate,
      nextResetAt,
      activeSession: null,
    };
  }

  async grantFreeAccess(input: {
    macAddress: string;
    ipAddress: string;
    userAgent?: string | null;
  }): Promise<{ session: SessionRecord; remainingSeconds: number; resumed: boolean }> {
    const mac = normalizeMac(input.macAddress);

    return this.withLock(`mac:${mac}`, async () => {
      const current = this.now();
      const nowIso = current.toISOString();
      const baghdadDate = getBaghdadDateString(current);

      // 1. Check if device already has an active session (e.g., reconnect / page refresh)
      const active = this.getActiveSessionByMac(mac);
      if (active) {
        const remaining =
          active.allowed_seconds === null
            ? this.cfg.freeQuotaSeconds
            : Math.max(0, active.allowed_seconds - active.consumed_seconds);
        if (remaining > 0) {
          return { session: active, remainingSeconds: remaining, resumed: true };
        }
      }

      // 2. Check if device had a paused/disconnected free session from today with remaining time
      const pausedToday = this.db
        .prepare(
          `SELECT * FROM sessions
           WHERE mac_address = ? AND session_type = 'free' AND baghdad_date = ? AND status = 'disconnected'
           ORDER BY started_at DESC LIMIT 1`
        )
        .get(mac, baghdadDate) as SessionRecord | undefined;

      if (pausedToday && pausedToday.allowed_seconds !== null) {
        const remaining = pausedToday.allowed_seconds - pausedToday.consumed_seconds;
        if (remaining > 0) {
          const hotspotPassword = crypto.randomBytes(12).toString('hex');
          await this.mikrotik.grantHotspotAccess({
            username: pausedToday.hotspot_username,
            password: hotspotPassword,
            macAddress: mac,
            ipAddress: input.ipAddress,
            limitUptimeSeconds: remaining,
            profile: this.cfg.profileFree,
          });

          const newExpiresAt = new Date(current.getTime() + remaining * 1000).toISOString();
          this.db
            .prepare(
              `UPDATE sessions SET status = 'active', ip_address = ?, last_synced_at = ?, expires_at = ?, ended_at = NULL, end_reason = NULL WHERE id = ?`
            )
            .run(input.ipAddress, nowIso, newExpiresAt, pausedToday.id);

          const updated = this.db
            .prepare('SELECT * FROM sessions WHERE id = ?')
            .get(pausedToday.id) as unknown as SessionRecord;
          return { session: updated, remainingSeconds: remaining, resumed: true };
        }
      }

      // 3. Verify daily eligibility in Asia/Baghdad
      const alreadyUsed = this.db
        .prepare('SELECT id FROM free_quotas WHERE mac_address = ? AND baghdad_date = ?')
        .get(mac, baghdadDate) as { id: string } | undefined;

      if (alreadyUsed) {
        throw new ForbiddenError(
          'تم استهلاك الحصة المجانية (30 دقيقة) لهذا اليوم. تتجدد عند الساعة 00:00 بتوقيت بغداد.'
        );
      }

      // 4. Provision on MikroTik FIRST; if this fails, quota is NOT marked used
      const sessionId = crypto.randomUUID();
      const hotspotUsername = `free-${mac.replace(/:/g, '').toLowerCase()}-${baghdadDate.replace(/-/g, '')}`;
      const hotspotPassword = crypto.randomBytes(12).toString('hex');
      const allowedSeconds = this.cfg.freeQuotaSeconds;
      const expiresAt = new Date(current.getTime() + allowedSeconds * 1000).toISOString();
      const device = detectDeviceFromUserAgent(input.userAgent);

      await this.mikrotik.grantHotspotAccess({
        username: hotspotUsername,
        password: hotspotPassword,
        macAddress: mac,
        ipAddress: input.ipAddress,
        limitUptimeSeconds: allowedSeconds,
        profile: this.cfg.profileFree,
      });

      // 5. Atomically persist session + free_quotas record
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        this.db
          .prepare(
            `INSERT INTO sessions (
              id, session_type, user_id, mac_address, ip_address,
              device_name, device_type, device_model, hotspot_username,
              status, allowed_seconds, consumed_seconds, baghdad_date,
              started_at, last_synced_at, expires_at
            ) VALUES (?, 'free', NULL, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?, ?)`
          )
          .run(
            sessionId,
            mac,
            input.ipAddress,
            device.deviceName,
            device.deviceType,
            device.deviceModel,
            hotspotUsername,
            allowedSeconds,
            baghdadDate,
            nowIso,
            nowIso,
            expiresAt
          );

        this.db
          .prepare(
            `INSERT INTO free_quotas (id, mac_address, baghdad_date, granted_at, session_id)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(crypto.randomUUID(), mac, baghdadDate, nowIso, sessionId);

        this.db.exec('COMMIT;');
      } catch (err) {
        this.db.exec('ROLLBACK;');
        await this.revokeWithRetry(hotspotUsername, mac);
        throw err;
      }

      const created = this.db
        .prepare('SELECT * FROM sessions WHERE id = ?')
        .get(sessionId) as unknown as SessionRecord;

      return { session: created, remainingSeconds: allowedSeconds, resumed: false };
    });
  }

  async loginUser(input: {
    username: string;
    password: string;
    macAddress: string;
    ipAddress: string;
    userAgent?: string | null;
  }): Promise<{ session: SessionRecord; user: PublicUser; remainingSeconds: number | null }> {
    const cleanUsername = input.username.trim();
    const mac = normalizeMac(input.macAddress);

    return this.withLock(`user:${cleanUsername.toLowerCase()}`, async () => {
      const user = this.db
        .prepare('SELECT * FROM users WHERE username = ?')
        .get(cleanUsername) as UserRecord | undefined;

      if (!user || !verifyPassword(input.password, user.password_hash)) {
        throw new UnauthorizedError('اسم المستخدم أو كلمة المرور غير صحيحة');
      }
      if (user.status === 'banned') {
        throw new ForbiddenError('تم حظر هذا الحساب من قبل الإدارة');
      }
      if (user.status === 'disabled') {
        throw new ForbiddenError('هذا الحساب معطل حالياً');
      }

      const remainingSeconds =
        user.quota_seconds === null ? null : Math.max(0, user.quota_seconds - user.used_seconds);

      if (remainingSeconds !== null && remainingSeconds <= 0) {
        if (user.status !== 'expired') {
          this.db
            .prepare("UPDATE users SET status = 'expired', updated_at = ? WHERE id = ?")
            .run(this.now().toISOString(), user.id);
        }
        throw new ForbiddenError('انتهت مدة استخدام هذا الحساب');
      }

      // Close any existing active session for this MAC or user before starting the new one
      const existingActive = this.db
        .prepare("SELECT * FROM sessions WHERE (mac_address = ? OR user_id = ?) AND status = 'active'")
        .all(mac, user.id) as unknown as SessionRecord[];

      const current = this.now();
      const nowIso = current.toISOString();

      for (const old of existingActive) {
        await this.mikrotik
          .revokeHotspotAccess({ username: old.hotspot_username, macAddress: old.mac_address })
          .catch(() => {});
        this.db
          .prepare(
            "UPDATE sessions SET status = 'disconnected', ended_at = ?, end_reason = 'superseded' WHERE id = ?"
          )
          .run(nowIso, old.id);
      }

      const hotspotUsername = `usr-${user.username}`;
      const hotspotPassword = crypto.randomBytes(12).toString('hex');

      await this.mikrotik.grantHotspotAccess({
        username: hotspotUsername,
        password: hotspotPassword,
        macAddress: mac,
        ipAddress: input.ipAddress,
        limitUptimeSeconds: remainingSeconds,
        profile: this.cfg.profileUser,
      });

      const sessionId = crypto.randomUUID();
      const baghdadDate = getBaghdadDateString(current);
      const expiresAt =
        remainingSeconds !== null ? new Date(current.getTime() + remainingSeconds * 1000).toISOString() : null;
      const device = detectDeviceFromUserAgent(input.userAgent);

      try {
        this.db
          .prepare(
            `INSERT INTO sessions (
              id, session_type, user_id, mac_address, ip_address,
              device_name, device_type, device_model, hotspot_username,
              status, allowed_seconds, consumed_seconds, baghdad_date,
              started_at, last_synced_at, expires_at
            ) VALUES (?, 'user', ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?, ?)`
          )
          .run(
            sessionId,
            user.id,
            mac,
            input.ipAddress,
            device.deviceName,
            device.deviceType,
            device.deviceModel,
            hotspotUsername,
            remainingSeconds,
            baghdadDate,
            nowIso,
            nowIso,
            expiresAt
          );
      } catch (err) {
        await this.revokeWithRetry(hotspotUsername, mac);
        throw err;
      }

      const session = this.db
        .prepare('SELECT * FROM sessions WHERE id = ?')
        .get(sessionId) as unknown as SessionRecord;

      return {
        session,
        user: toPublicUser(user),
        remainingSeconds,
      };
    });
  }

  listUsers(): PublicUser[] {
    const rows = this.db
      .prepare('SELECT * FROM users ORDER BY created_at DESC')
      .all() as unknown as UserRecord[];
    return rows.map(toPublicUser);
  }

  createUser(
    actor: { id: string; username: string; role: AdminRole },
    input: {
      username: string;
      password: string;
      display_name?: string | null;
      quota_minutes?: number | null;
    },
    ipAddress: string
  ): PublicUser {
    const cleanUsername = input.username.trim();
    if (!cleanUsername) throw new Error('اسم المستخدم مطلوب');

    const exists = this.db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
    if (exists) throw new ConflictError('اسم المستخدم موجود مسبقاً');

    const quotaSeconds =
      input.quota_minutes === null || input.quota_minutes === undefined
        ? null
        : Math.max(60, Math.floor(input.quota_minutes * 60));

    const id = crypto.randomUUID();
    const nowIso = this.now().toISOString();

    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, display_name, quota_seconds, used_seconds, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?)`
      )
      .run(
        id,
        cleanUsername,
        hashPassword(input.password),
        input.display_name?.trim() || null,
        quotaSeconds,
        nowIso,
        nowIso
      );

    const created = toPublicUser(
      this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRecord
    );

    this.audit.record({
      adminId: actor.id,
      adminUsername: actor.username,
      action: 'USER_CREATE',
      targetType: 'user',
      targetId: id,
      targetLabel: cleanUsername,
      ipAddress,
      newValue: created,
    });

    return created;
  }

  async updateUser(
    actor: { id: string; username: string; role: AdminRole },
    userId: string,
    input: {
      display_name?: string | null;
      password?: string;
      quota_minutes?: number | null;
      status?: UserStatus;
    },
    ipAddress: string
  ): Promise<PublicUser> {
    const existing = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRecord | undefined;
    if (!existing) throw new NotFoundError('المستخدم غير موجود');

    const prevPub = toPublicUser(existing);
    const nextDisplay =
      input.display_name !== undefined ? input.display_name?.trim() || null : existing.display_name;
    const nextHash = input.password ? hashPassword(input.password) : existing.password_hash;
    const nextQuotaSeconds =
      input.quota_minutes === undefined
        ? existing.quota_seconds
        : input.quota_minutes === null
          ? null
          : Math.max(60, Math.floor(input.quota_minutes * 60));

    let nextStatus: UserStatus = input.status ?? existing.status;
    if (
      nextQuotaSeconds !== null &&
      existing.used_seconds < nextQuotaSeconds &&
      existing.status === 'expired' &&
      input.status === undefined
    ) {
      nextStatus = 'active';
    }

    const nowIso = this.now().toISOString();
    this.db
      .prepare(
        `UPDATE users SET display_name = ?, password_hash = ?, quota_seconds = ?, status = ?, updated_at = ? WHERE id = ?`
      )
      .run(nextDisplay, nextHash, nextQuotaSeconds, nextStatus, nowIso, userId);

    // If user was disabled or banned, immediately revoke active sessions on MikroTik
    if (nextStatus === 'disabled' || nextStatus === 'banned') {
      const actives = this.db
        .prepare("SELECT * FROM sessions WHERE user_id = ? AND status = 'active'")
        .all(userId) as unknown as SessionRecord[];
      for (const s of actives) {
        await this.mikrotik
          .revokeHotspotAccess({ username: s.hotspot_username, macAddress: s.mac_address })
          .catch(() => {});
        this.db
          .prepare("UPDATE sessions SET status = 'terminated', ended_at = ?, end_reason = ? WHERE id = ?")
          .run(nowIso, `user_${nextStatus}`, s.id);
      }
    }

    const updated = toPublicUser(
      this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRecord
    );

    const action = nextStatus === 'banned' && existing.status !== 'banned' ? 'USER_BAN' : 'USER_UPDATE';
    this.audit.record({
      adminId: actor.id,
      adminUsername: actor.username,
      action,
      targetType: 'user',
      targetId: userId,
      targetLabel: existing.username,
      ipAddress,
      previousValue: prevPub,
      newValue: updated,
    });

    return updated;
  }

  async deleteUser(
    actor: { id: string; username: string; role: AdminRole },
    userId: string,
    ipAddress: string
  ): Promise<void> {
    const existing = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRecord | undefined;
    if (!existing) throw new NotFoundError('المستخدم غير موجود');

    const prevPub = toPublicUser(existing);
    const nowIso = this.now().toISOString();

    const actives = this.db
      .prepare("SELECT * FROM sessions WHERE user_id = ? AND status = 'active'")
      .all(userId) as unknown as SessionRecord[];

    for (const s of actives) {
      await this.mikrotik
        .revokeHotspotAccess({ username: s.hotspot_username, macAddress: s.mac_address })
        .catch(() => {});
      this.db
        .prepare("UPDATE sessions SET status = 'terminated', ended_at = ?, end_reason = 'user_deleted' WHERE id = ?")
        .run(nowIso, s.id);
    }

    // Preserve historical session & audit_logs integrity (sessions.user_id ON DELETE SET NULL)
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    this.audit.record({
      adminId: actor.id,
      adminUsername: actor.username,
      action: 'USER_DELETE',
      targetType: 'user',
      targetId: userId,
      targetLabel: existing.username,
      ipAddress,
      previousValue: prevPub,
    });
  }
}
