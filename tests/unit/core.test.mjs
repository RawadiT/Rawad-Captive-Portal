import test from 'node:test';
import assert from 'node:assert/strict';
import { getBaghdadDateString, getNextBaghdadMidnightIso } from '../../backend/dist/quota-manager/baghdadTime.js';
import { hashPassword, verifyPassword } from '../../backend/dist/authentication/password.js';
import { signAdminToken, verifyAdminToken } from '../../backend/dist/authentication/tokens.js';
import { detectDeviceFromUserAgent, normalizeMac } from '../../backend/dist/quota-manager/macUtils.js';

test('Baghdad timezone date calculation rolls over at 00:00 Asia/Baghdad (21:00 UTC)', () => {
  // 2026-11-17 20:59:59 UTC == 2026-11-17 23:59:59 Baghdad
  const beforeMidnightBaghdad = new Date('2026-11-17T20:59:59Z');
  assert.equal(getBaghdadDateString(beforeMidnightBaghdad), '2026-11-17');

  // 2026-11-17 21:00:00 UTC == 2026-11-18 00:00:00 Baghdad
  const atMidnightBaghdad = new Date('2026-11-17T21:00:00Z');
  assert.equal(getBaghdadDateString(atMidnightBaghdad), '2026-11-18');

  const nextMidnight = getNextBaghdadMidnightIso(beforeMidnightBaghdad);
  assert.equal(nextMidnight, '2026-11-17T21:00:00.000Z');
});

test('Password hashing uses scrypt with salt and timing-safe verification', () => {
  const hash1 = hashPassword('RawadSecret123');
  const hash2 = hashPassword('RawadSecret123');
  assert.notEqual(hash1, hash2);
  assert.ok(hash1.startsWith('scrypt:'));
  assert.equal(verifyPassword('RawadSecret123', hash1), true);
  assert.equal(verifyPassword('WrongPassword', hash1), false);
});

test('Admin token signing, verification, and tamper rejection', () => {
  const secret = 'test-secret-key';
  const token = signAdminToken({ sub: 'a1', username: 'admin1', role: 'super_admin' }, secret, 3600);
  const verified = verifyAdminToken(token, secret);
  assert.ok(verified);
  assert.equal(verified.username, 'admin1');
  assert.equal(verified.role, 'super_admin');

  const tampered = token.slice(0, -2) + 'xx';
  assert.equal(verifyAdminToken(tampered, secret), null);
  assert.equal(verifyAdminToken(token, 'wrong-secret'), null);
});

test('MAC normalization and conservative device detection', () => {
  assert.equal(normalizeMac('aa-bb-cc-dd-ee-ff'), 'AA:BB:CC:DD:EE:FF');
  assert.throws(() => normalizeMac('invalid-mac'));

  const unknown = detectDeviceFromUserAgent('CustomAgent/1.0');
  assert.equal(unknown.deviceName, null);
  assert.equal(unknown.deviceModel, null);

  const iphone = detectDeviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
  assert.equal(iphone.deviceModel, 'iPhone');
  assert.equal(iphone.deviceName, null);
});
