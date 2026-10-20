import { randomBytes } from 'node:crypto';
import { DEFAULT_ITERATIONS, hashPassword, verifyPassword } from '../auth/passwords.js';

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const MAX_FAILURES = 5;
const LOCK_SECONDS = 5 * 60;
const DUMMY_HASH = hashPassword('dummy-pass-never-matches-anything');

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    createdAt: row.created_at
  };
}

function createUser(db, clock, iterations, { name, email, phone = '', password, role }) {
  const passwordHash = hashPassword(password, iterations);
  const createdAt = clock();
  try {
    const result = db.run(
      `INSERT INTO users (name, email, phone, role, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email, phone, role, passwordHash, createdAt]
    );
    const row = db.get(
      'SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?',
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
  constructor(db, { iterations = DEFAULT_ITERATIONS, clock = () => Math.floor(Date.now() / 1000) } = {}) {
    this.db = db;
    this.iterations = iterations;
    this.clock = clock;
    this.attempts = new Map();
  }

  register(input) {
    return createUser(this.db, this.clock, this.iterations, { ...input, role: 'Attendee' });
  }

  provisionUser(input) {
    if (input.role !== 'Organizer' && input.role !== 'Admin') {
      throw new TypeError('Trusted provisioning requires the Organizer or Admin role');
    }
    return createUser(this.db, this.clock, this.iterations, input);
  }

  login(email, password) {
    const now = this.clock();
    const attempt = this.attempts.get(email);
    if (attempt && attempt.lockedUntil > now) return { status: 'locked' };

    const user = this.db.get(
      'SELECT id, name, email, phone, role, password_hash, created_at FROM users WHERE email = ?',
      [email]
    );
    const passwordIsValid = verifyPassword(password, user?.password_hash ?? DUMMY_HASH) && Boolean(user);
    if (!passwordIsValid) {
      const current = this.attempts.get(email) ?? { failures: 0, lockedUntil: 0 };
      current.failures += 1;
      if (current.failures >= MAX_FAILURES) {
        current.failures = 0;
        current.lockedUntil = now + LOCK_SECONDS;
        this.attempts.set(email, current);
        return { status: 'locked' };
      }
      this.attempts.set(email, current);
      return { status: 'invalid' };
    }

    this.attempts.delete(email);
    const token = randomBytes(32).toString('hex');
    const expiresAt = now + SESSION_TTL_SECONDS;
    this.db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [
      token,
      user.id,
      expiresAt
    ]);
    return {
      status: 'ok',
      token,
      expiresAt,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    };
  }

  authenticate(token) {
    const now = this.clock();
    const session = this.db.get('SELECT user_id, expires_at FROM sessions WHERE token = ?', [token]);
    if (!session) return null;
    if (session.expires_at < now) {
      this.db.run('DELETE FROM sessions WHERE token = ?', [token]);
      return null;
    }
    return this.db.get(
      'SELECT id, name, email, phone, role FROM users WHERE id = ?',
      [session.user_id]
    ) ?? null;
  }

  logout(token) {
    return this.db.run('DELETE FROM sessions WHERE token = ?', [token]).changes > 0;
  }
}
