import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';
import { AuthService } from '../src/services/auth.js';
import { Database } from '../src/db/database.js';

test('password hashes are salted bcrypt hashes that verify correctly', () => {
  const first = hashPassword('SecurePass123', 4);
  const second = hashPassword('SecurePass123', 4);
  assert.match(first, /^\$2[aby]\$04\$/);
  assert.notEqual(first, second);
  assert.equal(verifyPassword('SecurePass123', first), true);
  assert.equal(verifyPassword('IncorrectPass123', first), false);
  assert.equal(verifyPassword('SecurePass123', 'not-a-hash'), false);
  const long = `Aa1${'x'.repeat(69)}`;
  const longHash = hashPassword(long, 4);
  assert.equal(verifyPassword(long, longHash), true);
  assert.equal(verifyPassword(`${long}extra`, longHash), false);
  assert.throws(() => hashPassword(`${long}x`, 4), RangeError);
});

test('legacy PBKDF2 hashes still verify so existing accounts keep working', () => {
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const hash = pbkdf2Sync('SecurePass123', salt, 1_000, 32, 'sha256').toString('hex');
  const legacy = `pbkdf2$1000$${salt.toString('hex')}$${hash}`;
  assert.equal(verifyPassword('SecurePass123', legacy), true);
  assert.equal(verifyPassword('IncorrectPass123', legacy), false);
  assert.equal(verifyPassword('SecurePass123', 'pbkdf2$invalid$salt$hash'), false);
});

test('public registration allows Attendee and Organizer; Admin is provisioned through the trusted service only', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const auth = new AuthService(db, { cost: 4, clock: () => 100 });

  const attendee = auth.register({ name: 'Public User', email: 'public@example.test', password: 'SecurePass123', role: 'Attendee' });
  assert.equal(attendee.role, 'Attendee');
  const organizer = auth.register({ name: 'Public Organizer', email: 'org@example.test', password: 'SecurePass123', role: 'Organizer' });
  assert.equal(organizer.role, 'Organizer');
  assert.throws(
    () => auth.register({ name: 'Sneaky Admin', email: 'admin@example.test', password: 'SecurePass123', role: 'Admin' }),
    /Public registration/
  );

  const admin = auth.provisionUser({ name: 'Trusted Admin', email: 'trusted@example.test', password: 'SecurePass123', role: 'Admin' });
  assert.equal(admin.role, 'Admin');
  assert.throws(
    () => auth.provisionUser({ name: 'Not Admin', email: 'x@example.test', password: 'SecurePass123', role: 'Organizer' }),
    /Trusted provisioning/
  );
});
