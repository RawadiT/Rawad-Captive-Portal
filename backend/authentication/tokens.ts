import crypto from 'node:crypto';

export interface AdminTokenPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

function toBase64Url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signAdminToken(
  payload: Omit<AdminTokenPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds = 8 * 3600
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: AdminTokenPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  };
  const encoded = toBase64Url(JSON.stringify(fullPayload));
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyAdminToken(token: string, secret: string): AdminTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as AdminTokenPayload;
    if (!parsed.sub || !parsed.username || !parsed.exp) return null;
    if (Math.floor(Date.now() / 1000) >= parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}
