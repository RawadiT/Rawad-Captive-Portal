const enc = new TextEncoder();

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 6) {
    throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256
  );
  return `pbkdf2:${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;
  const salt = fromHex(saltHex);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256
  );
  return constantTimeEqual(toHex(new Uint8Array(bits)), hashHex);
}

function toBase64Url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64: string): string {
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return toBase64Url(String.fromCharCode(...new Uint8Array(sig)));
}

export interface AdminTokenPayload {
  sub: string;
  username: string;
  is_super_admin?: boolean;
  exp: number;
}

export async function signAdminToken(payload: { sub: string; username: string; is_super_admin?: boolean }, secret: string, ttlSeconds = 8 * 3600): Promise<string> {
  const full: AdminTokenPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = toBase64Url(JSON.stringify(full));
  const sig = await hmacSign(body, secret);
  return `${body}.${sig}`;
}

export async function verifyAdminToken(token: string, secret: string): Promise<AdminTokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = await hmacSign(body, secret);
  if (!constantTimeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(fromBase64Url(body)) as AdminTokenPayload;
    if (!payload.sub || !payload.username || Date.now() / 1000 >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
