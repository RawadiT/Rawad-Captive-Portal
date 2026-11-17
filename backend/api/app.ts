import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ForbiddenError, type AdminService } from '../authentication/adminService.js';
import type { AppConfig } from '../config/env.js';
import type { DatabaseClient } from '../db/client.js';
import type { MikroTikAdapter } from '../mikrotik/adapter.js';
import { normalizeMac } from '../quota-manager/macUtils.js';
import type { QuotaService } from '../quota-manager/quotaService.js';
import type { SessionMonitor } from '../session-monitor/sessionMonitor.js';
import { createRateLimiter, getClientIp, requireAdmin, type AuthenticatedRequest } from './middleware.js';

export interface AppDependencies {
  config: AppConfig;
  db: DatabaseClient;
  adminService: AdminService;
  quotaService: QuotaService;
  sessionMonitor: SessionMonitor;
  mikrotik: MikroTikAdapter;
}

export function createApp(deps: AppDependencies) {
  const { config, db, adminService, quotaService, sessionMonitor, mikrotik } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const allowed = new Set([
          config.guestPortalOrigin,
          config.adminDashboardOrigin,
          'http://localhost:3000',
          'http://127.0.0.1:3000',
        ]);
        if (allowed.has(origin)) return cb(null, true);
        return cb(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '64kb' }));

  const authLimiter = createRateLimiter(30, 60_000, config.trustProxy);
  const adminAuth = requireAdmin(config.tokenSecret);

  async function resolveVerifiedGuest(req: Request): Promise<{ macAddress: string; ipAddress: string }> {
    const clientIp = getClientIp(req, config.trustProxy);
    const claimedMacRaw =
      (typeof req.query.mac === 'string' && req.query.mac) ||
      (typeof req.body?.macAddress === 'string' && req.body.macAddress) ||
      (typeof req.body?.mac === 'string' && req.body.mac) ||
      '';
    const claimedIpRaw =
      (typeof req.query.ip === 'string' && req.query.ip) ||
      (typeof req.body?.ipAddress === 'string' && req.body.ipAddress) ||
      '';

    const resolved = await mikrotik.resolveClientByIp(clientIp);
    if (resolved) {
      if (claimedMacRaw) {
        const claimedMac = normalizeMac(claimedMacRaw);
        if (claimedMac !== resolved.macAddress.toUpperCase()) {
          throw new ForbiddenError('رفض الطلب: عنوان MAC المرسل لا يطابق الجهاز المتصل فعلياً');
        }
      }
      if (claimedIpRaw && claimedIpRaw.trim() !== resolved.ipAddress) {
        throw new ForbiddenError('رفض الطلب: عنوان IP المرسل لا يطابق الجهاز المتصل فعلياً');
      }
      return { macAddress: resolved.macAddress.toUpperCase(), ipAddress: resolved.ipAddress };
    }

    if (config.allowDevMacFallback && claimedMacRaw) {
      return { macAddress: normalizeMac(claimedMacRaw), ipAddress: clientIp };
    }

    throw new ForbiddenError('الجهاز غير مسجل في جدول HotSpot Host على MikroTik');
  }

  app.get('/api/health', async (_req, res) => {
    try {
      await db.ping();
      res.json({ ok: true, database: 'supabase-https', service: 'rawad-captive-portal-backend' });
    } catch (err) {
      res.status(503).json({
        ok: false,
        database: 'unreachable',
        error: err instanceof Error ? err.message : 'Database unreachable',
      });
    }
  });

  // ── Guest Captive Portal Routes ─────────────────────────────────────────────

  app.get('/api/guest/status', async (req, res, next) => {
    try {
      await sessionMonitor.syncSessions();
      const { macAddress, ipAddress } = await resolveVerifiedGuest(req);
      const status = await quotaService.getGuestStatus(macAddress);
      res.json({ ...status, macAddress, ipAddress });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/guest/free', authLimiter, async (req, res, next) => {
    try {
      const { macAddress, ipAddress } = await resolveVerifiedGuest(req);
      const result = await quotaService.grantFreeAccess({ macAddress, ipAddress });
      res.json({
        ok: true,
        session: result.session,
        remainingSeconds: result.remainingSeconds,
        resumed: result.resumed,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/guest/login', authLimiter, async (req, res, next) => {
    try {
      const username = String(req.body?.username || '');
      const password = String(req.body?.password || '');
      if (!username || !password) {
        res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
        return;
      }

      const { macAddress, ipAddress } = await resolveVerifiedGuest(req);
      const result = await quotaService.loginUser({ username, password, macAddress, ipAddress });
      res.json({
        ok: true,
        session: result.session,
        user: result.user,
        remainingSeconds: result.remainingSeconds,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/guest/disconnect', async (req, res, next) => {
    try {
      const { macAddress } = await resolveVerifiedGuest(req);
      await sessionMonitor.disconnectByMac(macAddress);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/guest/capport', async (req, res, next) => {
    try {
      await sessionMonitor.syncSessions();
      const clientIp = getClientIp(req, config.trustProxy);
      const resolved = await mikrotik.resolveClientByIp(clientIp);
      const active = resolved ? await db.getActiveSessionByMac(resolved.macAddress) : null;
      const remaining = active
        ? Math.max(0, Math.floor((Date.parse(active.expires_at) - Date.now()) / 1000))
        : undefined;

      res.setHeader('Content-Type', 'application/captive+json');
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        captive: !active || remaining === 0,
        'user-portal-url': config.guestPortalOrigin,
        ...(remaining !== undefined && remaining > 0 ? { 'seconds-remaining': remaining } : {}),
        'can-extend-session': false,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Simplified Admin Routes (Section 8) ─────────────────────────────────────

  app.post('/api/admin/login', authLimiter, async (req, res, next) => {
    try {
      const username = String(req.body?.username || '');
      const password = String(req.body?.password || '');
      if (!username || !password) {
        res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
        return;
      }
      const result = await adminService.login(username, password);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/me', adminAuth, (req: AuthenticatedRequest, res) => {
    res.json({ admin: req.admin });
  });

  app.get('/api/admin/users', adminAuth, async (_req, res, next) => {
    try {
      res.json({ users: await quotaService.listUsers() });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/users', adminAuth, async (req, res, next) => {
    try {
      const user = await quotaService.createUser({
        username: String(req.body?.username || ''),
        password: String(req.body?.password || ''),
        duration_minutes: Number(req.body?.duration_minutes),
      });
      res.status(201).json({ user });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/users/:id/disable', adminAuth, async (req, res, next) => {
    try {
      const isDisabled = Boolean(req.body?.is_disabled);
      const user = await quotaService.setUserDisabled(String(req.params.id), isDisabled);
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/free-quotas', adminAuth, async (_req, res, next) => {
    try {
      res.json({ quotas: await quotaService.listFreeQuotas() });
    } catch (err) {
      next(err);
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const statusCode =
      typeof err === 'object' && err !== null && 'statusCode' in err
        ? Number((err as { statusCode: number }).statusCode)
        : 400;
    const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
    res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({ error: message });
  });

  return app;
}
