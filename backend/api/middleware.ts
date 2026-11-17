import type { NextFunction, Request, Response } from 'express';
import { verifyAdminToken, type AdminTokenPayload } from '../authentication/tokens.js';

export interface AuthenticatedRequest extends Request {
  admin?: AdminTokenPayload;
}

function normalizeIp(raw?: string | null): string {
  if (!raw) return '0.0.0.0';
  return raw.replace(/^::ffff:/, '').trim();
}

function isTrustedProxyPeer(peerIp: string): boolean {
  return (
    peerIp === '127.0.0.1' ||
    peerIp === '::1' ||
    peerIp.startsWith('172.') ||
    peerIp.startsWith('10.')
  );
}

export function getClientIp(req: Request, trustProxy = false): string {
  const peerIp = normalizeIp(req.socket.remoteAddress);
  if (trustProxy && isTrustedProxyPeer(peerIp)) {
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) {
      return normalizeIp(realIp);
    }
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
      return normalizeIp(fwd.split(',')[0]);
    }
  }
  return peerIp;
}

export function requireAdmin(tokenSecret: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
    const rawToken =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : queryToken;

    if (!rawToken) {
      res.status(401).json({ error: 'مطلوب تسجيل الدخول للوصول إلى لوحة الإدارة' });
      return;
    }

    const payload = verifyAdminToken(rawToken, tokenSecret);
    if (!payload) {
      res.status(401).json({ error: 'جلسة الإدارة غير صالحة أو منتهية' });
      return;
    }

    req.admin = payload;
    next();
  };
}

export function createRateLimiter(maxRequests: number, windowMs: number, trustProxy = false) {
  const buckets = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${getClientIp(req, trustProxy)}:${req.path}`;
    const now = Date.now();
    const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= maxRequests) {
      res.status(429).json({ error: 'تم تجاوز الحد المسموح من الطلبات، يرجى المحاولة بعد قليل' });
      return;
    }
    hits.push(now);
    buckets.set(key, hits);
    next();
  };
}
