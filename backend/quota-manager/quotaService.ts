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
  private readonly now: () => Date;

  constructor(
    private readonly db: DatabaseClient,
    private readonly mikrotik: MikroTikAdapter,
    private readonly cfg: QuotaServiceConfig
  ) {
    this.now = cfg.nowProvider ?? (() => new Date());
  }

  private async withLeaseRenewal<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const timer = setInterval(() => {
      void this.db.renewProvisioningLease(sessionId, 60).catch((err) => {
        console.error('[LeaseRenewal] failed:', err instanceof Error ? err.message : err);
      });
    }, 45_000);
    timer.unref();
    try {
      return await fn();
    } finally {
      clearInterval(timer);
    }
  }

  private async revokeStrictWithRetry(
    username: string,
    macAddress: string,
    profile: string,
    attempts = 3
  ): Promise<void> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.mikrotik.revokeHotspotAccess({ username, macAddress, profile });
        return;
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) {
          await new Promise((r) => setTimeout(r, 150 * (i + 1)));
        }
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    console.error(`[CRITICAL] Failed to revoke MikroTik session '${username}' (${macAddress}): ${msg}`);
    throw new Error(`فشل إلغاء الجلسة على MikroTik: ${msg}`);
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

  /**
   * 3-Step PostgreSQL-Locked Provisioning & Failure-Recovery (Free Quota):
   *   1. DB `beginFreeProvisioning`: acquires pg_advisory_xact_lock & inserts 'provisioning' row
   *      (protected by unique partial index) WITHOUT consuming `free_quotas` yet.
   *   2. MikroTik `grantHotspotAccess(..., bindMac: true)`: provisions profile/user/active.
   *      If MikroTik fails, `abortProvisioning` releases the lock and `free_quotas` is UNTOUCHED.
   *   3. DB `finalizeFreeSession`: atomically writes `free_quotas` & flips session to 'active'.
   *      If DB fails, executes strict compensating revoke on MikroTik + aborts provisioning.
   */
  async grantFreeAccess(input: {
    macAddress: string;
    ipAddress: string;
  }): Promise<{ session: SessionRecord; remainingSeconds: number; resumed: boolean }> {
    const mac = normalizeMac(input.macAddress);
    const cleanMac = mac.replace(/:/g, '').toLowerCase();
    const hotspotUsername = `free-${cleanMac}`;
    const hotspotProfile = `rawad-sess-free-${cleanMac}`;
    const hotspotPassword = crypto.randomBytes(12).toString('hex');

    const begin = await this.db.beginFreeProvisioning({
      macAddress: mac,
      ipAddress: input.ipAddress,
      hotspotUsername,
      hotspotProfile,
      durationSeconds: this.cfg.freeQuotaSeconds,
    });

    if (begin.conflict_active) {
      throw new ConflictError('لديك جلسة مجانية نشطة حالياً، لا يمكن منح حصة ثانية.');
    }
    if (!begin.allowed || !begin.session_id || begin.remaining_seconds <= 0) {
      throw new ForbiddenError('تم استهلاك الحصة المجانية (30 دقيقة) لهذا الجهاز مسبقاً.');
    }

    try {
      await this.withLeaseRenewal(begin.session_id, () =>
        this.mikrotik.grantHotspotAccess({
          username: hotspotUsername,
          password: hotspotPassword,
          macAddress: mac,
          ipAddress: input.ipAddress,
          bindMac: true,
          sessionTimeoutSeconds: begin.remaining_seconds,
          profile: hotspotProfile,
        })
      );
    } catch (err) {
      await this.db.abortProvisioning(begin.session_id).catch((e) =>
        console.error('[Recovery] abortProvisioning failed:', e)
      );
      throw err;
    }

    try {
      const finalized = await this.db.finalizeFreeSession(begin.session_id, this.cfg.freeQuotaSeconds);
      if (!finalized.allowed || finalized.remaining_seconds <= 0) {
        try {
          await this.revokeStrictWithRetry(hotspotUsername, mac, hotspotProfile);
          await this.db.abortProvisioning(begin.session_id);
        } catch (revErr) {
          await this.db.markRevocationPending(begin.session_id).catch((e) =>
            console.error('[CRITICAL] markRevocationPending failed:', e)
          );
          throw revErr;
        }
        throw new ForbiddenError('تم استهلاك الحصة المجانية (30 دقيقة) لهذا الجهاز مسبقاً.');
      }

      const session: SessionRecord = {
        id: finalized.session_id,
        session_type: 'free',
        user_id: null,
        mac_address: finalized.mac_address,
        ip_address: input.ipAddress,
        hotspot_username: hotspotUsername,
        hotspot_profile: hotspotProfile,
        started_at: finalized.started_at,
        expires_at: finalized.expires_at,
        status: 'active',
        created_at: finalized.started_at,
      };

      return {
        session,
        remainingSeconds: finalized.remaining_seconds,
        resumed: !finalized.is_new,
      };
    } catch (err) {
      if (!(err instanceof ForbiddenError)) {
        try {
          await this.revokeStrictWithRetry(hotspotUsername, mac, hotspotProfile);
          await this.db.abortProvisioning(begin.session_id);
        } catch (revErr) {
          console.error('[CRITICAL] Compensating MikroTik revoke failed; marking revocation_pending:', revErr);
          await this.db.markRevocationPending(begin.session_id).catch((e) =>
            console.error('[CRITICAL] markRevocationPending failed:', e)
          );
        }
      }
      throw err;
    }
  }

  /**
   * 3-Step PostgreSQL-Locked Provisioning & Failure-Recovery (Ordinary Account):
   *   - Ordinary accounts NEVER store a MAC restriction (`bindMac: false`).
   *   - Prior active sessions are only marked 'disconnected' AFTER RouterOS revocation succeeds.
   *   - `started_at` / `expires_at` are ONLY written in `finalizeUserSession` AFTER MikroTik succeeds.
   */
  async loginUser(input: {
    username: string;
    password: string;
    macAddress: string;
    ipAddress: string;
  }): Promise<{ session: SessionRecord; user: PublicUser; remainingSeconds: number }> {
    const cleanUsername = input.username.trim();
    const mac = normalizeMac(input.macAddress);

    const user = await this.db.getUserByUsername(cleanUsername);
    if (!user || !verifyPassword(input.password, user.password_hash)) {
      throw new UnauthorizedError('اسم المستخدم أو كلمة المرور غير صحيحة');
    }
    if (user.is_disabled) {
      throw new ForbiddenError('هذا الحساب معطل حالياً');
    }

    // Revoke any existing active sessions for this user or connecting MAC; abort if RouterOS revoke fails
    const activeByMac = await this.db.getActiveSessionByMac(mac);
    const activeByUser = await this.db.listActiveSessionsByUserId(user.id);
    const toClose = new Map<string, SessionRecord>();
    if (activeByMac) toClose.set(activeByMac.id, activeByMac);
    for (const s of activeByUser) toClose.set(s.id, s);

    for (const old of toClose.values()) {
      await this.revokeStrictWithRetry(old.hotspot_username, old.mac_address, old.hotspot_profile);
      await this.db.updateSessionStatus(old.id, 'disconnected');
    }

    const hotspotUsername = `usr-${user.username}`;
    const hotspotProfile = `rawad-sess-usr-${user.id.slice(0, 8)}`;
    const hotspotPassword = crypto.randomBytes(12).toString('hex');

    const begin = await this.db.beginUserProvisioning({
      userId: user.id,
      macAddress: mac,
      ipAddress: input.ipAddress,
      hotspotUsername,
      hotspotProfile,
    });

    if (!begin.allowed || !begin.session_id || begin.remaining_seconds <= 0) {
      throw new ForbiddenError('انتهت صلاحية هذا الحساب أو تم تعطيله');
    }

    try {
      await this.withLeaseRenewal(begin.session_id, () =>
        this.mikrotik.grantHotspotAccess({
          username: hotspotUsername,
          password: hotspotPassword,
          macAddress: mac,
          ipAddress: input.ipAddress,
          bindMac: false, // Ordinary accounts must NOT store a MAC restriction
          sessionTimeoutSeconds: begin.remaining_seconds,
          profile: hotspotProfile,
        })
      );
    } catch (err) {
      await this.db.abortProvisioning(begin.session_id).catch((e) =>
        console.error('[Recovery] abortProvisioning failed:', e)
      );
      throw err;
    }

    try {
      const finalized = await this.db.finalizeUserSession(begin.session_id);
      if (!finalized.allowed || !finalized.started_at || !finalized.expires_at || finalized.remaining_seconds <= 0) {
        try {
          await this.revokeStrictWithRetry(hotspotUsername, mac, hotspotProfile);
          await this.db.abortProvisioning(begin.session_id);
        } catch (revErr) {
          await this.db.markRevocationPending(begin.session_id).catch((e) =>
            console.error('[CRITICAL] markRevocationPending failed:', e)
          );
          throw revErr;
        }
        throw new ForbiddenError('انتهت صلاحية هذا الحساب أو تم تعطيله');
      }

      const session: SessionRecord = {
        id: finalized.session_id,
        session_type: 'user',
        user_id: user.id,
        mac_address: mac,
        ip_address: input.ipAddress,
        hotspot_username: hotspotUsername,
        hotspot_profile: hotspotProfile,
        started_at: finalized.started_at,
        expires_at: finalized.expires_at,
        status: 'active',
        created_at: finalized.started_at,
      };

      const updatedUser: UserRecord = {
        ...user,
        started_at: finalized.started_at,
        expires_at: finalized.expires_at,
      };

      return {
        session,
        user: toPublicUser(updatedUser, this.now().getTime()),
        remainingSeconds: finalized.remaining_seconds,
      };
    } catch (err) {
      if (!(err instanceof ForbiddenError)) {
        try {
          await this.revokeStrictWithRetry(hotspotUsername, mac, hotspotProfile);
          await this.db.abortProvisioning(begin.session_id);
        } catch (revErr) {
          console.error('[CRITICAL] Compensating MikroTik revoke failed; marking revocation_pending:', revErr);
          await this.db.markRevocationPending(begin.session_id).catch((e) =>
            console.error('[CRITICAL] markRevocationPending failed:', e)
          );
        }
      }
      throw err;
    }
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
        await this.revokeStrictWithRetry(s.hotspot_username, s.mac_address, s.hotspot_profile);
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
