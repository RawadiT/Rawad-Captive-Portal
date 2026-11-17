import crypto from 'node:crypto';

const KEY_LEN = 64;

export function hashPassword(plain: string): string {
  if (!plain || plain.length < 4) {
    throw new Error('Password must be at least 4 characters');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, KEY_LEN).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, hashHex] = parts;
  const derived = crypto.scryptSync(plain, salt, KEY_LEN);
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(derived, expected);
}
