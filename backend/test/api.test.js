import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Database } from '../src/db/database.js';

const FIXED_NOW = 1_800_000_000;
const VALID_PASSWORD = 'SecurePass123';
const VALID_EVENT = {
  title: 'Future Workshop',
  description: 'A practical workshop.',
  category: 'Workshop',
  date: '2099-11-20T10:00',
  venue: 'Hall A',
  capacity: 1,
  price: 15.5
};

function setup() {
  const db = new Database(':memory:');
  const app = createApp({ db, clock: () => FIXED_NOW, passwordIterations: 1_000 });
  return { app, db };
}

async function createUser(app, { name = 'Test User', role = 'Attendee', email = `${role.toLowerCase()}@example.test` } = {}) {
  const registration = await request(app).post('/api/auth/register').send({
    name,
    email,
    phone: '9876543210',
    password: VALID_PASSWORD,
    role
  });
  assert.equal(registration.status, 201, registration.text);
  assert.equal(registration.body.user.role, 'Attendee');

  const login = await request(app).post('/api/auth/login').send({ email, password: VALID_PASSWORD });
  assert.equal(login.status, 200, login.text);
  return { token: login.body.token, user: registration.body.user };
}

async function createEvent(app, token, overrides = {}) {
  const response = await request(app)
    .post('/api/events')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...VALID_EVENT, ...overrides });
  return response;
}

test('health routes return the existing response shape', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  for (const path of ['/health', '/api/health']) {
    const response = await request(app).get(path);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      status: 'ok',
      app: 'Event Management and Registration System (EMRS)',
      version: '1.0.0'
    });
  }
});

test('registration validates fields and always provisions an attendee', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());

  const invalid = await request(app).post('/api/auth/register').send({
    name: '',
    email: 'bad',
    phone: '   ',
    password: 'weak',
    role: 'Root'
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(Object.keys(invalid.body.fields).sort(), ['email', 'name', 'password', 'phone', 'role']);

  for (const requestedRole of ['Attendee', 'Organizer', 'Admin']) {
    const response = await request(app).post('/api/auth/register').send({
      name: 'Example Person',
      email: `${requestedRole.toLowerCase()}@example.test`,
      password: VALID_PASSWORD,
      role: requestedRole
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.user.role, 'Attendee');
    assert.equal(response.body.user.phone, '');
    assert.equal(response.text.includes('password_hash'), false);
  }

  const duplicate = await request(app).post('/api/auth/register').send({
    name: 'Example Person',
    email: 'admin@example.test',
    password: VALID_PASSWORD
  });
  assert.equal(duplicate.status, 409);
});

test('registration rejects malformed bodies and login handles invalid credentials and lockout', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const malformed = await request(app).post('/api/auth/register').set('Content-Type', 'application/json').send('{bad');
  assert.equal(malformed.status, 400);
  assert.deepEqual(malformed.body, { error: 'Malformed JSON' });

  await createUser(app, { email: 'login@example.test' });
  const wrong = await request(app).post('/api/auth/login').send({
    email: 'login@example.test',
    password: 'WrongPass123'
  });
  assert.equal(wrong.status, 401);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await request(app).post('/api/auth/login').send({
      email: 'login@example.test',
      password: 'WrongPass123'
    })).status, 401);
  }
  const fifthFailure = await request(app).post('/api/auth/login').send({
    email: 'login@example.test',
    password: 'WrongPass123'
  });
  assert.equal(fifthFailure.status, 429);
  const locked = await request(app).post('/api/auth/login').send({
    email: 'login@example.test',
    password: VALID_PASSWORD
  });
  assert.equal(locked.status, 429);
  assert.match(locked.body.error, /temporarily locked/);
});

test('login returns a database-backed bearer session, me authenticates, and logout revokes it', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const credentials = await createUser(app, { name: 'Sample User', email: 'sample@example.test' });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${credentials.token}`);
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.user, {
    id: credentials.user.id,
    name: 'Sample User',
    email: 'sample@example.test',
    phone: '9876543210',
    role: 'Attendee'
  });

  assert.equal((await request(app).get('/api/auth/me')).status, 401);
  assert.equal((await request(app).post('/api/auth/logout').set('Authorization', 'Bearer invalid')).status, 400);
  const logout = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${credentials.token}`);
  assert.equal(logout.status, 200);
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${credentials.token}`)).status, 401);
});

test('event creation enforces authorization and validation; public list supports filters and detail lookup', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  assert.equal((await request(app).post('/api/events').send(VALID_EVENT)).status, 401);

  const attendee = await createUser(app, { email: 'attendee@example.test' });
  const forbidden = await createEvent(app, attendee.token);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error, 'Only organizers can create events.');

  const organizer = await createUser(app, { email: 'organizer@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const created = await createEvent(app, organizer.token);
  assert.equal(created.status, 201, created.text);
  assert.equal(typeof created.body.eventId, 'number');

  const invalid = await createEvent(app, organizer.token, {
    title: '',
    description: '',
    category: '',
    date: '2020-01-01T10:00',
    venue: '',
    capacity: 0,
    price: -1
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(Object.keys(invalid.body.fields).sort(), [
    'capacity',
    'category',
    'date',
    'description',
    'price',
    'title',
    'venue'
  ]);

  const filtered = await request(app).get('/api/events?category=Workshop&search=Future');
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.events.length, 1);
  assert.equal(filtered.body.events[0].organizerId, organizer.user.id);
  assert.equal((await request(app).get(`/api/events/${created.body.eventId}`)).body.event.title, 'Future Workshop');
  assert.equal((await request(app).get('/api/events/mine').set('Authorization', `Bearer ${organizer.token}`)).body.events.length, 1);
  assert.equal((await request(app).get('/api/events/99999')).status, 404);
});

test('registration confirms up to capacity, then waitlists and rejects duplicates', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'events@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const event = await createEvent(app, organizer.token);
  const attendeeOne = await createUser(app, { email: 'one@example.test' });
  const attendeeTwo = await createUser(app, { email: 'two@example.test' });

  const confirmed = await request(app)
    .post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${attendeeOne.token}`);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.status, 'confirmed');
  assert.match(confirmed.body.ticketCode, /^EMRS-[0-9a-f]{8}$/);

  const duplicate = await request(app)
    .post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${attendeeOne.token}`);
  assert.equal(duplicate.status, 409);

  const waitlisted = await request(app)
    .post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${attendeeTwo.token}`);
  assert.equal(waitlisted.status, 200);
  assert.equal(waitlisted.body.status, 'waitlist');
  assert.equal('ticketCode' in waitlisted.body, false);

  const myRegistrations = await request(app)
    .get('/api/registrations/my')
    .set('Authorization', `Bearer ${attendeeTwo.token}`);
  assert.equal(myRegistrations.body.registrations[0].status, 'waitlist');
  assert.equal(myRegistrations.body.registrations[0].ticketCode, '');
});

test('registration cancellation promotes the earliest waitlisted attendee and permits re-registration', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'capacity@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const event = await createEvent(app, organizer.token);
  const first = await createUser(app, { email: 'first@example.test' });
  const second = await createUser(app, { email: 'second@example.test' });

  const firstReg = await request(app).post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${first.token}`);
  const secondReg = await request(app).post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${second.token}`);
  const cancel = await request(app).delete(`/api/registrations/${firstReg.body.registrationId}`)
    .set('Authorization', `Bearer ${first.token}`);
  assert.equal(cancel.status, 200);

  const promoted = await request(app).get('/api/registrations/my')
    .set('Authorization', `Bearer ${second.token}`);
  assert.equal(promoted.body.registrations[0].status, 'confirmed');
  assert.match(promoted.body.registrations[0].ticketCode, /^EMRS-[0-9a-f]{8}$/);

  const retry = await request(app).post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${first.token}`);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, 'waitlist');
  assert.equal((await request(app).delete(`/api/registrations/${secondReg.body.registrationId}`)
    .set('Authorization', `Bearer ${first.token}`)).status, 404);
});

test('event cancellation is owner-scoped, hides the event, and prevents registration', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'owner@example.test' });
  const other = await createUser(app, { email: 'other@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', other.user.id]);
  const event = await createEvent(app, organizer.token);

  assert.equal((await request(app).delete(`/api/events/${event.body.eventId}`)
    .set('Authorization', `Bearer ${other.token}`)).status, 403);
  assert.equal((await request(app).delete(`/api/events/${event.body.eventId}`)
    .set('Authorization', `Bearer ${organizer.token}`)).status, 200);
  assert.equal((await request(app).get('/api/events')).body.events.length, 0);

  const attendee = await createUser(app, { email: 'aftercancel@example.test' });
  assert.equal((await request(app).post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${attendee.token}`)).status, 400);
});

test('check-in validates ticket codes, allows organizer access, and rejects repeat admission', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'checkin-organizer@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const event = await createEvent(app, organizer.token);
  const attendee = await createUser(app, { email: 'ticket-holder@example.test' });
  const registration = await request(app).post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${attendee.token}`);

  assert.equal((await request(app).post('/api/tickets/checkin').send({ ticketCode: 'invalid' })).status, 401);
  assert.equal((await request(app).post('/api/tickets/checkin')
    .set('Authorization', `Bearer ${attendee.token}`)
    .send({ ticketCode: registration.body.ticketCode })).status, 403);

  const checkedIn = await request(app).post('/api/tickets/checkin')
    .set('Authorization', `Bearer ${organizer.token}`)
    .send({ ticketCode: registration.body.ticketCode.toUpperCase() });
  assert.equal(checkedIn.status, 200);
  assert.equal(checkedIn.body.attendeeName, 'Test User');
  assert.equal(checkedIn.body.eventTitle, 'Future Workshop');

  assert.equal((await request(app).post('/api/tickets/checkin')
    .set('Authorization', `Bearer ${organizer.token}`)
    .send({ ticketCode: registration.body.ticketCode })).status, 409);
  const ticket = await request(app).get(`/api/tickets/${registration.body.ticketCode}`)
    .set('Authorization', `Bearer ${organizer.token}`);
  assert.equal(ticket.status, 200);
  assert.equal(ticket.body.checkedIn, true);
});
