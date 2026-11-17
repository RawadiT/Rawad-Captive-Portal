import crypto from 'node:crypto';
import type { DatabaseClient } from '../db/client.js';
import type { MikroTikAdapter } from '../mikrotik/adapter.js';
import { normalizeMac } from '../quota-manager/macUtils.js';
import type { MikroTikActiveSession, SessionRecord } from '../types/index.js';

export interface SyncSessionsResult {
  skipped?: boolean;
  reclaimedLeases: number;
  expiredCount: number;
  disconnectedCount: number;
  orphansRevoked: number;
}

export class SessionMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private syncInFlight: Promise<SyncSessionsResult> | null = null;
  private readonly instanceId = crypto.randomUUID();
  private readonly revokingSessionIds = new Set<string>();
  private readonly now: () => Date;

  constructor(
    private readonly db: DatabaseClient,
    private readonly mikrotik: MikroTikAdapter,
    nowProvider?: () => Date
  ) {
    this.now = nowProvider ?? (() => new Date());
  }

  start(intervalMs = 5000): void {
    if (this.running) return;
    this.running = true;

    const tick = (): void => {
      if (!this.running) return;
      void this.syncSessions()
        .catch((err) => {
          console.error('[SessionMonitor] periodic sync failed:', err instanceof Error ? err.message : err);
        })
        .finally(() => {
          if (!this.running) return;
          this.timer = setTimeout(tick, intervalMs);
          this.timer.unref();
        });
    };

    tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async updateSessionStatusWithRetry(
    sessionId: string,
    status: 'expired' | 'disconnected',
    attempts = 3
  ): Promise<void> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.db.updateSessionStatus(sessionId, status);
        return;
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) {
          await new Promise((r) => setTimeout(r, 150 * (i + 1)));
        }
      }
    }
    throw lastErr;
  }

  private async revokeAndFinalizeSession(
    s: SessionRecord,
    targetStatus: 'expired' | 'disconnected'
  ): Promise<boolean> {
    if (this.revokingSessionIds.has(s.id)) {
      return false; // Prevent duplicate concurrent revocations on the same session
    }
    this.revokingSessionIds.add(s.id);
    try {
      await this.mikrotik.revokeHotspotAccess({
        username: s.hotspot_username,
        macAddress: s.mac_address,
        profile: s.hotspot_profile,
      });
      await this.updateSessionStatusWithRetry(s.id, targetStatus);
      return true;
    } finally {
      this.revokingSessionIds.delete(s.id);
    }
  }

  syncSessions(): Promise<SyncSessionsResult> {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }
    this.syncInFlight = this.executeSyncSessions().finally(() => {
      this.syncInFlight = null;
    });
    return this.syncInFlight;
  }

  private async executeSyncSessions(): Promise<SyncSessionsResult> {
    const acquired = await this.db.tryAcquireMonitorLock('session_monitor_sync', this.instanceId, 30);
    if (!acquired) {
      return {
        skipped: true,
        reclaimedLeases: 0,
        expiredCount: 0,
        disconnectedCount: 0,
        orphansRevoked: 0,
      };
    }

    try {
      // 0. Periodically reclaim expired 'provisioning' leases -> 'revocation_pending' even without user traffic
      let reclaimedLeases = 0;
      try {
        reclaimedLeases = await this.db.reclaimExpiredProvisioningLeases();
      } catch (err) {
        console.error(
          '[SessionMonitor] reclaimExpiredProvisioningLeases failed:',
          err instanceof Error ? err.message : err
        );
      }

      let mikrotikActive: MikroTikActiveSession[] = [];
      let mikrotikReachable = false;
      try {
        mikrotikActive = await this.mikrotik.listActiveSessions();
        mikrotikReachable = true;
      } catch {
        mikrotikReachable = false;
      }

      // 1. Retry any revocation_pending sessions FIRST; only mark 'disconnected' after RouterOS revoke succeeds
      const pendingRevokes = await this.db.listRevocationPendingSessions();
      for (const p of pendingRevokes) {
        try {
          await this.revokeAndFinalizeSession(p, 'disconnected');
        } catch (err) {
          console.error(
            `[SessionMonitor] Retry revoke failed for revocation_pending '${p.hotspot_username}':`,
            err instanceof Error ? err.message : err
          );
        }
      }

      const actives = await this.db.listActiveSessions();
      const activeByKey = new Map<string, MikroTikActiveSession>();
      for (const m of mikrotikActive) {
        activeByKey.set(`${m.user}|${m.macAddress.toUpperCase()}`, m);
      }

      const nowMs = this.now().getTime();
      let expiredCount = 0;
      let disconnectedCount = 0;
      let orphansRevoked = 0;
      const validActiveKeys = new Set<string>();

      for (const s of actives) {
        const isExpired = nowMs >= Date.parse(s.expires_at);
        const key = `${s.hotspot_username}|${s.mac_address.toUpperCase()}`;
        const missingOnRouter = mikrotikReachable && !activeByKey.has(key);

        if (isExpired) {
          try {
            const done = await this.revokeAndFinalizeSession(s, 'expired');
            if (done) expiredCount++;
          } catch (err) {
            console.error(
              `[SessionMonitor] Failed to finalize/revoke expired session '${s.hotspot_username}' (kept active for retry):`,
              err instanceof Error ? err.message : err
            );
          }
        } else if (missingOnRouter) {
          try {
            await this.updateSessionStatusWithRetry(s.id, 'disconnected');
            disconnectedCount++;
          } catch (err) {
            console.error(
              `[SessionMonitor] Failed to mark missing session '${s.hotspot_username}' disconnected (will retry):`,
              err instanceof Error ? err.message : err
            );
          }
        } else {
          validActiveKeys.add(key);
        }
      }

      if (mikrotikReachable) {
        for (const m of mikrotikActive) {
          if (!m.user.startsWith('free-') && !m.user.startsWith('usr-')) continue;
          const key = `${m.user}|${m.macAddress.toUpperCase()}`;
          if (!validActiveKeys.has(key)) {
            try {
              await this.mikrotik.revokeHotspotAccess({ username: m.user, macAddress: m.macAddress });
              orphansRevoked++;
            } catch (err) {
              console.error(
                `[SessionMonitor] Failed to revoke orphan session '${m.user}':`,
                err instanceof Error ? err.message : err
              );
            }
          }
        }
      }

      return { skipped: false, reclaimedLeases, expiredCount, disconnectedCount, orphansRevoked };
    } finally {
      await this.db.releaseMonitorLock('session_monitor_sync', this.instanceId).catch((err) => {
        console.error('[SessionMonitor] releaseMonitorLock failed:', err instanceof Error ? err.message : err);
      });
    }
  }

  async disconnectByMac(macAddress: string): Promise<void> {
    const mac = normalizeMac(macAddress);
    const active = await this.db.getActiveSessionByMac(mac);
    if (!active) return;

    await this.revokeAndFinalizeSession(active, 'disconnected');
  }
}
