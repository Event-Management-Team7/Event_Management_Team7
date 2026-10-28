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

test('RegistrationService: prevents registration on cancelled or started events (EMRS-F-010)', (t) => {
  let currentTime = 1000;
  const db = new Database(':memory:');
  t.after(() => db.close());
  const auth = new AuthService(db, { cost: 4 });
  const events = new EventService(db, () => currentTime);
  const registrations = new RegistrationService(db, () => currentTime);

  const org = auth.register({ name: 'Organizer', email: 'org@test.com', password: 'Password123', role: 'Organizer' });
  const user = auth.register({ name: 'Attendee', email: 'user@test.com', password: 'Password123', role: 'Attendee' });

  // Event in the future
  const eventId = events.create(org.id, {
    title: 'Future Workshop',
    description: 'Future event',
    category: 'Workshop',
    startDateTime: '2026-12-01T10:00:00Z',
    endDateTime: '2026-12-01T12:00:00Z',
    venueType: 'Physical',
    venue: 'Room 101',
    capacity: 10,
    ticketTypes: [{ name: 'Free', price: 0, quantity: 10 }]
  });

  // Cancel the event
  events.cancel(eventId, { id: org.id, role: 'Organizer' });

  // Registration on cancelled event returns event-cancelled
  const regCancelled = registrations.register(eventId, user.id);
  assert.equal(regCancelled.result, 'event-cancelled');

  // Event that has already started
  const pastEventId = events.create(org.id, {
    title: 'Started Workshop',
    description: 'Already started event',
    category: 'Workshop',
    startDateTime: '2026-01-01T10:00:00Z',
    endDateTime: '2026-01-01T12:00:00Z',
    venueType: 'Physical',
    venue: 'Room 102',
    capacity: 10,
    ticketTypes: [{ name: 'Free', price: 0, quantity: 10 }]
  });

  // Clock is now past 2026-01-01T10:00:00Z
  currentTime = Math.floor(new Date('2026-01-01T11:00:00Z').getTime() / 1000);
  const regStarted = registrations.register(pastEventId, user.id);
  assert.equal(regStarted.result, 'event-started');
});

test('RegistrationService: prevents cancellation after event has started and enforces ownership (EMRS-F-011)', (t) => {
  let currentTime = Math.floor(new Date('2026-11-01T08:00:00Z').getTime() / 1000);
  const db = new Database(':memory:');
  t.after(() => db.close());
  const auth = new AuthService(db, { cost: 4 });
  const events = new EventService(db, () => currentTime);
  const registrations = new RegistrationService(db, () => currentTime);

  const org = auth.register({ name: 'Organizer', email: 'org@test.com', password: 'Password123', role: 'Organizer' });
  const u1 = auth.register({ name: 'User 1', email: 'u1@test.com', password: 'Password123', role: 'Attendee' });
  const u2 = auth.register({ name: 'User 2', email: 'u2@test.com', password: 'Password123', role: 'Attendee' });

  const eventId = events.create(org.id, {
    title: 'Upcoming Conference',
    description: 'Conference description',
    category: 'Conference',
    startDateTime: '2026-11-01T10:00:00Z',
    endDateTime: '2026-11-01T18:00:00Z',
    venueType: 'Physical',
    venue: 'Main Hall',
    capacity: 5,
    ticketTypes: [{ name: 'Standard', price: 0, quantity: 5 }]
  });

  const reg = registrations.register(eventId, u1.id);
  assert.equal(reg.result, 'confirmed');

  // u2 cannot cancel u1's registration
  const otherCancel = registrations.cancel(reg.registrationId, u2.id);
  assert.equal(otherCancel, false);

  // Time advances past event start
  currentTime = Math.floor(new Date('2026-11-01T11:00:00Z').getTime() / 1000);

  // u1 cannot cancel once event has started
  const lateCancel = registrations.cancel(reg.registrationId, u1.id);
  assert.equal(lateCancel, 'event-started');
});

test('RegistrationService: two cancellations promote exactly two distinct waitlisted attendees (EMRS-F-012)', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const auth = new AuthService(db, { cost: 4 });
  const events = new EventService(db);
  const registrations = new RegistrationService(db);

  const org = auth.register({ name: 'Organizer', email: 'org@test.com', password: 'Password123', role: 'Organizer' });
  const u1 = auth.register({ name: 'User 1', email: 'u1@test.com', password: 'Password123', role: 'Attendee' });
  const u2 = auth.register({ name: 'User 2', email: 'u2@test.com', password: 'Password123', role: 'Attendee' });
  const w1 = auth.register({ name: 'Waitlist 1', email: 'w1@test.com', password: 'Password123', role: 'Attendee' });
  const w2 = auth.register({ name: 'Waitlist 2', email: 'w2@test.com', password: 'Password123', role: 'Attendee' });

  // Capacity 2
  const eventId = events.create(org.id, {
    title: 'Capacity 2 Event',
    description: 'Desc',
    category: 'Meetup',
    startDateTime: '2026-12-10T10:00:00Z',
    endDateTime: '2026-12-10T12:00:00Z',
    venueType: 'Physical',
    venue: 'Room A',
    capacity: 2,
    ticketTypes: [{ name: 'Free', price: 0, quantity: 2 }]
  });

  const r1 = registrations.register(eventId, u1.id);
  const r2 = registrations.register(eventId, u2.id);
  assert.equal(r1.result, 'confirmed');
  assert.equal(r2.result, 'confirmed');

  const rw1 = registrations.register(eventId, w1.id);
  const rw2 = registrations.register(eventId, w2.id);
  assert.equal(rw1.result, 'waitlist');
  assert.equal(rw2.result, 'waitlist');

  // Both confirmed users cancel
  assert.equal(registrations.cancel(r1.registrationId, u1.id), true);
  assert.equal(registrations.cancel(r2.registrationId, u2.id), true);

  // Both waitlisted attendees must be promoted without duplicate assignment
  const listW1 = registrations.listUser(w1.id);
  const listW2 = registrations.listUser(w2.id);

  assert.equal(listW1[0].status, 'confirmed');
  assert.equal(listW2[0].status, 'confirmed');
  assert.ok(listW1[0].ticketCode);
  assert.ok(listW2[0].ticketCode);
  assert.notEqual(listW1[0].ticketCode, listW2[0].ticketCode);
});

test('RegistrationService: capacity is never exceeded under multiple registrations (EMRS-F-010)', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const auth = new AuthService(db, { cost: 4 });
  const events = new EventService(db);
  const registrations = new RegistrationService(db);

  const org = auth.register({ name: 'Organizer', email: 'org@test.com', password: 'Password123', role: 'Organizer' });

  const capacity = 3;
  const eventId = events.create(org.id, {
    title: 'Strict Capacity Event',
    description: 'Capacity test',
    category: 'Workshop',
    startDateTime: '2026-12-20T10:00:00Z',
    endDateTime: '2026-12-20T12:00:00Z',
    venueType: 'Physical',
    venue: 'Lab 2',
    capacity,
    ticketTypes: [{ name: 'Standard', price: 0, quantity: capacity }]
  });

  const users = [];
  for (let i = 0; i < 10; i++) {
    users.push(auth.register({
      name: `User ${i}`,
      email: `stress${i}@test.com`,
      password: 'Password123',
      role: 'Attendee'
    }));
  }

  const results = users.map((u) => registrations.register(eventId, u.id));
  const confirmedCount = results.filter((r) => r.result === 'confirmed').length;
  const waitlistCount = results.filter((r) => r.result === 'waitlist').length;

  assert.equal(confirmedCount, capacity);
  assert.equal(waitlistCount, users.length - capacity);
});
