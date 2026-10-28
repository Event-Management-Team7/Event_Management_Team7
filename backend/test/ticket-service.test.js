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
  assert.equal(updatedTicket.organizer_id, org.id);
  assert.equal(updatedTicket.registration_status, 'confirmed');
});

test('TicketService: rejects check-in for cancelled registration, cancelled event, or unknown code (EMRS-F-016)', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const auth = new AuthService(db, { cost: 4 });
  const events = new EventService(db);
  const registrations = new RegistrationService(db);
  const tickets = new TicketService(db);

  const org = auth.register({ name: 'Organizer', email: 'org@test.com', password: 'Password123', role: 'Organizer' });
  const u1 = auth.register({ name: 'Attendee 1', email: 'att1@test.com', password: 'Password123', role: 'Attendee' });
  const u2 = auth.register({ name: 'Attendee 2', email: 'att2@test.com', password: 'Password123', role: 'Attendee' });

  const eventId = events.create(org.id, {
    title: 'Festival',
    description: 'Festival desc',
    category: 'Festival',
    startDateTime: '2026-12-25T18:00:00Z',
    endDateTime: '2026-12-25T23:00:00Z',
    venueType: 'Physical',
    venue: 'Grounds',
    capacity: 10,
    ticketTypes: [{ name: 'Standard', price: 0, quantity: 10 }]
  });

  const reg1 = registrations.register(eventId, u1.id);
  const reg2 = registrations.register(eventId, u2.id);

  // User 1 cancels registration -> ticket is cancelled
  registrations.cancel(reg1.registrationId, u1.id);

  const cancelledTicket = tickets.getByCode(reg1.ticketCode);
  assert.ok(cancelledTicket);
  assert.equal(cancelledTicket.registration_status, 'cancelled');

  // Check-in on cancelled ticket must return null (rejected)
  assert.equal(tickets.checkIn(reg1.ticketCode), null);

  // Check-in on unknown ticket code must return null
  assert.equal(tickets.checkIn('EMRS-nonexistent'), null);
  assert.equal(tickets.getByCode('EMRS-nonexistent'), null);

  // Organizer cancels the whole event
  events.cancel(eventId, { id: org.id, role: 'Organizer' });

  // Ticket for u2 cannot be checked in because event is cancelled
  assert.equal(tickets.checkIn(reg2.ticketCode), null);
});
