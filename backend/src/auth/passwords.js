import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const HASH_BYTES = 32;
export const DEFAULT_ITERATIONS = 600_000;

export function hashPassword(password, iterations = DEFAULT_ITERATIONS) {
  const salt = randomBytes(SALT_BYTES);
  const hash = pbkdf2Sync(password, salt, iterations, HASH_BYTES, 'sha256');
  return `pbkdf2$${iterations}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations <= 0) return false;
  if (!/^(?:[0-9a-f]{2})+$/i.test(parts[2]) || !/^(?:[0-9a-f]{2})+$/i.test(parts[3])) return false;

  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  if (salt.length === 0 || expected.length !== HASH_BYTES) return false;

  const actual = pbkdf2Sync(password, salt, iterations, HASH_BYTES, 'sha256');
  return timingSafeEqual(actual, expected);
}
