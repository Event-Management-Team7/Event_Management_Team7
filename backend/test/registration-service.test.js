import assert from 'node:assert/strict';
import test from 'node:test';
import { Database } from '../src/db/database.js';
import { EventService } from '../src/services/events.js';
import { RegistrationService } from '../src/services/registrations.js';
import { AuthService } from '../src/services/auth.js';

test('RegistrationService: confirms registration, manages waitlist, and promotes on cancellation', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const auth = new AuthService(db, { cost: 4 });
  const events = new EventService(db);
  const registrations = new RegistrationService(db);

  const org = auth.register({ name: 'Organizer', email: 'org@test.com', password: 'Password123', role: 'Organizer' });
  const u1 = auth.register({ name: 'User 1', email: 'u1@test.com', password: 'Password123', role: 'Attendee' });
  const u2 = auth.register({ name: 'User 2', email: 'u2@test.com', password: 'Password123', role: 'Attendee' });

  // Event with capacity of 1
  const eventId = events.create(org.id, {
    title: 'Limited Workshop',
    description: 'Only 1 seat',
    category: 'Workshop',
    startDateTime: '2026-12-01T10:00:00Z',
    endDateTime: '2026-12-01T12:00:00Z',
    venueType: 'Physical',
    venue: 'Lab 1',
    capacity: 1,
    ticketTypes: [{ name: 'Standard', price: 0, quantity: 1 }]
  });

  // User 1 registers -> Confirmed
  const r1 = registrations.register(eventId, u1.id);
  assert.equal(r1.result, 'confirmed');
  assert.ok(r1.ticketCode);

  // User 2 registers -> Waitlisted
  const r2 = registrations.register(eventId, u2.id);
  assert.equal(r2.result, 'waitlist');

  // Duplicate registration rejected
  const rDuplicate = registrations.register(eventId, u1.id);
  assert.equal(rDuplicate.result, 'already-registered');

  // User 1 cancels -> User 2 promoted from waitlist to confirmed!
  const cancelled = registrations.cancel(r1.registrationId, u1.id);
  assert.equal(cancelled, true);

  const user2Registrations = registrations.listUser(u2.id);
  assert.equal(user2Registrations.length, 1);
  assert.equal(user2Registrations[0].status, 'confirmed');
  assert.ok(user2Registrations[0].ticketCode);
});
