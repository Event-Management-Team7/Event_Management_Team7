import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Database } from '../src/db/database.js';

const FIXED_NOW = 1_800_000_000;
const VALID_PASSWORD = 'SecurePass123';
const JWT_SECRET = 'test-secret-for-unit-tests-only';
const VALID_EVENT = {
  title: 'Future Workshop',
  description: 'A practical workshop.',
  category: 'Workshop',
  startDateTime: '2099-11-20T10:00',
  endDateTime: '2099-11-20T12:00',
  venueType: 'Physical',
  address: 'Hall A',
  capacity: 1,
  ticketTypes: [{ name: 'General Admission', price: 15.5 }]
};

function setup() {
  const db = new Database(':memory:');
  const app = createApp({ db, clock: () => FIXED_NOW, passwordCost: 4, jwtSecret: JWT_SECRET });
  return { app, db };
}

// Like setup(), but the test can move time forward to exercise token expiry.
function setupWithClock() {
  const db = new Database(':memory:');
  const time = { now: FIXED_NOW };
  const app = createApp({ db, clock: () => time.now, passwordCost: 4, jwtSecret: JWT_SECRET });
  return { app, db, time };
}

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
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

const REGISTRATION = {
  name: 'Example Person',
  email: 'example@example.test',
  password: VALID_PASSWORD,
  role: 'Attendee'
};

test('AC1: registration creates an Attendee or Organizer account without exposing the password', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());

  for (const role of ['Attendee', 'Organizer']) {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ ...REGISTRATION, email: `${role.toLowerCase()}@example.test`, role });
    assert.equal(response.status, 201, response.text);
    assert.equal(response.body.user.role, role);
    assert.equal(response.body.user.name, 'Example Person');
    assert.equal(response.body.user.email, `${role.toLowerCase()}@example.test`);
    assert.ok(response.body.user.id);
    assert.equal(response.text.includes('password'), false);
    assert.equal(response.text.includes(VALID_PASSWORD), false);
  }
});

test('AC2: duplicate email is rejected case-insensitively with 409', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  assert.equal((await request(app).post('/api/auth/register').send({ ...REGISTRATION, email: 'a@x.com' })).status, 201);

  const duplicate = await request(app).post('/api/auth/register').send({ ...REGISTRATION, email: 'A@X.com' });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, 'Email already registered');
  assert.equal(db.get('SELECT COUNT(*) AS count FROM users').count, 1);
  assert.equal(db.get('SELECT email FROM users').email, 'a@x.com');
});

test('AC3: missing or blank fields return 400 naming every invalid field', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());

  const empty = await request(app).post('/api/auth/register').send({});
  assert.equal(empty.status, 400);
  assert.deepEqual(Object.keys(empty.body.fields).sort(), ['email', 'name', 'password', 'role']);

  const blank = await request(app)
    .post('/api/auth/register')
    .send({ name: '   ', email: '  ', password: '', role: ' ' });
  assert.equal(blank.status, 400);
  assert.deepEqual(Object.keys(blank.body.fields).sort(), ['email', 'name', 'password', 'role']);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM users').count, 0);
});

test('AC4: malformed email addresses are rejected', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  for (const email of ['abc', 'a@', 'a@b', '@x.com', `${'a'.repeat(250)}@x.com`]) {
    const response = await request(app).post('/api/auth/register').send({ ...REGISTRATION, email });
    assert.equal(response.status, 400, email);
    assert.ok(response.body.fields.email, email);
  }
  assert.equal(db.get('SELECT COUNT(*) AS count FROM users').count, 0);
});

test('AC5: passwords must be 8+ characters with an uppercase letter, a lowercase letter and a digit', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  for (const password of ['Short1a', 'alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHere']) {
    const response = await request(app).post('/api/auth/register').send({ ...REGISTRATION, password });
    assert.equal(response.status, 400, password);
    assert.match(response.body.fields.password, /uppercase letter, a lowercase letter, and a digit/);
  }
  assert.equal(db.get('SELECT COUNT(*) AS count FROM users').count, 0);
});

test('AC6: only Attendee and Organizer roles can self-register; Admin is rejected', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  for (const role of ['Admin', 'Root', 'attendee', '']) {
    const response = await request(app).post('/api/auth/register').send({ ...REGISTRATION, role });
    assert.equal(response.status, 400, role);
    assert.match(response.body.fields.role, /Attendee or Organizer/);
  }
  assert.equal(db.get('SELECT COUNT(*) AS count FROM users').count, 0);
});

test('AC7: the stored password is a salted bcrypt hash, never the plaintext', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  await request(app).post('/api/auth/register').send({ ...REGISTRATION, email: 'one@example.test' });
  await request(app).post('/api/auth/register').send({ ...REGISTRATION, email: 'two@example.test' });
  const [first, second] = db.all('SELECT password_hash FROM users ORDER BY id');
  assert.match(first.password_hash, /^\$2[aby]\$\d{2}\$/);
  assert.equal(first.password_hash.includes(VALID_PASSWORD), false);
  assert.notEqual(first.password_hash, second.password_hash);
});

test('AC8: verification is deferred; the account is usable immediately with email_verified = 0', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const registration = await request(app).post('/api/auth/register').send(REGISTRATION);
  assert.equal(registration.status, 201);
  assert.equal(db.get('SELECT email_verified FROM users').email_verified, 0);
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: REGISTRATION.email, password: VALID_PASSWORD });
  assert.equal(login.status, 200);
});

test('a role with surrounding whitespace is accepted and normalised, not a server error', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const response = await request(app).post('/api/auth/register').send({ ...REGISTRATION, role: ' Organizer ' });
  assert.equal(response.status, 201, response.text);
  assert.equal(response.body.user.role, 'Organizer');
});

test('passwords longer than 72 bytes are rejected instead of being silently truncated by bcrypt', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const atLimit = `Aa1${'x'.repeat(69)}`;
  const overLimit = `${atLimit}x`;
  assert.equal(atLimit.length, 72);
  assert.equal((await request(app).post('/api/auth/register').send({ ...REGISTRATION, password: overLimit })).status, 400);
  // Multi-byte characters count by bytes, not characters.
  assert.equal((await request(app).post('/api/auth/register').send({ ...REGISTRATION, password: `Aa1${'é'.repeat(36)}` })).status, 400);
  assert.equal((await request(app).post('/api/auth/register').send({ ...REGISTRATION, password: atLimit })).status, 201);
  const login = await request(app).post('/api/auth/login').send({ email: REGISTRATION.email, password: `${atLimit}different` });
  assert.equal(login.status, 401);
});

test('registration also rejects an email that matches a legacy mixed-case account', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  db.run(
    "INSERT INTO users (name, email, role, password_hash, created_at) VALUES ('Legacy', 'Legacy@X.com', 'Attendee', 'x', 1)"
  );
  const response = await request(app).post('/api/auth/register').send({ ...REGISTRATION, email: 'legacy@x.com' });
  assert.equal(response.status, 409);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM users').count, 1);
});

test('registration trims the name and stores the email in lowercase', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const response = await request(app)
    .post('/api/auth/register')
    .send({ ...REGISTRATION, name: '  Padded Name  ', email: '  Mixed.Case@Example.Test ' });
  assert.equal(response.status, 201);
  assert.equal(response.body.user.name, 'Padded Name');
  assert.equal(response.body.user.email, 'mixed.case@example.test');
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

const LOGIN_USER = { name: 'Login User', email: 'a@x.com', password: VALID_PASSWORD, role: 'Attendee' };

async function registerLoginUser(app) {
  const registration = await request(app).post('/api/auth/register').send(LOGIN_USER);
  assert.equal(registration.status, 201, registration.text);
  return registration.body.user;
}

test('AC1: login returns 200, a signed JWT, and the user id, name and role', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const user = await registerLoginUser(app);

  const response = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: VALID_PASSWORD });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.user.id, user.id);
  assert.equal(response.body.user.name, 'Login User');
  assert.equal(response.body.user.role, 'Attendee');
  assert.equal(response.text.includes('password'), false);
  assert.equal(response.body.token.split('.').length, 3);
  const verified = jwt.verify(response.body.token, JWT_SECRET, { algorithms: ['HS256'], clockTimestamp: FIXED_NOW });
  assert.equal(verified.sub, String(user.id));
});

test('AC2: the JWT carries the user id and role, expires in 1 hour, and never includes the password', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const user = await registerLoginUser(app);

  const response = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: VALID_PASSWORD });
  const payload = decodePayload(response.body.token);
  assert.equal(payload.sub, String(user.id));
  assert.equal(payload.role, 'Attendee');
  assert.equal(payload.exp - payload.iat, 3600);
  assert.equal(response.body.expiresAt, payload.exp);
  assert.equal(JSON.stringify(payload).toLowerCase().includes('password'), false);
});

test('AC3: a wrong password returns 401 with no token', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  await registerLoginUser(app);

  const response = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'WrongPass123' });
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Invalid email or password.');
  assert.equal(response.body.token, undefined);
});

test('AC4: an unknown email returns the same 401 message as a wrong password', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  await registerLoginUser(app);

  const wrongPassword = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'WrongPass123' });
  const unknownEmail = await request(app).post('/api/auth/login').send({ email: 'nobody@x.com', password: VALID_PASSWORD });
  assert.equal(unknownEmail.status, 401);
  assert.deepEqual(unknownEmail.body, wrongPassword.body);
});

test('AC5: a missing or blank email or password returns 400 and no token', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  await registerLoginUser(app);

  for (const body of [{}, { email: 'a@x.com' }, { password: VALID_PASSWORD }, { email: '  ', password: VALID_PASSWORD }, { email: 'a@x.com', password: '' }]) {
    const response = await request(app).post('/api/auth/login').send(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.token, undefined);
  }
});

test('AC6: login matches the email case-insensitively', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  await registerLoginUser(app);

  const response = await request(app).post('/api/auth/login').send({ email: 'A@X.com', password: VALID_PASSWORD });
  assert.equal(response.status, 200, response.text);
  assert.ok(response.body.token);
});

test('AC7: a valid token is accepted on a protected endpoint', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const user = await registerLoginUser(app);
  const login = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: VALID_PASSWORD });

  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, user.id);
  assert.equal(me.body.user.email, 'a@x.com');
  assert.equal(me.body.user.role, 'Attendee');
});

test('AC8: missing, tampered, expired or unsigned tokens get 401 on a protected endpoint', async (t) => {
  const { app, db, time } = setupWithClock();
  t.after(() => db.close());
  const user = await registerLoginUser(app);
  const login = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: VALID_PASSWORD });
  const token = login.body.token;
  const protectedGet = (value) => {
    const req = request(app).get('/api/auth/me');
    return value === undefined ? req : req.set('Authorization', `Bearer ${value}`);
  };

  assert.equal((await protectedGet()).status, 401);
  assert.equal((await protectedGet('not-a-jwt')).status, 401);

  const tamperedSignature = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
  assert.equal((await protectedGet(tamperedSignature)).status, 401);

  const [header, , signature] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...decodePayload(token), role: 'Admin' })).toString('base64url');
  assert.equal((await protectedGet(`${header}.${forgedPayload}.${signature}`)).status, 401);

  const unsigned = jwt.sign({ sub: String(user.id), role: 'Admin' }, '', { algorithm: 'none' });
  assert.equal((await protectedGet(unsigned)).status, 401);
  const wrongSecret = jwt.sign({ sub: String(user.id), role: 'Admin', iat: FIXED_NOW }, 'a-different-secret', { expiresIn: 3600 });
  assert.equal((await protectedGet(wrongSecret)).status, 401);

  time.now = FIXED_NOW + 3599;
  assert.equal((await protectedGet(token)).status, 200);
  time.now = FIXED_NOW + 3601;
  assert.equal((await protectedGet(token)).status, 401);
});

test('a token for a deleted account is rejected, and role changes apply to the next request', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const user = await registerLoginUser(app);
  const login = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: VALID_PASSWORD });
  const auth = { Authorization: `Bearer ${login.body.token}` };

  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', user.id]);
  assert.equal((await request(app).get('/api/auth/me').set(auth)).body.user.role, 'Organizer');
  db.run('DELETE FROM users WHERE id = ?', [user.id]);
  assert.equal((await request(app).get('/api/auth/me').set(auth)).status, 401);
});

test('logout is client-side: it confirms a valid token but does not revoke it', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const credentials = await createUser(app, { name: 'Sample User', email: 'sample@example.test' });
  const auth = { Authorization: `Bearer ${credentials.token}` };

  assert.equal((await request(app).get('/api/auth/me')).status, 401);
  assert.equal((await request(app).post('/api/auth/logout').set('Authorization', 'Bearer invalid')).status, 400);
  assert.equal((await request(app).post('/api/auth/logout').set(auth)).status, 200);
  // No server-side blacklist in Sprint 1: the client discards the token.
  assert.equal((await request(app).get('/api/auth/me').set(auth)).status, 200);
});

test('event creation enforces authorization and validation; public list supports filters and detail lookup', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  assert.equal((await request(app).post('/api/events').send(VALID_EVENT)).status, 401);

  const attendee = await createUser(app, { email: 'attendee@example.test' });
  const forbidden = await createEvent(app, attendee.token);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error, 'Only organizers can create events.');
  assert.equal(db.get('SELECT COUNT(*) AS count FROM events').count, 0);

  const organizer = await createUser(app, { email: 'organizer@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const created = await createEvent(app, organizer.token);
  assert.equal(created.status, 201, created.text);
  assert.equal(typeof created.body.eventId, 'number');

  const invalid = await createEvent(app, organizer.token, {
    title: '',
    description: '',
    category: '',
    startDateTime: '2020-01-01T10:00',
    endDateTime: '2019-01-01T10:00',
    venueType: 'Physical',
    address: '',
    capacity: 0,
    ticketTypes: []
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(Object.keys(invalid.body.fields).sort(), [
    'capacity',
    'category',
    'description',
    'endDateTime',
    'startDateTime',
    'ticketTypes',
    'title',
    'venue'
  ]);

  const filtered = await request(app).get('/api/events?category=Workshop&search=Future');
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.events.length, 1);
  assert.equal(filtered.body.events[0].organizerId, organizer.user.id);
  assert.equal((await request(app).get(`/api/events/${created.body.eventId}`)).body.event.title, 'Future Workshop');
  assert.equal((await request(app).get(`/api/events/${created.body.eventId}`)).body.event.status, 'Upcoming');
  assert.equal((await request(app).get('/api/events/mine').set('Authorization', `Bearer ${organizer.token}`)).body.events.length, 1);
  assert.equal((await request(app).get('/api/events/99999')).status, 404);
});

test('event creation trims title and returns the complete persisted EMT-14 event', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'emt14-organizer@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const submitted = {
    ...VALID_EVENT,
    title: '  Launch Workshop  ',
    endDateTime: '2099-11-20T13:30',
    ticketTypes: [
      { name: 'Standard', price: 0, quantity: 1 }
    ],
    currency: 'INR',
    tags: ['education', 'community']
  };
  const created = await createEvent(app, organizer.token, submitted);
  assert.equal(created.status, 201, created.text);
  const response = await request(app).get(`/api/events/${created.body.eventId}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.event, {
    id: created.body.eventId,
    organizerId: organizer.user.id,
    title: 'Launch Workshop',
    description: submitted.description,
    category: submitted.category,
    date: submitted.startDateTime,
    startDateTime: submitted.startDateTime,
    endDateTime: submitted.endDateTime,
    venueType: submitted.venueType,
    venue: submitted.address,
    address: submitted.address,
    meetingLink: '',
    capacity: submitted.capacity,
    price: 0,
    ticketTypes: submitted.ticketTypes,
    currency: submitted.currency,
    tags: submitted.tags,
    registeredCount: 0,
    status: 'Upcoming'
  });
});

test('event creation reports every missing required field', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'missing-fields@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const response = await createEvent(app, organizer.token, {
    title: ' ',
    description: '',
    category: '',
    startDateTime: '',
    endDateTime: '',
    venueType: '',
    address: '',
    capacity: '',
    ticketTypes: []
  });
  assert.equal(response.status, 400);
  assert.deepEqual(Object.keys(response.body.fields).sort(), [
    'capacity',
    'category',
    'description',
    'endDateTime',
    'startDateTime',
    'ticketTypes',
    'title',
    'venueType'
  ]);
});

test('physical venues require an address and virtual venues require a valid HTTPS link', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'venue-rules@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);

  const physical = await createEvent(app, organizer.token, { address: '  ' });
  assert.equal(physical.status, 400);
  assert.ok(physical.body.fields.venue);

  const missingLink = await createEvent(app, organizer.token, {
    venueType: 'Virtual',
    address: '',
    meetingLink: ''
  });
  assert.equal(missingLink.status, 400);
  assert.ok(missingLink.body.fields.meetingLink);

  for (const meetingLink of ['http://meet.example.test/room', 'not a url']) {
    const invalidLink = await createEvent(app, organizer.token, {
      venueType: 'Virtual',
      address: '',
      meetingLink
    });
    assert.equal(invalidLink.status, 400);
    assert.ok(invalidLink.body.fields.meetingLink);
  }

  const virtual = await createEvent(app, organizer.token, {
    venueType: 'Virtual',
    address: '',
    meetingLink: 'https://meet.example.test/room'
  });
  assert.equal(virtual.status, 201, virtual.text);
  const event = (await request(app).get(`/api/events/${virtual.body.eventId}`)).body.event;
  assert.equal(event.venueType, 'Virtual');
  assert.equal(event.address, '');
  assert.equal(event.meetingLink, 'https://meet.example.test/room');
});

test('event dates reject invalid, past, and non-increasing ranges', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'date-rules@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);

  for (const startDateTime of ['2020-01-01T10:00', '2099-02-30T10:00', 'not-a-date']) {
    const response = await createEvent(app, organizer.token, { startDateTime });
    assert.equal(response.status, 400);
    assert.ok(response.body.fields.startDateTime);
  }
  for (const endDateTime of ['2099-11-20T10:00', '2099-11-20T09:59']) {
    const response = await createEvent(app, organizer.token, { endDateTime });
    assert.equal(response.status, 400);
    assert.ok(response.body.fields.endDateTime);
  }
});

test('capacity must be an integer between 1 and 100000', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'capacity-rules@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);

  for (const capacity of [0, -1, 1.5, '10', 100001]) {
    const response = await createEvent(app, organizer.token, { capacity });
    assert.equal(response.status, 400, `capacity ${JSON.stringify(capacity)} should be rejected`);
    assert.ok(response.body.fields.capacity);
  }
});

test('ticket types require non-negative prices with at most two decimals and quantities within capacity', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'ticket-rules@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);

  for (const ticketTypes of [[], [{ name: 'General', price: -1 }], [{ name: 'General', price: 1.001 }]]) {
    const response = await createEvent(app, organizer.token, { ticketTypes });
    assert.equal(response.status, 400);
    assert.ok(response.body.fields.ticketTypes || Object.keys(response.body.fields).some((key) => key.startsWith('ticketTypes.')));
  }

  const excessiveQuantity = await createEvent(app, organizer.token, {
    capacity: 5,
    ticketTypes: [{ name: 'General', price: 10, quantity: 6 }]
  });
  assert.equal(excessiveQuantity.status, 400);
  assert.ok(excessiveQuantity.body.fields.ticketTypes);

  const free = await createEvent(app, organizer.token, { ticketTypes: [{ name: 'Free', price: 0 }] });
  assert.equal(free.status, 201, free.text);
  const event = (await request(app).get(`/api/events/${free.body.eventId}`)).body.event;
  assert.equal(event.ticketTypes[0].price, 0);
  assert.equal(event.ticketTypes[0].quantity, VALID_EVENT.capacity);
  assert.equal(event.currency, 'INR');
});

test('admin, missing, invalid, and expired credentials cannot create events', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const admin = await createUser(app, { email: 'event-admin@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Admin', admin.user.id]);
  const adminAttempt = await createEvent(app, admin.token);
  assert.equal(adminAttempt.status, 403);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM events').count, 0);

  assert.equal((await request(app).post('/api/events').send(VALID_EVENT)).status, 401);
  assert.equal((await request(app).post('/api/events').set('Authorization', 'Bearer invalid').send(VALID_EVENT)).status, 401);
  db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [
    'expired-event-token',
    admin.user.id,
    FIXED_NOW - 1
  ]);
  assert.equal((await request(app).post('/api/events')
    .set('Authorization', 'Bearer expired-event-token')
    .send(VALID_EVENT)).status, 401);
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
