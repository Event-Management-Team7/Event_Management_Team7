import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';
import { AuthService } from '../src/services/auth.js';
import { Database } from '../src/db/database.js';

test('password hashes use the C++ PBKDF2 format and verify in constant-time comparison path', () => {
  const first = hashPassword('SecurePass123', 1_000);
  const second = hashPassword('SecurePass123', 1_000);
  assert.match(first, /^pbkdf2\$1000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  assert.equal(verifyPassword('SecurePass123', first), true);
  assert.equal(verifyPassword('IncorrectPass123', first), false);
  assert.equal(verifyPassword('SecurePass123', 'pbkdf2$invalid$salt$hash'), false);
});

test('elevated roles can be provisioned through the trusted service but not public registration', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const auth = new AuthService(db, { iterations: 1_000, clock: () => 100 });
  const publicUser = auth.register({
    name: 'Public Organizer',
    email: 'public@example.test',
    password: 'SecurePass123',
    role: 'Admin'
  });
  assert.equal(publicUser.role, 'Attendee');

  const organizer = auth.provisionUser({
    name: 'Trusted Organizer',
    email: 'trusted@example.test',
    password: 'SecurePass123',
    role: 'Organizer'
  });
  assert.equal(organizer.role, 'Organizer');
  assert.throws(
    () => auth.provisionUser({ name: 'No Role', email: 'no-role@example.test', password: 'SecurePass123', role: 'Attendee' }),
    /Trusted provisioning/
  );
});
