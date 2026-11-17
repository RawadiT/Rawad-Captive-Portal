import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type { AuditService } from '../audit-logs/auditService.js';
import { ForbiddenError, type AdminService } from '../authentication/adminService.js';
import type { AppConfig } from '../config/env.js';
import type { MikroTikAdapter } from '../mikrotik/adapter.js';
import { normalizeMac } from '../quota-manager/macUtils.js';
import type { QuotaService } from '../quota-manager/quotaService.js';
import type { SessionMonitor } from '../session-monitor/sessionMonitor.js';
import { createRateLimiter, getClientIp, requireAdmin, type AuthenticatedRequest } from './middleware.js';

export interface AppDependencies {
  config: AppConfig;
  adminService: AdminService;
  quotaService: QuotaService;
  sessionMonitor: SessionMonitor;
  auditService: AuditService;
  mikrotik: MikroTikAdapter;
}

export function createApp(deps: AppDependencies) {
  const { config, adminService, quotaService, sessionMonitor, auditService, mikrotik } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const allowed = new Set([
          config.guestPortalOrigin,
          config.adminDashboardOrigin,
          'http://localhost:3000',
          'http://localhost:3001',
          'https://localhost',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:3001',
        ]);
        if (allowed.has(origin)) {
          return cb(null, true);
        }
        return cb(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '64kb' }));

  const authLimiter = createRateLimiter(30, 60_000, config.trustProxy);
  const adminAuth = requireAdmin(config.tokenSecret);

  /**
   * Authoritatively resolves the requesting guest device from MikroTik HotSpot Host Table.
   * Rejects any attempt to spoof MAC or IP in query/body.
   */
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

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'rawad-captive-portal-backend' });
  });

  // ── Guest Captive Portal Routes ─────────────────────────────────────────────

  app.get('/api/guest/status', async (req, res, next) => {
    try {
      await sessionMonitor.syncSessions();
      const { macAddress, ipAddress } = await resolveVerifiedGuest(req);

      const eligibility = quotaService.getFreeEligibility(macAddress);
      let remainingSeconds: number | null = null;
      if (eligibility.activeSession) {
        const s = eligibility.activeSession;
        remainingSeconds =
          s.allowed_seconds === null ? null : Math.max(0, s.allowed_seconds - s.consumed_seconds);
      }

      res.json({
        connected: Boolean(eligibility.activeSession),
        macAddress,
        ipAddress,
        session: eligibility.activeSession,
        remainingSeconds,
        freeEligible: eligibility.eligible,
        freeReason: eligibility.reason,
        baghdadDate: eligibility.baghdadDate,
        nextResetAt: eligibility.nextResetAt,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/guest/free', authLimiter, async (req, res, next) => {
    try {
      const { macAddress, ipAddress } = await resolveVerifiedGuest(req);

      const result = await quotaService.grantFreeAccess({
        macAddress,
        ipAddress,
        userAgent: req.headers['user-agent'],
      });
      sessionMonitor.notify();

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

      const result = await quotaService.loginUser({
        username,
        password,
        macAddress,
        ipAddress,
        userAgent: req.headers['user-agent'],
      });
      sessionMonitor.notify();

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

  // RFC 8908 / RFC 8910 Captive Portal API endpoint — dynamically identifies device via IP -> HotSpot Host Table
  app.get('/api/guest/capport', async (req, res, next) => {
    try {
      await sessionMonitor.syncSessions();
      const clientIp = getClientIp(req, config.trustProxy);
      const resolved = await mikrotik.resolveClientByIp(clientIp);
      const active = resolved ? quotaService.getActiveSessionByMac(resolved.macAddress) : null;

      const remaining =
        active && active.allowed_seconds !== null
          ? Math.max(0, active.allowed_seconds - active.consumed_seconds)
          : undefined;

      res.setHeader('Content-Type', 'application/captive+json');
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        captive: !active,
        'user-portal-url': config.guestPortalOrigin,
        ...(remaining !== undefined ? { 'seconds-remaining': remaining } : {}),
        'can-extend-session': false,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Admin Dashboard Routes ──────────────────────────────────────────────────

  app.post('/api/admin/login', authLimiter, (req, res, next) => {
    try {
      const username = String(req.body?.username || '');
      const password = String(req.body?.password || '');
      if (!username || !password) {
        res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
        return;
      }
      const result = adminService.login(username, password, getClientIp(req, config.trustProxy));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/me', adminAuth, (req: AuthenticatedRequest, res) => {
    res.json({ admin: req.admin });
  });

  app.get('/api/admin/dashboard', adminAuth, async (_req, res, next) => {
    try {
      await sessionMonitor.syncSessions();
      const stats = await sessionMonitor.getDashboardStats();
      res.json(stats);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/sessions/active', adminAuth, async (_req, res, next) => {
    try {
      await sessionMonitor.syncSessions();
      res.json({ sessions: sessionMonitor.getActiveSessions() });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/sessions/:id/terminate', adminAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const actor = {
        id: req.admin!.sub,
        username: req.admin!.username,
        role: req.admin!.role,
      };
      await sessionMonitor.terminateSession(
        actor,
        String(req.params.id),
        getClientIp(req, config.trustProxy)
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/users', adminAuth, (_req, res) => {
    res.json({ users: quotaService.listUsers() });
  });

  app.post('/api/admin/users', adminAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const actor = {
        id: req.admin!.sub,
        username: req.admin!.username,
        role: req.admin!.role,
      };
      const user = quotaService.createUser(
        actor,
        {
          username: String(req.body?.username || ''),
          password: String(req.body?.password || ''),
          display_name: req.body?.display_name ?? null,
          quota_minutes:
            req.body?.quota_minutes === null || req.body?.quota_minutes === undefined || req.body?.quota_minutes === ''
              ? null
              : Number(req.body.quota_minutes),
        },
        getClientIp(req, config.trustProxy)
      );
      res.status(201).json({ user });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/users/:id', adminAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const actor = {
        id: req.admin!.sub,
        username: req.admin!.username,
        role: req.admin!.role,
      };
      const user = await quotaService.updateUser(
        actor,
        String(req.params.id),
        {
          display_name: req.body?.display_name,
          password: req.body?.password || undefined,
          quota_minutes:
            req.body?.quota_minutes === undefined
              ? undefined
              : req.body?.quota_minutes === null || req.body?.quota_minutes === ''
                ? null
                : Number(req.body.quota_minutes),
          status: req.body?.status,
        },
        getClientIp(req, config.trustProxy)
      );
      sessionMonitor.notify();
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/admin/users/:id', adminAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const actor = {
        id: req.admin!.sub,
        username: req.admin!.username,
        role: req.admin!.role,
      };
      await quotaService.deleteUser(actor, String(req.params.id), getClientIp(req, config.trustProxy));
      sessionMonitor.notify();
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/admins', adminAuth, (_req, res) => {
    res.json({ admins: adminService.listAdmins() });
  });

  app.post('/api/admin/admins', adminAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const actor = {
        id: req.admin!.sub,
        username: req.admin!.username,
        role: req.admin!.role,
      };
      const admin = adminService.createAdmin(
        actor,
        {
          username: String(req.body?.username || ''),
          password: String(req.body?.password || ''),
          display_name: String(req.body?.display_name || ''),
          role: req.body?.role === 'super_admin' ? 'super_admin' : 'admin',
        },
        getClientIp(req, config.trustProxy)
      );
      res.status(201).json({ admin });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/admins/:id', adminAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const actor = {
        id: req.admin!.sub,
        username: req.admin!.username,
        role: req.admin!.role,
      };
      const admin = adminService.updateAdmin(
        actor,
        String(req.params.id),
        {
          display_name: req.body?.display_name,
          password: req.body?.password || undefined,
          is_active: req.body?.is_active,
          role: req.body?.role,
        },
        getClientIp(req, config.trustProxy)
      );
      res.json({ admin });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/audit-logs', adminAuth, (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    res.json({ logs: auditService.list(limit, offset) });
  });

  app.get('/api/admin/events', adminAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendSnapshot = async () => {
      try {
        const stats = await sessionMonitor.getDashboardStats();
        const sessions = sessionMonitor.getActiveSessions();
        res.write(`data: ${JSON.stringify({ stats, sessions, ts: Date.now() })}\n\n`);
      } catch {
        // Ignore transient write errors
      }
    };

    void sendSnapshot();
    const unsub = sessionMonitor.onUpdate(() => void sendSnapshot());
    const heartbeat = setInterval(() => void sendSnapshot(), 2500);

    req.on('close', () => {
      unsub();
      clearInterval(heartbeat);
    });
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
