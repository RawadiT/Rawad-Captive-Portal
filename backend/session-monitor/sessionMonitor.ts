import type { DatabaseSync } from 'node:sqlite';
import type { AuditService } from '../audit-logs/auditService.js';
import { NotFoundError } from '../authentication/adminService.js';
import type { MikroTikAdapter } from '../mikrotik/adapter.js';
import { normalizeMac } from '../quota-manager/macUtils.js';
import type { AdminRole, MikroTikActiveSession, MikroTikStatus, SessionRecord, UserRecord } from '../types/index.js';

export interface ActiveSessionView {
  id: string;
  session_type: 'free' | 'user';
  username: string;
  device_name: string | null;
  device_type: string | null;
  device_model: string | null;
  mac_address: string;
  ip_address: string;
  status: string;
  allowed_seconds: number | null;
  consumed_seconds: number;
  remaining_seconds: number | null;
  started_at: string;
  expires_at: string | null;
}

export interface DashboardStats {
  activeUsersCount: number;
  totalUsersCount: number;
  activeSessionsCount: number;
  adminsCount: number;
  mikrotik: MikroTikStatus;
}

export class SessionMonitor {
  private timer: NodeJS.Timeout | null = null;
  private listeners = new Set<() => void>();
  private readonly now: () => Date;

  constructor(
    private readonly db: DatabaseSync,
    private readonly mikrotik: MikroTikAdapter,
    private readonly audit: AuditService,
    nowProvider?: () => Date
  ) {
    this.now = nowProvider ?? (() => new Date());
  }

  onUpdate(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Ignore individual listener errors
      }
    }
  }

  start(intervalMs = 3000): void {
    if (this.timer) return;
    void this.syncSessions().catch(() => {});
    this.timer = setInterval(() => {
      void this.syncSessions().catch(() => {});
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncSessions(): Promise<{
    expiredCount: number;
    disconnectedCount: number;
    updatedCount: number;
    orphansRevoked: number;
  }> {
    let mikrotikActive: MikroTikActiveSession[] = [];
    let mikrotikReachable = false;
    try {
      mikrotikActive = await this.mikrotik.listActiveSessions();
      mikrotikReachable = true;
    } catch {
      mikrotikReachable = false;
    }

    const actives = this.db
      .prepare("SELECT * FROM sessions WHERE status = 'active'")
      .all() as unknown as SessionRecord[];

    const activeByKey = new Map<string, MikroTikActiveSession>();
    for (const m of mikrotikActive) {
      activeByKey.set(`${m.user}|${m.macAddress.toUpperCase()}`, m);
    }

    const current = this.now();
    const nowMs = current.getTime();
    const nowIso = current.toISOString();

    let expiredCount = 0;
    let disconnectedCount = 0;
    let updatedCount = 0;
    let orphansRevoked = 0;

    const validActiveKeys = new Set<string>();

    for (const session of actives) {
      const lastMs = Date.parse(session.last_synced_at);
      const delta = Math.max(0, Math.floor((nowMs - lastMs) / 1000));
      const rawConsumed = session.consumed_seconds + delta;
      const cappedConsumed =
        session.allowed_seconds !== null ? Math.min(session.allowed_seconds, rawConsumed) : rawConsumed;
      const appliedDelta = Math.max(0, cappedConsumed - session.consumed_seconds);

      const isExpired =
        session.allowed_seconds !== null && cappedConsumed >= session.allowed_seconds;

      const key = `${session.hotspot_username}|${session.mac_address.toUpperCase()}`;
      const missingOnRouter = mikrotikReachable && !activeByKey.has(key);

      if (delta === 0 && !isExpired && !missingOnRouter) {
        validActiveKeys.add(key);
        continue;
      }

      this.db.exec('BEGIN IMMEDIATE;');
      try {
        if (isExpired) {
          this.db
            .prepare(
              `UPDATE sessions
               SET consumed_seconds = ?, last_synced_at = ?, status = 'expired', ended_at = ?, end_reason = 'quota_exhausted'
               WHERE id = ? AND status = 'active'`
            )
            .run(cappedConsumed, nowIso, nowIso, session.id);
        } else if (missingOnRouter) {
          this.db
            .prepare(
              `UPDATE sessions
               SET consumed_seconds = ?, last_synced_at = ?, status = 'disconnected', ended_at = ?, end_reason = 'router_session_missing'
               WHERE id = ? AND status = 'active'`
            )
            .run(cappedConsumed, nowIso, nowIso, session.id);
        } else {
          this.db
            .prepare(
              `UPDATE sessions SET consumed_seconds = ?, last_synced_at = ? WHERE id = ? AND status = 'active'`
            )
            .run(cappedConsumed, nowIso, session.id);
          validActiveKeys.add(key);
        }

        if (session.session_type === 'user' && session.user_id && appliedDelta > 0) {
          this.db
            .prepare('UPDATE users SET used_seconds = used_seconds + ?, updated_at = ? WHERE id = ?')
            .run(appliedDelta, nowIso, session.user_id);

          if (isExpired) {
            const u = this.db
              .prepare('SELECT quota_seconds, used_seconds FROM users WHERE id = ?')
              .get(session.user_id) as Pick<UserRecord, 'quota_seconds' | 'used_seconds'> | undefined;
            if (u && u.quota_seconds !== null && u.used_seconds >= u.quota_seconds) {
              this.db
                .prepare("UPDATE users SET status = 'expired', updated_at = ? WHERE id = ?")
                .run(nowIso, session.user_id);
            }
          }
        }
        this.db.exec('COMMIT;');
        updatedCount++;
      } catch (err) {
        this.db.exec('ROLLBACK;');
        throw err;
      }

      if (isExpired) {
        expiredCount++;
        await this.mikrotik
          .revokeHotspotAccess({ username: session.hotspot_username, macAddress: session.mac_address })
          .catch(() => {});
      } else if (missingOnRouter) {
        disconnectedCount++;
      }
    }

    // Fail-closed orphan cleanup: revoke any Rawad HotSpot session on MikroTik with no active DB record
    if (mikrotikReachable) {
      for (const m of mikrotikActive) {
        if (!m.user.startsWith('free-') && !m.user.startsWith('usr-')) continue;
        const key = `${m.user}|${m.macAddress.toUpperCase()}`;
        if (!validActiveKeys.has(key)) {
          await this.mikrotik
            .revokeHotspotAccess({ username: m.user, macAddress: m.macAddress })
            .catch(() => {});
          orphansRevoked++;
        }
      }
    }

    if (updatedCount > 0 || expiredCount > 0 || disconnectedCount > 0 || orphansRevoked > 0) {
      this.notify();
    }

    return { expiredCount, disconnectedCount, updatedCount, orphansRevoked };
  }

  async terminateSession(
    actor: { id: string; username: string; role: AdminRole },
    sessionId: string,
    ipAddress: string
  ): Promise<void> {
    const session = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as SessionRecord | undefined;
    if (!session) throw new NotFoundError('الجلسة غير موجودة');

    await this.syncSessions();
    const fresh = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as unknown as SessionRecord;

    if (fresh.status === 'active') {
      await this.mikrotik
        .revokeHotspotAccess({ username: fresh.hotspot_username, macAddress: fresh.mac_address })
        .catch(() => {});

      const nowIso = this.now().toISOString();
      this.db
        .prepare(
          "UPDATE sessions SET status = 'terminated', ended_at = ?, end_reason = 'admin_terminated' WHERE id = ?"
        )
        .run(nowIso, sessionId);
    }

    this.audit.record({
      adminId: actor.id,
      adminUsername: actor.username,
      action: 'SESSION_TERMINATE',
      targetType: 'session',
      targetId: sessionId,
      targetLabel: fresh.hotspot_username,
      ipAddress,
      previousValue: { status: fresh.status, mac_address: fresh.mac_address },
      newValue: { status: 'terminated' },
    });

    this.notify();
  }

  async disconnectByMac(macAddress: string): Promise<void> {
    const mac = normalizeMac(macAddress);
    await this.syncSessions();

    const active = this.db
      .prepare("SELECT * FROM sessions WHERE mac_address = ? AND status = 'active'")
      .get(mac) as SessionRecord | undefined;

    if (!active) return;

    await this.mikrotik
      .revokeHotspotAccess({ username: active.hotspot_username, macAddress: active.mac_address })
      .catch(() => {});

    const nowIso = this.now().toISOString();
    this.db
      .prepare(
        "UPDATE sessions SET status = 'disconnected', ended_at = ?, end_reason = 'user_disconnected' WHERE id = ?"
      )
      .run(nowIso, active.id);

    this.notify();
  }

  getActiveSessions(): ActiveSessionView[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, u.username AS account_username
         FROM sessions s
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status = 'active'
         ORDER BY s.started_at DESC`
      )
      .all() as unknown as Array<SessionRecord & { account_username: string | null }>;

    const nowMs = this.now().getTime();
    return rows.map((r) => {
      const elapsedSinceSync = Math.max(0, Math.floor((nowMs - Date.parse(r.last_synced_at)) / 1000));
      const consumed =
        r.allowed_seconds !== null
          ? Math.min(r.allowed_seconds, r.consumed_seconds + elapsedSinceSync)
          : r.consumed_seconds + elapsedSinceSync;
      const remaining =
        r.allowed_seconds !== null ? Math.max(0, r.allowed_seconds - consumed) : null;

      return {
        id: r.id,
        session_type: r.session_type,
        username: r.session_type === 'free' ? 'مجاني (30 دقيقة)' : r.account_username || r.hotspot_username,
        device_name: r.device_name,
        device_type: r.device_type,
        device_model: r.device_model,
        mac_address: r.mac_address,
        ip_address: r.ip_address,
        status: r.status,
        allowed_seconds: r.allowed_seconds,
        consumed_seconds: consumed,
        remaining_seconds: remaining,
        started_at: r.started_at,
        expires_at: r.expires_at,
      };
    });
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const activeSessionsRow = this.db
      .prepare("SELECT COUNT(*) AS cnt, COUNT(DISTINCT mac_address) AS uniq_mac FROM sessions WHERE status = 'active'")
      .get() as { cnt: number; uniq_mac: number };
    const totalUsersRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM users')
      .get() as { cnt: number };
    const adminsRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM admins WHERE is_active = 1')
      .get() as { cnt: number };
    const mikrotik = await this.mikrotik.checkConnection();

    return {
      activeUsersCount: activeSessionsRow.uniq_mac,
      totalUsersCount: totalUsersRow.cnt,
      activeSessionsCount: activeSessionsRow.cnt,
      adminsCount: adminsRow.cnt,
      mikrotik,
    };
  }
}
