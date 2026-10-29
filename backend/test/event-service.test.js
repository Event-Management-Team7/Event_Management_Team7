import assert from 'node:assert/strict';
import test from 'node:test';
import { Database } from '../src/db/database.js';
import { EventService } from '../src/services/events.js';
import { AuthService } from '../src/services/auth.js';

test('EventService: creates, lists, filters, and cancels events', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const auth = new AuthService(db, { cost: 4 });
  const events = new EventService(db);

  const org = auth.register({
    name: 'Dhanraj Rathod',
    email: 'dhanraj@example.com',
    password: 'SecurePassword123',
    role: 'Organizer'
  });

  const eventId = events.create(org.id, {
    title: 'Tech Symposium 2026',
    description: 'Annual technical fest',
    category: 'Conference',
    startDateTime: '2026-11-20T10:00:00Z',
    endDateTime: '2026-11-20T18:00:00Z',
    venueType: 'Physical',
    venue: 'Main Auditorium',
    capacity: 100,
    ticketTypes: [{ name: 'Standard', price: 0, quantity: 100 }]
  });

  assert.ok(eventId > 0);

  // List with category and search filter
  const list = events.list({ category: 'Conference', search: 'Tech' });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, eventId);
  assert.equal(list[0].title, 'Tech Symposium 2026');
  assert.equal(list[0].capacity, 100);

  // Get by ID
  const fetched = events.get(eventId);
  assert.ok(fetched);
  assert.equal(fetched.venue, 'Main Auditorium');
  assert.equal(fetched.organizerId, org.id);

  // Cancel event by owner
  const cancelResult = events.cancel(eventId, { id: org.id, role: org.role });
  assert.equal(cancelResult.result, 'cancelled');
  assert.equal(cancelResult.eventTitle, 'Tech Symposium 2026');
  assert.equal(cancelResult.eventDate, '2026-11-20');
  assert.deepEqual(cancelResult.attendees, []);
  assert.equal(events.cancel(eventId, { id: org.id, role: org.role }).result, 'already-cancelled');

  // List should now exclude cancelled event
  const activeList = events.list();
  assert.equal(activeList.length, 0);
});

test('EventService: organizer authorization and access control', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const auth = new AuthService(db, { cost: 4 });
  const events = new EventService(db);

  const org1 = auth.register({ name: 'Organizer 1', email: 'org1@example.com', password: 'Password123', role: 'Organizer' });
  const org2 = auth.register({ name: 'Organizer 2', email: 'org2@example.com', password: 'Password123', role: 'Organizer' });

  const eventId = events.create(org1.id, {
    title: 'AI Workshop',
    description: 'Deep learning hands-on',
    category: 'Workshop',
    startDateTime: '2099-10-15T09:00:00Z',
    endDateTime: '2099-10-15T17:00:00Z',
    venueType: 'Physical',
    venue: 'Lab 3',
    capacity: 50,
    ticketTypes: [{ name: 'General', price: 10.0, quantity: 50 }]
  });

  // Verify organizer-specific list
  const org1Events = events.listOrganizer(org1.id);
  assert.equal(org1Events.length, 1);
  assert.equal(org1Events[0].id, eventId);

  const org2Events = events.listOrganizer(org2.id);
  assert.equal(org2Events.length, 0);

  // Unauthorized organizer cannot cancel event
  const forbiddenResult = events.cancel(eventId, { id: org2.id, role: org2.role });
  assert.equal(forbiddenResult, 'forbidden');

  // Event remains active
  assert.equal(events.get(eventId).status, 'Upcoming');

  // Nonexistent event returns null or not-found
  assert.equal(events.get(99999), null);
  assert.equal(events.cancel(99999, { id: org1.id, role: org1.role }), 'not-found');
});

test('EventService: rolls back the event update when audit insertion fails', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const auth = new AuthService(db, { cost: 4 });
  const events = new EventService(db);
  const organizer = auth.register({
    name: 'Rollback Organizer',
    email: 'rollback@example.test',
    password: 'SecurePassword123',
    role: 'Organizer'
  });
  const eventId = events.create(organizer.id, {
    title: 'Original Workshop',
    description: 'A practical workshop.',
    category: 'Workshop',
    startDateTime: '2099-11-20T10:00',
    endDateTime: '2099-11-20T12:00',
    venueType: 'Physical',
    venue: 'Hall A',
    capacity: 10,
    ticketTypes: [{ name: 'General Admission', price: 15.5, quantity: 10 }]
  });
  const run = db.run.bind(db);
  let auditInserts = 0;
  db.run = (sql, params) => {
    if (sql.startsWith('INSERT INTO audit_logs')) {
      auditInserts += 1;
      if (auditInserts === 2) throw new Error('Injected audit insert failure');
    }
    return run(sql, params);
  };

  assert.throws(() => events.update(eventId, organizer, {
    title: 'Changed Workshop',
    description: 'A practical workshop.',
    category: 'Workshop',
    startDateTime: '2099-11-20T10:00',
    endDateTime: '2099-11-20T12:00',
    venueType: 'Physical',
    venue: 'Hall B',
    capacity: 10,
    ticketTypes: [{ name: 'General Admission', price: 15.5, quantity: 10 }]
  }), /Injected audit insert failure/);

  db.run = run;
  assert.equal(events.get(eventId).title, 'Original Workshop');
  assert.equal(events.get(eventId).venue, 'Hall A');
  assert.equal(db.get('SELECT COUNT(*) AS count FROM audit_logs').count, 0);
});

test('EventService: rejects cancellation after the event starts without changing state', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const auth = new AuthService(db, { cost: 4 });
  const events = new EventService(db, () => 1_800_000_000);
  const organizer = auth.register({
    name: 'Started Event Organizer',
    email: 'started-organizer@example.test',
    password: 'Password123',
    role: 'Organizer'
  });
  const eventId = events.create(organizer.id, {
    title: 'Started Workshop',
    description: 'Already underway',
    category: 'Workshop',
    startDateTime: '2020-01-01T10:00:00Z',
    endDateTime: '2020-01-01T12:00:00Z',
    venueType: 'Physical',
    venue: 'Hall A',
    capacity: 5,
    ticketTypes: [{ name: 'General', price: 0 }]
  });
  assert.equal(events.cancel(eventId, { id: organizer.id, role: 'Organizer' }).result, 'event-started');
  assert.equal(db.get('SELECT status FROM events WHERE id = ?', [eventId]).status, 'Upcoming');
  assert.equal(db.get('SELECT COUNT(*) AS count FROM audit_logs').count, 0);
});

function seedFilterEvents(db) {
  const auth = new AuthService(db, { cost: 4 });
  const events = new EventService(db);
  const organizer = auth.register({
    name: 'Filter Organizer',
    email: 'filters@example.com',
    password: 'SecurePassword123',
    role: 'Organizer'
  });
  const make = (title, day, venue, category = 'Workshop') => events.create(organizer.id, {
    title,
    description: 'Filter fixture',
    category,
    startDateTime: `2026-11-${day}T10:00:00Z`,
    endDateTime: `2026-11-${day}T12:00:00Z`,
    venueType: 'Physical',
    venue,
    capacity: 50,
    ticketTypes: [{ name: 'Standard', price: 0, quantity: 50 }]
  });
  const ids = {
    nov1: make('Early Event', '01', 'Auditorium Hall A', 'Conference'),
    nov10: make('Middle Event', '10', 'Auditorium Hall A'),
    nov20: make('Late Event', '20', 'City Park')
  };
  return { events, organizer, ids };
}

test('EventService: filters by date range with inclusive boundaries', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const { events, ids } = seedFilterEvents(db);

  assert.deepEqual(events.list({ from: '2026-11-05', to: '2026-11-15' }).map((e) => e.id), [ids.nov10]);
  assert.deepEqual(events.list({ from: '2026-11-10', to: '2026-11-10' }).map((e) => e.id), [ids.nov10]);
  assert.deepEqual(events.list({ from: '2026-11-01', to: '2026-11-20' }).map((e) => e.id), [ids.nov1, ids.nov10, ids.nov20]);
  assert.deepEqual(events.list({ from: '2026-11-10' }).map((e) => e.id), [ids.nov10, ids.nov20]);
  assert.deepEqual(events.list({ to: '2026-11-10' }).map((e) => e.id), [ids.nov1, ids.nov10]);
  assert.deepEqual(events.list({ from: '2027-01-01' }), []);
});

test('EventService: filters by location case-insensitively and treats wildcards literally', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const { events, ids } = seedFilterEvents(db);

  assert.deepEqual(events.list({ location: 'hall a' }).map((e) => e.id), [ids.nov1, ids.nov10]);
  assert.deepEqual(events.list({ location: 'CITY' }).map((e) => e.id), [ids.nov20]);
  assert.deepEqual(events.list({ location: 'Nowhere' }), []);
  assert.deepEqual(events.list({ location: '%' }), [], 'a % in the input must not match everything');
  assert.deepEqual(events.list({ location: '_' }), [], 'a _ in the input must not match any character');
});

test('EventService: date, location, category and search filters combine with AND', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const { events, ids } = seedFilterEvents(db);

  assert.deepEqual(
    events.list({ from: '2026-11-05', to: '2026-11-30', location: 'hall a' }).map((e) => e.id),
    [ids.nov10]
  );
  assert.deepEqual(events.list({ location: 'hall a', category: 'Conference' }).map((e) => e.id), [ids.nov1]);
  assert.deepEqual(events.list({ location: 'hall a', search: 'Middle', from: '2026-11-01' }).map((e) => e.id), [ids.nov10]);
  assert.deepEqual(events.list({ location: 'city park', to: '2026-11-15' }), []);
});

test('EventService: cancelled events are never returned by any filter', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const { events, organizer, ids } = seedFilterEvents(db);

  events.cancel(ids.nov10, { id: organizer.id, role: organizer.role });
  assert.deepEqual(events.list({ from: '2026-11-05', to: '2026-11-15' }), []);
  assert.deepEqual(events.list({ location: 'hall a' }).map((e) => e.id), [ids.nov1]);
});
