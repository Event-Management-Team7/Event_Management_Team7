import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

const HASH_BYTES = 32;
// bcrypt cost factor (work factor). Each +1 doubles the time to hash.
export const DEFAULT_COST = 10;

export function hashPassword(password, cost = DEFAULT_COST) {
  return bcrypt.hashSync(password, cost);
}

// Hashes created before the bcrypt switch use `pbkdf2$<iterations>$<salt>$<hash>`.
// They still verify so existing accounts keep working.
function verifyLegacyPbkdf2(password, stored) {
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

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  if (stored.startsWith('pbkdf2$')) return verifyLegacyPbkdf2(password, stored);
  try {
    return bcrypt.compareSync(password, stored);
  } catch {
    return false;
  }
}
