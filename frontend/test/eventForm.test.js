import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEventPayload,
  canManageEvent,
  eventToFormValues,
  fieldMessage,
  hasStarted,
  isCancelled,
  unmappedMessages
} from '../src/eventForm.js';

const NOW = Date.parse('2026-11-01T09:00');
const organizer = { id: 7, role: 'Organizer' };
const upcoming = {
  id: 1,
  organizerId: 7,
  title: 'Design Workshop',
  description: 'Hands-on session',
  category: 'Workshop',
  status: 'Upcoming',
  startDateTime: '2026-11-20T10:00',
  endDateTime: '2026-11-20T12:30',
  venueType: 'Physical',
  venue: 'Auditorium Hall A',
  meetingLink: '',
  capacity: 40,
  currency: 'INR',
  tags: ['design', 'community'],
  ticketTypes: [{ name: 'Standard', price: 150, quantity: 40 }]
};

test('Edit and Cancel are shown to the owning organizer for an upcoming event', () => {
  assert.equal(canManageEvent(upcoming, organizer, NOW), true);
  assert.equal(canManageEvent({ ...upcoming, status: 'active' }, organizer, NOW), true);
});

test('Edit and Cancel are hidden from attendees, logged-out users and other organizers', () => {
  assert.equal(canManageEvent(upcoming, null, NOW), false);
  assert.equal(canManageEvent(upcoming, { id: 7, role: 'Attendee' }, NOW), false);
  assert.equal(canManageEvent(upcoming, { id: 8, role: 'Organizer' }, NOW), false);
  assert.equal(canManageEvent(upcoming, { id: 99, role: 'Admin' }, NOW), true);
});

test('Edit and Cancel are hidden for cancelled and already-started events', () => {
  assert.equal(canManageEvent({ ...upcoming, status: 'cancelled' }, organizer, NOW), false);
  assert.equal(canManageEvent({ ...upcoming, status: 'Cancelled' }, organizer, NOW), false);
  assert.equal(canManageEvent({ ...upcoming, startDateTime: '2026-10-31T10:00' }, organizer, NOW), false);
  assert.equal(hasStarted({ startDateTime: '2026-11-01T09:00' }, NOW), true);
  assert.equal(hasStarted({ startDateTime: '2026-11-01T09:01' }, NOW), false);
  assert.equal(isCancelled({ status: 'cancelled' }), true);
  assert.equal(isCancelled(upcoming), false);
});

test('the edit form is pre-filled from the event', () => {
  assert.deepEqual(eventToFormValues(upcoming), {
    title: 'Design Workshop',
    description: 'Hands-on session',
    category: 'Workshop',
    venueType: 'Physical',
    startDateTime: '2026-11-20T10:00',
    endDateTime: '2026-11-20T12:30',
    address: 'Auditorium Hall A',
    meetingLink: '',
    capacity: 40,
    ticketName: 'Standard',
    ticketPrice: 150,
    currency: 'INR',
    tags: 'design, community'
  });
});

test('pre-fill trims seconds and zone, and keeps a virtual event link', () => {
  const values = eventToFormValues({
    ...upcoming,
    venueType: 'Virtual',
    venue: '',
    meetingLink: 'https://meet.example.com/abc',
    startDateTime: '2026-11-20T10:00:00Z'
  });
  assert.equal(values.venueType, 'Virtual');
  assert.equal(values.startDateTime, '2026-11-20T10:00');
  assert.equal(values.address, '');
  assert.equal(values.meetingLink, 'https://meet.example.com/abc');
});

test('the payload matches the create-event body and drops the field for the other venue type', () => {
  const values = {
    ...eventToFormValues(upcoming),
    ticketPrice: '200',
    capacity: '60',
    tags: ' a, ,b '
  };
  const payload = buildEventPayload(values, 'Physical', upcoming);
  assert.equal(payload.capacity, 60);
  assert.deepEqual(payload.tags, ['a', 'b']);
  assert.deepEqual(payload.ticketTypes, [{ name: 'Standard', price: 200 }]);
  assert.equal(payload.address, 'Auditorium Hall A');
  assert.equal(payload.meetingLink, '');

  const virtual = buildEventPayload({ ...values, meetingLink: 'https://x.example.com' }, 'Virtual', upcoming);
  assert.equal(virtual.address, '');
  assert.equal(virtual.meetingLink, 'https://x.example.com');
});

test('extra ticket types are sent back unchanged when editing', () => {
  const existing = {
    ...upcoming,
    ticketTypes: [
      { name: 'Standard', price: 150, quantity: 20 },
      { name: 'VIP', price: 500, quantity: 10 }
    ]
  };
  const payload = buildEventPayload({ ...eventToFormValues(existing), ticketName: 'Regular' }, 'Physical', existing);
  assert.deepEqual(payload.ticketTypes, [
    { name: 'Regular', price: 150, quantity: 20 },
    { name: 'VIP', price: 500, quantity: 10 }
  ]);
});

test('API field errors map to the matching inputs', () => {
  const errors = {
    title: 'Title must be 3-100 characters.',
    venue: 'Physical venue/address must be 3-200 characters.',
    'ticketTypes.0.price': 'Ticket price must be a non-negative number.',
    ticketTypes: 'Total ticket quantities cannot exceed event capacity.',
    'tags.1': 'Each tag must be a string of at most 30 characters.',
    'ticketTypes.1.name': 'Ticket name must be 1-50 characters.'
  };
  assert.equal(fieldMessage(errors, 'title'), errors.title);
  assert.equal(fieldMessage(errors, 'address'), errors.venue);
  assert.equal(fieldMessage(errors, 'ticketPrice'), errors['ticketTypes.0.price']);
  assert.equal(fieldMessage(errors, 'ticketName'), errors.ticketTypes);
  assert.equal(fieldMessage(errors, 'tags'), errors['tags.1']);
  assert.equal(fieldMessage(errors, 'capacity'), '');
  assert.deepEqual(unmappedMessages(errors), ['Ticket name must be 1-50 characters.']);
});
