import crypto from 'node:crypto';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../authentication/adminService.js';
import { hashPassword, verifyPassword } from '../authentication/password.js';
import type { DatabaseClient } from '../db/client.js';
import type { MikroTikAdapter } from '../mikrotik/adapter.js';
import type { FreeQuotaRecord, PublicUser, SessionRecord, UserRecord } from '../types/index.js';
import { normalizeMac } from './macUtils.js';

export interface QuotaServiceConfig {
  freeQuotaSeconds: number;
  nowProvider?: () => Date;
}

function toPublicUser(u: UserRecord, nowMs: number): PublicUser {
  let remainingSeconds: number | null = u.duration_minutes * 60;
  let isExpired = false;
  if (u.expires_at) {
    remainingSeconds = Math.max(0, Math.floor((Date.parse(u.expires_at) - nowMs) / 1000));
    isExpired = remainingSeconds === 0;
  }
  return {
    id: u.id,
    username: u.username,
    duration_minutes: u.duration_minutes,
    started_at: u.started_at,
    expires_at: u.expires_at,
    remaining_seconds: remainingSeconds,
    is_disabled: u.is_disabled,
    is_expired: isExpired,
    created_at: u.created_at,
  };
}

export class QuotaService {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly now: () => Date;

  constructor(
    private readonly db: DatabaseClient,
    private readonly mikrotik: MikroTikAdapter,
    private readonly cfg: QuotaServiceConfig
  ) {
    this.now = cfg.nowProvider ?? (() => new Date());
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

  private async revokeWithRetry(
    username: string,
    macAddress: string,
    profile: string,
    attempts = 3
  ): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      try {
        await this.mikrotik.revokeHotspotAccess({ username, macAddress, profile });
        return;
      } catch {
        if (i < attempts - 1) {
          await new Promise((r) => setTimeout(r, 150 * (i + 1)));
        }
      }
    }
  }

  async getGuestStatus(macAddress: string): Promise<{
    connected: boolean;
    session: SessionRecord | null;
    remainingSeconds: number | null;
    freeEligible: boolean;
    freeReason: string | null;
  }> {
    const mac = normalizeMac(macAddress);
    const nowMs = this.now().getTime();
    const active = await this.db.getActiveSessionByMac(mac);

    if (active) {
      const rem = Math.max(0, Math.floor((Date.parse(active.expires_at) - nowMs) / 1000));
      if (rem > 0) {
        return {
          connected: true,
          session: active,
          remainingSeconds: rem,
          freeEligible: false,
          freeReason: 'لديك جلسة نشطة حالياً',
        };
      }
    }

    const quota = await this.db.getFreeQuota(mac);
    if (!quota) {
      return {
        connected: false,
        session: null,
        remainingSeconds: null,
        freeEligible: true,
        freeReason: null,
      };
    }

    const rem = Math.max(0, Math.floor((Date.parse(quota.expires_at) - nowMs) / 1000));
    if (rem > 0) {
      return {
        connected: false,
        session: null,
        remainingSeconds: rem,
        freeEligible: true,
        freeReason: null,
      };
    }

    return {
      connected: false,
      session: null,
      remainingSeconds: 0,
      freeEligible: false,
      freeReason: 'تم استهلاك الحصة المجانية (30 دقيقة) لهذا الجهاز مسبقاً.',
    };
  }

  async grantFreeAccess(input: {
    macAddress: string;
    ipAddress: string;
  }): Promise<{ session: SessionRecord; remainingSeconds: number; resumed: boolean }> {
    const mac = normalizeMac(input.macAddress);

    return this.withLock(`mac:${mac}`, async () => {
      const existingActive = await this.db.getActiveSessionByMac(mac);
      if (existingActive) {
        const activeOnRouter = await this.mikrotik.listActiveSessions().catch(() => []);
        const stillOnRouter = activeOnRouter.some(
          (s) => s.macAddress.toUpperCase() === mac && s.user === existingActive.hotspot_username
        );
        if (stillOnRouter) {
          throw new ConflictError('لديك جلسة مجانية نشطة حالياً، لا يمكن منح حصة ثانية.');
        }
        await this.db.updateSessionStatus(existingActive.id, 'disconnected');
      }

      const claim = await this.db.claimFreeQuota(mac, this.cfg.freeQuotaSeconds);
      if (!claim.allowed || claim.remaining_seconds <= 0) {
        throw new ForbiddenError('تم استهلاك الحصة المجانية (30 دقيقة) لهذا الجهاز مسبقاً.');
      }

      const cleanMac = mac.replace(/:/g, '').toLowerCase();
      const hotspotUsername = `free-${cleanMac}`;
      const hotspotProfile = `rawad-sess-free-${cleanMac}`;
      const hotspotPassword = crypto.randomBytes(12).toString('hex');

      await this.mikrotik.grantHotspotAccess({
        username: hotspotUsername,
        password: hotspotPassword,
        macAddress: mac,
        ipAddress: input.ipAddress,
        sessionTimeoutSeconds: claim.remaining_seconds,
        profile: hotspotProfile,
      });

      try {
        const session = await this.db.createSession({
          session_type: 'free',
          user_id: null,
          mac_address: mac,
          ip_address: input.ipAddress,
          hotspot_username: hotspotUsername,
          hotspot_profile: hotspotProfile,
          started_at: claim.started_at,
          expires_at: claim.expires_at,
          status: 'active',
        });

        return {
          session,
          remainingSeconds: claim.remaining_seconds,
          resumed: !claim.is_new,
        };
      } catch (err) {
        await this.revokeWithRetry(hotspotUsername, mac, hotspotProfile);
        throw err;
      }
    });
  }

  async loginUser(input: {
    username: string;
    password: string;
    macAddress: string;
    ipAddress: string;
  }): Promise<{ session: SessionRecord; user: PublicUser; remainingSeconds: number }> {
    const cleanUsername = input.username.trim();
    const mac = normalizeMac(input.macAddress);

    return this.withLock(`user:${cleanUsername.toLowerCase()}`, async () => {
      const user = await this.db.getUserByUsername(cleanUsername);
      if (!user || !verifyPassword(input.password, user.password_hash)) {
        throw new UnauthorizedError('اسم المستخدم أو كلمة المرور غير صحيحة');
      }
      if (user.is_disabled) {
        throw new ForbiddenError('هذا الحساب معطل حالياً');
      }

      // Atomically set started_at & expires_at on FIRST successful login (Wall-Clock UTC)
      const activated = await this.db.activateUserOnFirstLogin(user.id);
      if (!activated || activated.remaining_seconds <= 0) {
        throw new ForbiddenError('انتهت صلاحية هذا الحساب');
      }

      // Close any existing active session for this MAC OR this user account (single active session per account)
      const activeByMac = await this.db.getActiveSessionByMac(mac);
      const activeByUser = await this.db.listActiveSessionsByUserId(user.id);
      const toClose = new Map<string, SessionRecord>();
      if (activeByMac) toClose.set(activeByMac.id, activeByMac);
      for (const s of activeByUser) toClose.set(s.id, s);

      for (const old of toClose.values()) {
        await this.mikrotik
          .revokeHotspotAccess({
            username: old.hotspot_username,
            macAddress: old.mac_address,
            profile: old.hotspot_profile,
          })
          .catch(() => {});
        await this.db.updateSessionStatus(old.id, 'disconnected');
      }

      const hotspotUsername = `usr-${user.username}`;
      const hotspotProfile = `rawad-sess-usr-${user.id.slice(0, 8)}`;
      const hotspotPassword = crypto.randomBytes(12).toString('hex');

      await this.mikrotik.grantHotspotAccess({
        username: hotspotUsername,
        password: hotspotPassword,
        macAddress: mac,
        ipAddress: input.ipAddress,
        sessionTimeoutSeconds: activated.remaining_seconds,
        profile: hotspotProfile,
      });

      try {
        const session = await this.db.createSession({
          session_type: 'user',
          user_id: user.id,
          mac_address: mac,
          ip_address: input.ipAddress,
          hotspot_username: hotspotUsername,
          hotspot_profile: hotspotProfile,
          started_at: activated.started_at,
          expires_at: activated.expires_at,
          status: 'active',
        });

        const updatedUser: UserRecord = {
          ...user,
          started_at: activated.started_at,
          expires_at: activated.expires_at,
        };

        return {
          session,
          user: toPublicUser(updatedUser, this.now().getTime()),
          remainingSeconds: activated.remaining_seconds,
        };
      } catch (err) {
        await this.revokeWithRetry(hotspotUsername, mac, hotspotProfile);
        throw err;
      }
    });
  }

  async listUsers(): Promise<PublicUser[]> {
    const rows = await this.db.listUsers();
    const nowMs = this.now().getTime();
    return rows.map((u) => toPublicUser(u, nowMs));
  }

  async createUser(input: {
    username: string;
    password: string;
    duration_minutes: number;
  }): Promise<PublicUser> {
    const cleanUsername = input.username.trim();
    if (!cleanUsername) throw new Error('اسم المستخدم مطلوب');
    if (!Number.isFinite(input.duration_minutes) || input.duration_minutes < 1) {
      throw new Error('مدة الحساب يجب أن تكون دقيقة واحدة على الأقل');
    }

    const existing = await this.db.getUserByUsername(cleanUsername);
    if (existing) throw new ConflictError('اسم المستخدم موجود مسبقاً');

    const created = await this.db.createUser({
      username: cleanUsername,
      password_hash: hashPassword(input.password),
      duration_minutes: Math.floor(input.duration_minutes),
    });

    return toPublicUser(created, this.now().getTime());
  }

  async setUserDisabled(userId: string, isDisabled: boolean): Promise<PublicUser> {
    const updated = await this.db.setUserDisabled(userId, isDisabled);
    if (!updated) throw new NotFoundError('الحساب غير موجود');

    if (isDisabled) {
      const actives = await this.db.listActiveSessionsByUserId(userId);
      for (const s of actives) {
        await this.mikrotik
          .revokeHotspotAccess({
            username: s.hotspot_username,
            macAddress: s.mac_address,
            profile: s.hotspot_profile,
          })
          .catch(() => {});
        await this.db.updateSessionStatus(s.id, 'disconnected');
      }
    }

    return toPublicUser(updated, this.now().getTime());
  }

  async listFreeQuotas(): Promise<Array<FreeQuotaRecord & { remaining_seconds: number; is_expired: boolean }>> {
    const rows = await this.db.listFreeQuotas();
    const nowMs = this.now().getTime();
    return rows.map((q) => {
      const rem = Math.max(0, Math.floor((Date.parse(q.expires_at) - nowMs) / 1000));
      return {
        ...q,
        remaining_seconds: rem,
        is_expired: rem === 0,
      };
    });
  }
}
