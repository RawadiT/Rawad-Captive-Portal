import type { DatabaseClient } from '../db/client.js';
import type { MikroTikAdapter } from '../mikrotik/adapter.js';
import { normalizeMac } from '../quota-manager/macUtils.js';
import type { MikroTikActiveSession } from '../types/index.js';

export class SessionMonitor {
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => Date;

  constructor(
    private readonly db: DatabaseClient,
    private readonly mikrotik: MikroTikAdapter,
    nowProvider?: () => Date
  ) {
    this.now = nowProvider ?? (() => new Date());
  }

  start(intervalMs = 5000): void {
    if (this.timer) return;
    void this.syncSessions().catch((err) => {
      console.error('[SessionMonitor] initial sync failed:', err instanceof Error ? err.message : err);
    });
    this.timer = setInterval(() => {
      void this.syncSessions().catch((err) => {
        console.error('[SessionMonitor] periodic sync failed:', err instanceof Error ? err.message : err);
      });
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

    // 1. Retry any revocation_pending sessions FIRST; only mark 'disconnected' after RouterOS revoke succeeds
    const pendingRevokes = await this.db.listRevocationPendingSessions();
    for (const p of pendingRevokes) {
      try {
        await this.mikrotik.revokeHotspotAccess({
          username: p.hotspot_username,
          macAddress: p.mac_address,
          profile: p.hotspot_profile,
        });
        await this.db.updateSessionStatus(p.id, 'disconnected');
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
        // NEVER mark 'expired' in DB before RouterOS revocation succeeds; keep 'active' so next tick retries
        try {
          await this.mikrotik.revokeHotspotAccess({
            username: s.hotspot_username,
            macAddress: s.mac_address,
            profile: s.hotspot_profile,
          });
          await this.db.updateSessionStatus(s.id, 'expired');
          expiredCount++;
        } catch (err) {
          console.error(
            `[SessionMonitor] Failed to revoke expired session '${s.hotspot_username}' (kept active for retry):`,
            err instanceof Error ? err.message : err
          );
        }
      } else if (missingOnRouter) {
        // RouterOS already confirmed session is absent from /ip/hotspot/active
        await this.db.updateSessionStatus(s.id, 'disconnected');
        disconnectedCount++;
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

    return { expiredCount, disconnectedCount, orphansRevoked };
  }

  async disconnectByMac(macAddress: string): Promise<void> {
    const mac = normalizeMac(macAddress);
    const active = await this.db.getActiveSessionByMac(mac);
    if (!active) return;

    // NEVER mark session disconnected in PostgreSQL if RouterOS revocation fails
    await this.mikrotik.revokeHotspotAccess({
      username: active.hotspot_username,
      macAddress: active.mac_address,
      profile: active.hotspot_profile,
    });
    await this.db.updateSessionStatus(active.id, 'disconnected');
  }
}
