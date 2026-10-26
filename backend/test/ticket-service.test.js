import assert from 'node:assert/strict';
import test from 'node:test';
import { Database } from '../src/db/database.js';
import { EventService } from '../src/services/events.js';
import { RegistrationService } from '../src/services/registrations.js';
import { TicketService } from '../src/services/tickets.js';
import { AuthService } from '../src/services/auth.js';

test('TicketService: validates ticket and performs check-in only once', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const auth = new AuthService(db, { cost: 4 });
  const events = new EventService(db);
  const registrations = new RegistrationService(db);
  const tickets = new TicketService(db);

  const org = auth.register({ name: 'Organizer', email: 'org@test.com', password: 'Password123', role: 'Organizer' });
  const user = auth.register({ name: 'Attendee', email: 'att@test.com', password: 'Password123', role: 'Attendee' });

  const eventId = events.create(org.id, {
    title: 'Gala Night',
    description: 'Fun night',
    category: 'Other',
    startDateTime: '2026-12-31T20:00:00Z',
    endDateTime: '2026-12-31T23:00:00Z',
    venueType: 'Physical',
    venue: 'Hall A',
    capacity: 50,
    ticketTypes: [{ name: 'Standard', price: 0, quantity: 50 }]
  });

  const reg = registrations.register(eventId, user.id);
  assert.equal(reg.result, 'confirmed');
  assert.ok(reg.ticketCode);

  const ticketInfo = tickets.getByCode(reg.ticketCode);
  assert.ok(ticketInfo);
  assert.equal(ticketInfo.checked_in, 0);
  assert.equal(ticketInfo.event_title, 'Gala Night');
  assert.equal(ticketInfo.attendee_name, 'Attendee');

  // Perform check-in
  const checkInSuccess = tickets.checkIn(reg.ticketCode);
  assert.ok(checkInSuccess);

  // Second check-in must fail (already checked in)
  const repeatCheckIn = tickets.checkIn(reg.ticketCode);
  assert.equal(repeatCheckIn, null);

  const updatedTicket = tickets.getByCode(reg.ticketCode);
  assert.ok(updatedTicket);
  assert.equal(updatedTicket.checked_in, 1);
  assert.ok(updatedTicket.checked_in_at > 0);
});
