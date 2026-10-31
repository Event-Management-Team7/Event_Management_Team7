import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { DEFAULT_COST, hashPassword, verifyPassword } from '../auth/passwords.js';

// Token lifetime is 1 hour with no refresh token (EMT-12 scope decision).
const TOKEN_TTL_SECONDS = 60 * 60;
const JWT_ALGORITHM = 'HS256';
const MAX_FAILURES = 5;
const LOCK_SECONDS = 5 * 60;
const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
const DUMMY_HASH = hashPassword('dummy-pass-never-matches-anything');

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    emailVerified: Boolean(row.email_verified),
    createdAt: row.created_at
  };
}

function createUser(db, clock, cost, { name, email, phone = '', password, role, emailVerified = false }) {
  // Emails are stored trimmed and lowercase so uniqueness and login are case-insensitive.
  name = name.trim();
  email = email.trim().toLowerCase();
  // The UNIQUE index is case-sensitive, so also catch accounts stored with mixed-case emails.
  if (db.get('SELECT 1 AS found FROM users WHERE lower(email) = ?', [email])) return null;
  const passwordHash = hashPassword(password, cost);
  const createdAt = clock();
  try {
    const result = db.run(
      `INSERT INTO users (name, email, phone, role, password_hash, email_verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, email, phone, role, passwordHash, emailVerified ? 1 : 0, createdAt]
    );
    const row = db.get(
      'SELECT id, name, email, phone, role, email_verified, created_at FROM users WHERE id = ?',
      [result.lastInsertRowid]
    );
    return publicUser(row);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return null;
    }
    throw error;
  }
}

export class AuthService {
  constructor(
    db,
    { cost = DEFAULT_COST, clock = () => Math.floor(Date.now() / 1000), jwtSecret = process.env.EMRS_JWT_SECRET } = {}
  ) {
    if (!jwtSecret) {
      // Without a configured secret, tokens stop working whenever the server restarts.
      console.warn('EMRS_JWT_SECRET is not set; using a random secret. Issued tokens will not survive a restart.');
      jwtSecret = randomBytes(32).toString('hex');
    }
    this.jwtSecret = jwtSecret;
    this.db = db;
    this.cost = cost;
    this.clock = clock;
    this.attempts = new Map();
  }

  register(input) {
    const role = typeof input.role === 'string' ? input.role.trim() : '';
    if (role !== 'Attendee' && role !== 'Organizer') {
      throw new TypeError('Public registration only allows the Attendee or Organizer role');
    }
    return createUser(this.db, this.clock, this.cost, { ...input, role });
  }

  createEmailVerificationToken(userId) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = this.clock() + EMAIL_VERIFICATION_TTL_SECONDS;
    this.db.transaction(() => {
      this.db.run('DELETE FROM email_verification_tokens WHERE user_id = ?', [userId]);
      this.db.run(
        'INSERT INTO email_verification_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
        [tokenHash, userId, expiresAt]
      );
    });
    return token;
  }

  verifyEmail(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return this.db.transaction(() => {
      const record = this.db.get(
        'SELECT user_id, expires_at FROM email_verification_tokens WHERE token_hash = ?',
        [tokenHash]
      );
      if (!record) return false;
      this.db.run('DELETE FROM email_verification_tokens WHERE token_hash = ?', [tokenHash]);
      if (record.expires_at <= this.clock()) return false;
      this.db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [record.user_id]);
      return true;
    });
  }

  // Admin accounts are never self-registered (SRS EMRS-F-001); seed scripts or an existing Admin use this.
  provisionUser(input) {
    if (input.role !== 'Admin') {
      throw new TypeError('Trusted provisioning requires the Admin role');
    }
    // Accounts created by a trusted caller do not need to verify an email address.
    return createUser(this.db, this.clock, this.cost, { ...input, emailVerified: true });
  }

  login(email, password) {
    const now = this.clock();
    // Emails are matched case-insensitively.
    email = email.trim().toLowerCase();
    const attempt = this.attempts.get(email);
    if (attempt && attempt.lockedUntil > now) return { status: 'locked', retryAfterSeconds: attempt.lockedUntil - now };

    const user = this.db.get(
      'SELECT id, name, email, phone, role, email_verified, password_hash, created_at FROM users WHERE lower(email) = ?',
      [email]
    );
    // Verify against a dummy hash for unknown emails so response time does not reveal which emails exist.
    const passwordIsValid = verifyPassword(password, user?.password_hash ?? DUMMY_HASH) && Boolean(user);
    if (!passwordIsValid) {
      const current = this.attempts.get(email) ?? { failures: 0, lockedUntil: 0 };
      current.failures += 1;
      if (current.failures >= MAX_FAILURES) {
        current.failures = 0;
        current.lockedUntil = now + LOCK_SECONDS;
        this.attempts.set(email, current);
        return { status: 'locked', retryAfterSeconds: LOCK_SECONDS };
      }
      this.attempts.set(email, current);
      return { status: 'invalid' };
    }

    this.attempts.delete(email);
    const expiresAt = now + TOKEN_TTL_SECONDS;
    const token = jwt.sign({ sub: String(user.id), role: user.role, iat: now }, this.jwtSecret, {
      algorithm: JWT_ALGORITHM,
      expiresIn: TOKEN_TTL_SECONDS
    });
    return {
      status: 'ok',
      token,
      expiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: Boolean(user.email_verified)
      }
    };
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret, { algorithms: [JWT_ALGORITHM], clockTimestamp: this.clock() });
    } catch {
      return null;
    }
  }

  // Returns the current user for a valid, unexpired token, otherwise null.
  // The user is read from the database so role changes and deleted accounts take effect immediately.
  authenticate(token) {
    const claims = this.verifyToken(token);
    if (!claims) return null;
    const id = Number(claims.sub);
    if (!Number.isSafeInteger(id)) return null;
    const row = this.db.get(
      'SELECT id, name, email, phone, role, email_verified FROM users WHERE id = ?',
      [id]
    );
    if (!row) return null;
    const { email_verified: emailVerified, ...user } = row;
    return { ...user, emailVerified: Boolean(emailVerified) };
  }

  // Tokens are stateless and logout is client-side (discard the token).
  // This only confirms the token was valid; there is no server-side revocation in Sprint 1.
  logout(token) {
    return this.verifyToken(token) !== null;
  }
}
