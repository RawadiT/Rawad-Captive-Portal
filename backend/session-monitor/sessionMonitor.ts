import crypto from 'node:crypto';
import type { DatabaseClient } from '../db/client.js';
import type { MikroTikAdapter } from '../mikrotik/adapter.js';
import { normalizeMac } from '../quota-manager/macUtils.js';
import type { MikroTikActiveSession, SessionRecord } from '../types/index.js';

export interface SyncSessionsResult {
  skipped?: boolean;
  lockLost?: boolean;
  reclaimedLeases: number;
  expiredCount: number;
  disconnectedCount: number;
  orphansRevoked: number;
}

export interface SessionMonitorOptions {
  nowProvider?: () => Date;
  monitorLockLeaseSeconds?: number;
  monitorLockRenewIntervalMs?: number;
}

export class SessionMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private syncInFlight: Promise<SyncSessionsResult> | null = null;
  private readonly instanceId = crypto.randomUUID();
  private readonly revokingSessionIds = new Set<string>();
  private readonly now: () => Date;
  private readonly lockLeaseSeconds: number;
  private readonly lockRenewIntervalMs: number;

  constructor(
    private readonly db: DatabaseClient,
    private readonly mikrotik: MikroTikAdapter,
    nowOrOptions?: (() => Date) | SessionMonitorOptions
  ) {
    if (typeof nowOrOptions === 'function') {
      this.now = nowOrOptions;
      this.lockLeaseSeconds = 30;
      this.lockRenewIntervalMs = 10_000;
    } else {
      this.now = nowOrOptions?.nowProvider ?? (() => new Date());
      this.lockLeaseSeconds = nowOrOptions?.monitorLockLeaseSeconds ?? 30;
      this.lockRenewIntervalMs = nowOrOptions?.monitorLockRenewIntervalMs ?? 10_000;
    }
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

  private async updateSessionStatusFencedWithRetry(
    sessionId: string,
    status: 'expired' | 'disconnected',
    fenceToken: number,
    isLockLost: () => boolean,
    onLockLost: () => void,
    attempts = 3
  ): Promise<boolean> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      if (isLockLost()) return false;
      try {
        const ok = await this.db.fencedUpdateSessionStatus(
          sessionId,
          status,
          'session_monitor_sync',
          this.instanceId,
          fenceToken
        );
        if (!ok) {
          onLockLost();
          return false;
        }
        return true;
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
    targetStatus: 'expired' | 'disconnected',
    lockCtx?: {
      fenceToken: number;
      isLockLost: () => boolean;
      onLockLost: () => void;
      verifyLock: () => Promise<boolean>;
    }
  ): Promise<boolean> {
    if (lockCtx && !(await lockCtx.verifyLock())) {
      return false;
    }
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
      if (lockCtx) {
        return await this.updateSessionStatusFencedWithRetry(
          s.id,
          targetStatus,
          lockCtx.fenceToken,
          lockCtx.isLockLost,
          lockCtx.onLockLost
        );
      }
      await this.db.updateSessionStatus(s.id, targetStatus);
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
    const lockRes = await this.db.tryAcquireMonitorLock(
      'session_monitor_sync',
      this.instanceId,
      this.lockLeaseSeconds
    );
    if (!lockRes.acquired) {
      return {
        skipped: true,
        reclaimedLeases: 0,
        expiredCount: 0,
        disconnectedCount: 0,
        orphansRevoked: 0,
      };
    }

    const fenceToken = lockRes.fence_token;
    let lockLost = false;
    let lockStopped = false;
    let lockTimer: NodeJS.Timeout | null = null;
    let inFlightLockRenewal: Promise<void> | null = null;
    let renewalSeq = 0;

    const markLockLost = (): void => {
      if (!lockLost) {
        lockLost = true;
        console.error('[SessionMonitor] Lost monitor lock or fence_token mismatch; aborting further mutations.');
      }
    };

    const verifyLock = async (): Promise<boolean> => {
      if (lockLost || lockStopped) return false;
      try {
        const res = await this.db.tryAcquireMonitorLock(
          'session_monitor_sync',
          this.instanceId,
          this.lockLeaseSeconds
        );
        if (!res.acquired || res.fence_token !== fenceToken) {
          markLockLost();
          return false;
        }
        return true;
      } catch {
        markLockLost();
        return false;
      }
    };

    const lockCtx = {
      fenceToken,
      isLockLost: () => lockLost,
      onLockLost: markLockLost,
      verifyLock,
    };

    const scheduleLockRenewal = (): void => {
      if (lockStopped || lockLost) return;
      lockTimer = setTimeout(() => {
        if (lockStopped || lockLost) return;
        const seq = ++renewalSeq;
        inFlightLockRenewal = this.db
          .tryAcquireMonitorLock('session_monitor_sync', this.instanceId, this.lockLeaseSeconds)
          .then((res) => {
            if (seq === renewalSeq) inFlightLockRenewal = null;
            if (lockStopped || lockLost) return;
            if (!res.acquired || res.fence_token !== fenceToken) {
              markLockLost();
            } else {
              scheduleLockRenewal();
            }
          })
          .catch((err) => {
            if (seq === renewalSeq) inFlightLockRenewal = null;
            if (!lockStopped) {
              console.error(
                '[SessionMonitor] Monitor lock renewal failed; aborting further mutations:',
                err instanceof Error ? err.message : err
              );
              markLockLost();
            }
          });
      }, this.lockRenewIntervalMs);
      lockTimer.unref();
    };

    scheduleLockRenewal();

    try {
      // 0. Periodically reclaim expired 'provisioning' leases -> 'revocation_pending' even without user traffic
      let reclaimedLeases = 0;
      if (!lockLost) {
        try {
          reclaimedLeases = await this.db.reclaimExpiredProvisioningLeases();
        } catch (err) {
          console.error(
            '[SessionMonitor] reclaimExpiredProvisioningLeases failed:',
            err instanceof Error ? err.message : err
          );
        }
      }

      if (lockLost) {
        return { skipped: false, lockLost: true, reclaimedLeases, expiredCount: 0, disconnectedCount: 0, orphansRevoked: 0 };
      }

      let mikrotikActive: MikroTikActiveSession[] = [];
      let mikrotikReachable = false;
      try {
        mikrotikActive = await this.mikrotik.listActiveSessions();
        mikrotikReachable = true;
      } catch {
        mikrotikReachable = false;
      }

      if (lockLost) {
        return { skipped: false, lockLost: true, reclaimedLeases, expiredCount: 0, disconnectedCount: 0, orphansRevoked: 0 };
      }

      // 1. Retry any revocation_pending sessions FIRST; only mark 'disconnected' after RouterOS revoke succeeds
      const pendingRevokes = await this.db.listRevocationPendingSessions();
      for (const p of pendingRevokes) {
        if (lockLost) break;
        try {
          await this.revokeAndFinalizeSession(p, 'disconnected', lockCtx);
        } catch (err) {
          console.error(
            `[SessionMonitor] Retry revoke failed for revocation_pending '${p.hotspot_username}':`,
            err instanceof Error ? err.message : err
          );
        }
      }

      if (lockLost) {
        return { skipped: false, lockLost: true, reclaimedLeases, expiredCount: 0, disconnectedCount: 0, orphansRevoked: 0 };
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
        if (lockLost) break;
        const isExpired = nowMs >= Date.parse(s.expires_at);
        const key = `${s.hotspot_username}|${s.mac_address.toUpperCase()}`;
        const missingOnRouter = mikrotikReachable && !activeByKey.has(key);

        if (isExpired) {
          try {
            const done = await this.revokeAndFinalizeSession(s, 'expired', lockCtx);
            if (done) expiredCount++;
          } catch (err) {
            console.error(
              `[SessionMonitor] Failed to finalize/revoke expired session '${s.hotspot_username}' (kept active for retry):`,
              err instanceof Error ? err.message : err
            );
          }
        } else if (missingOnRouter) {
          try {
            const updated = await this.updateSessionStatusFencedWithRetry(
              s.id,
              'disconnected',
              fenceToken,
              () => lockLost,
              markLockLost
            );
            if (updated) disconnectedCount++;
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

      if (mikrotikReachable && !lockLost) {
        for (const m of mikrotikActive) {
          if (!(await verifyLock())) break;
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

      return { skipped: false, lockLost, reclaimedLeases, expiredCount, disconnectedCount, orphansRevoked };
    } finally {
      lockStopped = true;
      if (lockTimer) {
        clearTimeout(lockTimer);
        lockTimer = null;
      }
      const pendingLock = inFlightLockRenewal as Promise<void> | null;
      if (pendingLock) {
        await pendingLock.catch(() => {});
      }
      if (!lockLost) {
        await this.db.releaseMonitorLock('session_monitor_sync', this.instanceId).catch((err) => {
          console.error('[SessionMonitor] releaseMonitorLock failed:', err instanceof Error ? err.message : err);
        });
      }
    }
  }

  async disconnectByMac(macAddress: string): Promise<void> {
    const mac = normalizeMac(macAddress);
    const active = await this.db.getActiveSessionByMac(mac);
    if (!active) return;

    await this.revokeAndFinalizeSession(active, 'disconnected');
  }
}
