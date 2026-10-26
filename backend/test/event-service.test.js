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
  assert.equal(cancelResult, 'cancelled');

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
