import { createHash, randomBytes } from 'node:crypto';

// Purposes keep tokens from being used for the wrong flow (a verification link can never reset a password).
// EMT-13 (password reset) adds its own purpose here and reuses issue()/consume() unchanged.
export const TOKEN_PURPOSES = Object.freeze({
  EMAIL_VERIFICATION: 'email_verification'
});

// 32 random bytes, base64url encoded.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Random, single-use, expiring tokens. Only a SHA-256 hash is stored, so a database leak
 * does not expose usable tokens. The plaintext token is returned once from issue() and
 * must only ever be sent to the user (never logged or returned by an API).
 */
export class OneTimeTokenService {
  constructor(db, clock) {
    this.db = db;
    this.clock = clock;
  }

  // Issues a token and invalidates any earlier token for the same user and purpose.
  issue(userId, purpose, ttlSeconds) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.clock() + ttlSeconds;
    this.db.transaction(() => {
      this.db.run('DELETE FROM one_time_tokens WHERE user_id = ? AND purpose = ?', [userId, purpose]);
      this.db.run(
        'INSERT INTO one_time_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)',
        [hashToken(token), userId, purpose, expiresAt]
      );
    });
    return token;
  }

  // Returns the user id if the token is valid for this purpose, and uses it up. Otherwise returns null.
  // A known token is deleted even when it has expired, so it cannot be tried again.
  consume(token, purpose) {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
    const tokenHash = hashToken(token);
    return this.db.transaction(() => {
      const record = this.db.get(
        'SELECT user_id, expires_at FROM one_time_tokens WHERE token_hash = ? AND purpose = ?',
        [tokenHash, purpose]
      );
      if (!record) return null;
      this.db.run('DELETE FROM one_time_tokens WHERE token_hash = ?', [tokenHash]);
      if (record.expires_at <= this.clock()) return null;
      return record.user_id;
    });
  }
}
