import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Database } from '../src/db/database.js';

const FIXED_NOW = 1_800_000_000;
// createUser() marks accounts as verified (so unrelated tests can create and register for events) using the app's db.
const dbByApp = new WeakMap();
const VALID_PASSWORD = 'SecurePass123';
const JWT_SECRET = 'test-secret-for-unit-tests-only';
// Offline CAPTCHA test mode (the default outside production) accepts any token except 'test-fail'.
const CAPTCHA_PASS = 'test-pass';
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

function setup({
  mailer,
  appBaseUrl = 'https://emrs.example.test',
  protectedRouteRateLimitOptions,
  publicAuthRateLimitOptions,
  captcha,
  trustProxy
} = {}) {
  const db = new Database(':memory:');
  const app = createApp({
    db,
    clock: () => FIXED_NOW,
    passwordCost: 4,
    jwtSecret: JWT_SECRET,
    mailer,
    appBaseUrl,
    captcha,
    trustProxy,
    protectedRouteRateLimitOptions,
    publicAuthRateLimitOptions
  });
  dbByApp.set(app, db);
  return { app, db };
}

// Like setup(), but the test can move time forward to exercise token expiry.
function setupWithClock({ mailer, appBaseUrl = 'https://emrs.example.test' } = {}) {
  const db = new Database(':memory:');
  const time = { now: FIXED_NOW };
  const app = createApp({
    db,
    clock: () => time.now,
    passwordCost: 4,
    jwtSecret: JWT_SECRET,
    mailer,
    appBaseUrl
  });
  dbByApp.set(app, db);
  return { app, db, time };
}

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

// The verification token is in the URL fragment of the emailed link: <base>/#verify-email=<token>.
function tokenFromEmail(message) {
  const link = message.text.match(/Verify your email address: (\S+)/)[1];
  return new URL(link).hash.replace('#verify-email=', '');
}

const verifyEmail = (app, token) => request(app).post('/api/auth/verify-email').send({ token });

async function createUser(
  app,
  { name = 'Test User', role = 'Attendee', email = `${role.toLowerCase()}@example.test`, verified = true } = {}
) {
  const registration = await request(app).post('/api/auth/register').send({
    name,
    email,
    phone: '9876543210',
    password: VALID_PASSWORD,
    role,
    captchaToken: CAPTCHA_PASS
  });
  assert.equal(registration.status, 201, registration.text);
  assert.equal(registration.body.user.role, 'Attendee');
  if (verified) dbByApp.get(app).run('UPDATE users SET email_verified = 1 WHERE id = ?', [registration.body.user.id]);

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

async function updateEvent(app, eventId, token, overrides = {}) {
  return request(app)
    .put(`/api/events/${eventId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ ...VALID_EVENT, ...overrides });
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

test('authenticated profile and event registration routes enforce independent rate limits', async (t) => {
  const { app, db } = setup({
    protectedRouteRateLimitOptions: { windowMs: 60_000, limit: 1 }
  });
  t.after(() => db.close());

  const attendee = await createUser(app, { email: 'rate-limit-attendee@example.test' });
  const profile = () => request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${attendee.token}`);
  assert.equal((await profile()).status, 200);
  const limitedProfile = await profile();
  assert.equal(limitedProfile.status, 429);
  assert.deepEqual(limitedProfile.body, { error: 'Too many requests, please try again later.' });

  const organizer = await createUser(app, { email: 'rate-limit-organizer@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const event = await createEvent(app, organizer.token);
  const register = () => request(app)
    .post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${attendee.token}`);
  const registration = await register();
  assert.equal(registration.status, 200);
  assert.equal(registration.body.status, 'confirmed');
  const limitedRegistration = await register();
  assert.equal(limitedRegistration.status, 429);
  assert.deepEqual(limitedRegistration.body, { error: 'Too many requests, please try again later.' });
});

test('event update and audit routes apply rate limits before authentication', async (t) => {
  const { app, db } = setup({
    protectedRouteRateLimitOptions: { windowMs: 60_000, limit: 1 }
  });
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'event-rate-limit@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const created = await createEvent(app, organizer.token);
  const eventPath = `/api/events/${created.body.eventId}`;

  assert.equal((await request(app).put(eventPath).send(VALID_EVENT)).status, 401);
  const limitedUpdate = await request(app)
    .put(eventPath)
    .set('Authorization', `Bearer ${organizer.token}`)
    .send(VALID_EVENT);
  assert.equal(limitedUpdate.status, 429);

  assert.equal((await request(app).get(`${eventPath}/audit`)).status, 401);
  const limitedAudit = await request(app)
    .get(`${eventPath}/audit`)
    .set('Authorization', `Bearer ${organizer.token}`);
  assert.equal(limitedAudit.status, 429);
});

test('public registration, verification, and login routes use separate rate limits', async (t) => {
  const messages = [];
  const { app, db } = setup({
    mailer: { async sendMail(message) { messages.push(message); } },
    publicAuthRateLimitOptions: {
      registration: { windowMs: 60_000, limit: 1 },
      verification: { windowMs: 60_000, limit: 1 },
      login: { windowMs: 60_000, limit: 1 }
    }
  });
  t.after(() => db.close());

  const registration = await request(app).post('/api/auth/register').send(REGISTRATION);
  assert.equal(registration.status, 201);
  const token = tokenFromEmail(messages[0]);

  const verified = await verifyEmail(app, token);
  assert.equal(verified.status, 200);
  const limitedVerification = await verifyEmail(app, token);
  assert.equal(limitedVerification.status, 429);

  const login = () => request(app).post('/api/auth/login').send({
    email: REGISTRATION.email,
    password: VALID_PASSWORD
  });
  assert.equal((await login()).status, 200);
  const limitedLogin = await login();
  assert.equal(limitedLogin.status, 429);

  const limitedRegistration = await request(app).post('/api/auth/register').send({
    ...REGISTRATION,
    email: 'another@example.test'
  });
  assert.equal(limitedRegistration.status, 429);
  assert.deepEqual(limitedRegistration.body, { error: 'Too many requests, please try again later.' });
  assert.ok(Object.keys(limitedRegistration.headers).some((header) => header.startsWith('ratelimit')));
});

const REGISTRATION = {
  name: 'Example Person',
  email: 'example@example.test',
  password: VALID_PASSWORD,
  role: 'Attendee',
  captchaToken: CAPTCHA_PASS
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

test('registration sends a verification link to the web app while preserving immediate login', async (t) => {
  const messages = [];
  const { app, db } = setup({
    mailer: { async sendMail(message) { messages.push(message); } },
    appBaseUrl: 'https://events.example.test'
  });
  t.after(() => db.close());
  const registration = await request(app).post('/api/auth/register').send(REGISTRATION);
  assert.equal(registration.status, 201);
  assert.equal(registration.body.user.emailVerified, false);
  assert.equal(db.get('SELECT email_verified FROM users').email_verified, 0);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, REGISTRATION.email);
  assert.match(messages[0].text, /verify your email address/i);
  assert.match(messages[0].text, /Event Management and Registration System \(EMRS\)/);
  const verificationUrl = new URL(messages[0].text.match(/Verify your email address: (\S+)/)[1]);
  assert.equal(verificationUrl.origin, 'https://events.example.test');
  assert.equal(verificationUrl.pathname, '/');
  assert.equal(verificationUrl.search, '', 'the token must not be in the query string, where servers log it');
  const token = tokenFromEmail(messages[0]);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(db.get('SELECT token_hash FROM email_verification_tokens').token_hash, token);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: REGISTRATION.email, password: VALID_PASSWORD });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.emailVerified, false);

  const verified = await verifyEmail(app, token);
  assert.equal(verified.status, 200);
  assert.equal(db.get('SELECT email_verified FROM users').email_verified, 1);
  assert.equal((await verifyEmail(app, token)).status, 400);
});

test('verification is a POST: opening the link as a plain GET never changes the account', async (t) => {
  const messages = [];
  const { app, db } = setup({ mailer: { async sendMail(message) { messages.push(message); } } });
  t.after(() => db.close());
  await request(app).post('/api/auth/register').send(REGISTRATION);
  const token = tokenFromEmail(messages[0]);

  // Email scanners and link previewers issue GETs; they must not use up the token.
  const get = await request(app).get('/api/auth/verify-email').query({ token });
  assert.equal(get.status, 404);
  assert.equal(db.get('SELECT email_verified FROM users').email_verified, 0);
  assert.equal((await verifyEmail(app, token)).status, 200);
});

test('invalid, expired and used verification tokens return 400 and change nothing', async (t) => {
  const messages = [];
  const { app, db, time } = setupWithClock({
    mailer: { async sendMail(message) { messages.push(message); } }
  });
  t.after(() => db.close());
  assert.equal((await request(app).post('/api/auth/register').send(REGISTRATION)).status, 201);

  for (const token of ['a'.repeat(43), 'short', '', undefined, 12345]) {
    const response = await request(app).post('/api/auth/verify-email').send({ token });
    assert.equal(response.status, 400, String(token));
  }
  assert.equal((await request(app).post('/api/auth/verify-email').send({})).status, 400);
  assert.equal(db.get('SELECT email_verified FROM users').email_verified, 0);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM email_verification_tokens').count, 1);

  const expiredToken = tokenFromEmail(messages[0]);
  time.now += 24 * 60 * 60;
  const expired = await verifyEmail(app, expiredToken);
  assert.equal(expired.status, 400);
  assert.equal(db.get('SELECT email_verified FROM users').email_verified, 0);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM email_verification_tokens').count, 0);
});

test('a link works just before it expires', async (t) => {
  const messages = [];
  const { app, db, time } = setupWithClock({ mailer: { async sendMail(message) { messages.push(message); } } });
  t.after(() => db.close());
  await request(app).post('/api/auth/register').send(REGISTRATION);
  time.now += 24 * 60 * 60 - 1;
  assert.equal((await verifyEmail(app, tokenFromEmail(messages[0]))).status, 200);
});

test('unverified users can sign in but cannot create events or register for events (403)', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'organizer@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const event = await createEvent(app, organizer.token);
  assert.equal(event.status, 201, event.text);

  const unverifiedOrganizer = await createUser(app, { email: 'unverified-org@example.test', verified: false });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', unverifiedOrganizer.user.id]);
  const blockedCreate = await createEvent(app, unverifiedOrganizer.token);
  assert.equal(blockedCreate.status, 403);
  assert.equal(blockedCreate.body.error, 'Please verify your email');
  assert.equal(db.get('SELECT COUNT(*) AS count FROM events').count, 1);

  const unverifiedAttendee = await createUser(app, { email: 'unverified-att@example.test', verified: false });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${unverifiedAttendee.token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.emailVerified, false);
  const blockedRegister = await request(app)
    .post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${unverifiedAttendee.token}`);
  assert.equal(blockedRegister.status, 403);
  assert.equal(blockedRegister.body.error, 'Please verify your email');
  assert.equal(db.get('SELECT COUNT(*) AS count FROM registrations').count, 0);
});

test('after verifying, creating and registering for events work as before', async (t) => {
  const messages = [];
  const { app, db } = setup({ mailer: { async sendMail(message) { messages.push(message); } } });
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'organizer@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const event = await createEvent(app, organizer.token);

  const attendee = await createUser(app, { email: 'later-verified@example.test', verified: false });
  const url = (id) => `/api/events/${id}/register`;
  const auth = { Authorization: `Bearer ${attendee.token}` };
  assert.equal((await request(app).post(url(event.body.eventId)).set(auth)).status, 403);

  const verificationMessage = messages.find((message) => message.to === 'later-verified@example.test');
  assert.equal((await verifyEmail(app, tokenFromEmail(verificationMessage))).status, 200);
  const registered = await request(app).post(url(event.body.eventId)).set(auth);
  assert.equal(registered.status, 200, registered.text);
  assert.equal(registered.body.status, 'confirmed');
  const me = await request(app).get('/api/auth/me').set(auth);
  assert.equal(me.body.user.emailVerified, true);
});

test('resend requires sign-in, replaces the old link and sends a new one', async (t) => {
  const messages = [];
  const { app, db } = setup({ mailer: { async sendMail(message) { messages.push(message); } } });
  t.after(() => db.close());
  const user = await createUser(app, { email: 'resend@example.test', verified: false });
  const auth = { Authorization: `Bearer ${user.token}` };
  const oldToken = tokenFromEmail(messages[0]);

  assert.equal((await request(app).post('/api/auth/resend-verification')).status, 401);
  assert.equal(messages.length, 1);

  const resend = await request(app).post('/api/auth/resend-verification').set(auth);
  assert.equal(resend.status, 200);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].to, 'resend@example.test');
  const newToken = tokenFromEmail(messages[1]);
  assert.notEqual(newToken, oldToken);
  assert.equal(JSON.stringify(resend.body).includes(newToken), false);

  assert.equal((await verifyEmail(app, oldToken)).status, 400, 'the old link must stop working');
  assert.equal(db.get('SELECT email_verified FROM users').email_verified, 0);
  assert.equal((await verifyEmail(app, newToken)).status, 200);
});

test('resend is limited to 3 per hour per user and the limit is not shared between users', async (t) => {
  const messages = [];
  const { app, db } = setup({ mailer: { async sendMail(message) { messages.push(message); } } });
  t.after(() => db.close());
  const first = await createUser(app, { email: 'first@example.test', verified: false });
  const second = await createUser(app, { email: 'second@example.test', verified: false });
  const resend = (user) => request(app).post('/api/auth/resend-verification')
    .set('Authorization', `Bearer ${user.token}`);

  for (let attempt = 1; attempt <= 3; attempt += 1) assert.equal((await resend(first)).status, 200, `attempt ${attempt}`);
  const sentBefore = messages.length;
  const limited = await resend(first);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers['retry-after']) > 0);
  assert.equal(messages.length, sentBefore, 'no email is sent once limited');
  assert.equal((await resend(second)).status, 200);
});

test('resending for an already verified account returns 409 and sends nothing', async (t) => {
  const messages = [];
  const { app, db } = setup({ mailer: { async sendMail(message) { messages.push(message); } } });
  t.after(() => db.close());
  const user = await createUser(app, { email: 'done@example.test' });
  const response = await request(app).post('/api/auth/resend-verification')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(response.status, 409);
  assert.equal(messages.filter((message) => message.subject.includes('Verify')).length, 1);
});

test('the verification token never appears in an API response or in the logs', async (t) => {
  const messages = [];
  const logged = [];
  const originals = {};
  for (const method of ['log', 'info', 'warn', 'error']) {
    originals[method] = console[method];
    console[method] = (...args) => logged.push(args.map(String).join(' '));
  }
  t.after(() => Object.assign(console, originals));
  const { app, db } = setup({
    mailer: { async sendMail(message) { messages.push(message); } }
  });
  t.after(() => db.close());

  const responses = [];
  const registration = await request(app).post('/api/auth/register').send(REGISTRATION);
  responses.push(registration);
  const login = await request(app).post('/api/auth/login').send({ email: REGISTRATION.email, password: VALID_PASSWORD });
  responses.push(login);
  const auth = { Authorization: `Bearer ${login.body.token}` };
  responses.push(await request(app).post('/api/auth/resend-verification').set(auth));
  const token = tokenFromEmail(messages.at(-1));
  responses.push(await verifyEmail(app, token));
  responses.push(await verifyEmail(app, token));
  responses.push(await request(app).get('/api/auth/me').set(auth));

  for (const response of responses) {
    assert.equal(response.text.includes(token), false);
    assert.equal(JSON.stringify(response.headers).includes(token), false);
  }
  assert.equal(logged.join('\n').includes(token), false);
});

test('a failed verification email never fails registration or resend', async (t) => {
  const { app, db } = setup({
    mailer: { async sendMail() { throw new Error('smtp down'); } }
  });
  t.after(() => db.close());
  const registration = await request(app).post('/api/auth/register').send(REGISTRATION);
  assert.equal(registration.status, 201);
  const login = await request(app).post('/api/auth/login').send({ email: REGISTRATION.email, password: VALID_PASSWORD });
  const resend = await request(app).post('/api/auth/resend-verification')
    .set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(resend.status, 200);
});

// ---- EMT-29: rate limiting and CAPTCHA ----

const loginAs = (app, email, password, extra = {}) =>
  request(app).post('/api/auth/login').send({ email, password, ...extra });

test('EMT-29 AC1: the 11th login request from one IP within a minute returns 429 with Retry-After', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const statuses = [];
  let last;
  for (let attempt = 1; attempt <= 11; attempt += 1) {
    last = await loginAs(app, 'someone@example.test', 'WrongPass123');
    statuses.push(last.status);
  }
  assert.equal(statuses.slice(0, 10).includes(429), false, statuses.join(','));
  assert.equal(last.status, 429);
  const retryAfter = Number(last.headers['retry-after']);
  assert.ok(retryAfter >= 1 && retryAfter <= 60, `Retry-After was ${last.headers['retry-after']}`);
});

test('EMT-29: registration and resend-verification are limited to 10 requests per minute per IP', async (t) => {
  const messages = [];
  const { app, db } = setup({
    mailer: { async sendMail(message) { messages.push(message); } },
    publicAuthRateLimitOptions: { resendVerificationPerUser: { limit: 100 } }
  });
  t.after(() => db.close());

  const registrations = [];
  for (let index = 1; index <= 11; index += 1) {
    registrations.push((await request(app).post('/api/auth/register')
      .send({ ...REGISTRATION, email: `user${index}@example.test` })).status);
  }
  assert.deepEqual(registrations.slice(0, 10), Array(10).fill(201));
  assert.equal(registrations[10], 429);

  const { app: resendApp, db: resendDb } = setup({
    mailer: { async sendMail(message) { messages.push(message); } },
    publicAuthRateLimitOptions: { resendVerificationPerUser: { limit: 100 } }
  });
  t.after(() => resendDb.close());
  const user = await createUser(resendApp, { email: 'resend-ip@example.test', verified: false });
  const resends = [];
  let lastResend;
  for (let index = 1; index <= 11; index += 1) {
    lastResend = await request(resendApp).post('/api/auth/resend-verification')
      .set('Authorization', `Bearer ${user.token}`);
    resends.push(lastResend.status);
  }
  assert.deepEqual(resends.slice(0, 10), Array(10).fill(200));
  assert.equal(lastResend.status, 429);
  assert.ok(Number(lastResend.headers['retry-after']) > 0);
});

test('EMT-29 AC2: registration without a CAPTCHA token returns 400 "CAPTCHA required" and creates no account', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  for (const captchaToken of [undefined, '', '   ', 42]) {
    const body = { ...REGISTRATION, captchaToken };
    if (captchaToken === undefined) delete body.captchaToken;
    const response = await request(app).post('/api/auth/register').send(body);
    assert.equal(response.status, 400, String(captchaToken));
    assert.equal(response.body.error, 'CAPTCHA required');
  }
  assert.equal(db.get('SELECT COUNT(*) AS count FROM users').count, 0);
});

test('EMT-29 AC3: a failed CAPTCHA check returns 400 and creates no account', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const response = await request(app).post('/api/auth/register').send({ ...REGISTRATION, captchaToken: 'test-fail' });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'CAPTCHA verification failed');
  assert.equal(db.get('SELECT COUNT(*) AS count FROM users').count, 0);

  const tooLong = await request(app).post('/api/auth/register')
    .send({ ...REGISTRATION, captchaToken: 'x'.repeat(5000) });
  assert.equal(tooLong.status, 400);
});

test('EMT-29: a CAPTCHA provider outage blocks registration with 503 instead of letting it through', async (t) => {
  const { app, db } = setup({ captcha: { provider: 'turnstile', siteKey: 'k', async verify() { return { ok: false, unavailable: true }; } } });
  t.after(() => db.close());
  const response = await request(app).post('/api/auth/register').send(REGISTRATION);
  assert.equal(response.status, 503);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM users').count, 0);
});

test('EMT-29: the verifier gets the token and client IP; invalid forms never reach it', async (t) => {
  const calls = [];
  const { app, db } = setup({
    captcha: { provider: 'turnstile', siteKey: 'k', async verify(token, ip) { calls.push({ token, ip }); return { ok: true }; } }
  });
  t.after(() => db.close());
  const invalid = await request(app).post('/api/auth/register').send({ ...REGISTRATION, email: 'not-an-email' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(calls, [], 'validation runs before the CAPTCHA, so a typo does not use up a one-time token');

  const valid = await request(app).post('/api/auth/register').send({ ...REGISTRATION, captchaToken: ' abc ' });
  assert.equal(valid.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, 'abc');
  assert.match(calls[0].ip, /127\.0\.0\.1/);
});

test('EMT-29: GET /api/auth/captcha-config tells the web app which widget to show', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const response = await request(app).get('/api/auth/captcha-config');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { provider: 'test', siteKey: 'test-site-key' });

  const { app: realApp, db: realDb } = setup({ captcha: { provider: 'turnstile', siteKey: 'site-123', async verify() { return { ok: true }; } } });
  t.after(() => realDb.close());
  assert.deepEqual((await request(realApp).get('/api/auth/captcha-config')).body, { provider: 'turnstile', siteKey: 'site-123' });
});

test('EMT-29 AC4: after 3 failed logins for an email the next login needs a CAPTCHA token', async (t) => {
  const { app, db } = setup({ trustProxy: 1 });
  t.after(() => db.close());
  await registerLoginUser(app);
  const from = (ip, email, password, extra = {}) => request(app).post('/api/auth/login')
    .set('X-Forwarded-For', ip).send({ email, password, ...extra });

  const first = await from('198.51.100.1', 'a@x.com', 'WrongPass123');
  const second = await from('198.51.100.1', 'a@x.com', 'WrongPass123');
  const third = await from('198.51.100.1', 'a@x.com', 'WrongPass123');
  assert.deepEqual([first.status, second.status, third.status], [401, 401, 401]);
  assert.equal(first.body.captchaRequired, false);
  assert.equal(third.body.captchaRequired, true, 'the 401 tells the web app to show the CAPTCHA');

  // The email's count follows the account, not the IP: a different IP is asked for a CAPTCHA too.
  const noToken = await from('198.51.100.2', 'A@X.com', VALID_PASSWORD);
  assert.equal(noToken.status, 400);
  assert.equal(noToken.body.error, 'CAPTCHA required');
  assert.equal(noToken.body.token, undefined);

  const failedCaptcha = await from('198.51.100.2', 'a@x.com', VALID_PASSWORD, { captchaToken: 'test-fail' });
  assert.equal(failedCaptcha.status, 400);
  assert.equal(failedCaptcha.body.token, undefined);

  const passed = await from('198.51.100.2', 'a@x.com', VALID_PASSWORD, { captchaToken: CAPTCHA_PASS });
  assert.equal(passed.status, 200, passed.text);
  assert.ok(passed.body.token);

  // Success clears the email's count, so a fresh IP is no longer asked for a CAPTCHA...
  assert.equal((await from('198.51.100.3', 'a@x.com', VALID_PASSWORD)).status, 200);
  // ...but the first IP keeps its own 3 failures until they expire, so success cannot be used to reset an IP.
  assert.equal((await from('198.51.100.1', 'a@x.com', VALID_PASSWORD)).status, 400);
});

test('EMT-29: three failures from one IP across different emails also require a CAPTCHA', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  await registerLoginUser(app);
  for (const email of ['x1@example.test', 'x2@example.test', 'x3@example.test']) {
    assert.equal((await loginAs(app, email, 'WrongPass123')).status, 401);
  }
  const response = await loginAs(app, 'a@x.com', VALID_PASSWORD);
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'CAPTCHA required');
  assert.equal((await loginAs(app, 'a@x.com', VALID_PASSWORD, { captchaToken: CAPTCHA_PASS })).status, 200);
});

test('EMT-29 AC5: within the limits, login and registration behave exactly as before', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  await registerLoginUser(app);
  assert.equal((await loginAs(app, 'a@x.com', 'WrongPass123')).status, 401);
  assert.equal((await loginAs(app, 'a@x.com', 'WrongPass123')).status, 401);
  const login = await loginAs(app, 'a@x.com', VALID_PASSWORD);
  assert.equal(login.status, 200);
  assert.deepEqual(Object.keys(login.body).sort(), ['expiresAt', 'token', 'user']);
});

test('EMT-29: with TRUST_PROXY the limiter uses the real client IP; without it, X-Forwarded-For is ignored', async (t) => {
  const limits = { login: { windowMs: 60_000, limit: 1 } };
  const trusted = setup({ trustProxy: 1, publicAuthRateLimitOptions: limits });
  t.after(() => trusted.db.close());
  const fromClient = (app, ip) => request(app).post('/api/auth/login').set('X-Forwarded-For', ip)
    .send({ email: 'p@example.test', password: 'WrongPass123' });

  assert.notEqual((await fromClient(trusted.app, '203.0.113.1')).status, 429);
  assert.notEqual((await fromClient(trusted.app, '203.0.113.2')).status, 429, 'a different client IP has its own bucket');
  assert.equal((await fromClient(trusted.app, '203.0.113.1')).status, 429);

  const untrusted = setup({ publicAuthRateLimitOptions: limits });
  t.after(() => untrusted.db.close());
  assert.notEqual((await fromClient(untrusted.app, '203.0.113.1')).status, 429);
  assert.equal((await fromClient(untrusted.app, '203.0.113.2')).status, 429, 'a spoofed header must not dodge the limit');
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
  const login = (password, extra = {}) => request(app).post('/api/auth/login').send({
    email: 'login@example.test',
    password,
    ...extra
  });
  // Failures 1-3 need no CAPTCHA; after the third, a CAPTCHA token is required (EMT-29).
  for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await login('WrongPass123')).status, 401);
  assert.equal((await login('WrongPass123')).status, 400);
  // The 4th and 5th failed attempts (with a CAPTCHA) reach the per-account lockout.
  assert.equal((await login('WrongPass123', { captchaToken: CAPTCHA_PASS })).status, 401);
  const fifthFailure = await login('WrongPass123', { captchaToken: CAPTCHA_PASS });
  assert.equal(fifthFailure.status, 429);
  assert.ok(Number(fifthFailure.headers['retry-after']) > 0);
  const locked = await login(VALID_PASSWORD, { captchaToken: CAPTCHA_PASS });
  assert.equal(locked.status, 429);
  assert.match(locked.body.error, /temporarily locked/);
  assert.ok(Number(locked.headers['retry-after']) > 0);
});

const LOGIN_USER = {
  name: 'Login User',
  email: 'a@x.com',
  password: VALID_PASSWORD,
  role: 'Attendee',
  captchaToken: CAPTCHA_PASS
};

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

test('an account created before the bcrypt switch (PBKDF2 hash, mixed-case email) can still log in', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const hash = pbkdf2Sync(VALID_PASSWORD, salt, 1_000, 32, 'sha256').toString('hex');
  db.run(
    'INSERT INTO users (name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    ['Old Account', 'Old@Example.test', 'Organizer', `pbkdf2$1000$${salt.toString('hex')}$${hash}`, 1]
  );
  const ok = await request(app).post('/api/auth/login').send({ email: 'old@example.test', password: VALID_PASSWORD });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.user.role, 'Organizer');
  const bad = await request(app).post('/api/auth/login').send({ email: 'old@example.test', password: 'WrongPass123' });
  assert.equal(bad.status, 401);
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

test('event owner can update an event and audit records only changed fields', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'update-owner@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const created = await createEvent(app, organizer.token);

  const update = await updateEvent(app, created.body.eventId, organizer.token, {
    title: 'Updated Workshop',
    address: 'Hall B'
  });
  assert.equal(update.status, 200, update.text);
  assert.equal(update.body.event.title, 'Updated Workshop');
  assert.equal(update.body.event.venue, 'Hall B');
  assert.equal(update.body.event.organizerId, organizer.user.id);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM audit_logs').count, 2);

  const history = await request(app)
    .get(`/api/events/${created.body.eventId}/audit`)
    .set('Authorization', `Bearer ${organizer.token}`);
  assert.equal(history.status, 200, history.text);
  assert.equal(history.body.audit.length, 2);
  assert.deepEqual(history.body.audit.map((entry) => entry.field).sort(), ['title', 'venue']);
  assert.deepEqual(history.body.audit.map((entry) => entry.userId), [organizer.user.id, organizer.user.id]);
  assert.deepEqual(history.body.audit.map((entry) => entry.timestamp), [FIXED_NOW, FIXED_NOW]);
  const titleChange = history.body.audit.find((entry) => entry.field === 'title');
  assert.equal(titleChange.userName, 'Test User');
  assert.equal(titleChange.oldValue, 'Future Workshop');
  assert.equal(titleChange.newValue, 'Updated Workshop');
  const venueChange = history.body.audit.find((entry) => entry.field === 'venue');
  assert.equal(venueChange.oldValue, 'Hall A');
  assert.equal(venueChange.newValue, 'Hall B');

  const unchanged = await updateEvent(app, created.body.eventId, organizer.token, {
    title: 'Updated Workshop',
    address: 'Hall B'
  });
  assert.equal(unchanged.status, 200, unchanged.text);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM audit_logs').count, 2);
});

test('event update authorization allows admins and rejects attendees, other organizers, and anonymous users', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const owner = await createUser(app, { email: 'authorization-owner@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', owner.user.id]);
  const otherOrganizer = await createUser(app, { email: 'authorization-other@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', otherOrganizer.user.id]);
  const attendee = await createUser(app, { email: 'authorization-attendee@example.test' });
  const admin = await createUser(app, { email: 'authorization-admin@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Admin', admin.user.id]);
  const created = await createEvent(app, owner.token);
  const eventPath = `/api/events/${created.body.eventId}`;

  assert.equal((await request(app).put(eventPath).send(VALID_EVENT)).status, 401);
  assert.equal((await updateEvent(app, created.body.eventId, otherOrganizer.token, { title: 'No Access' })).status, 403);
  assert.equal((await updateEvent(app, created.body.eventId, attendee.token, { title: 'No Access' })).status, 403);
  assert.equal((await updateEvent(app, 99999, owner.token)).status, 404);

  const adminUpdate = await updateEvent(app, created.body.eventId, admin.token, { title: 'Admin Updated Workshop' });
  assert.equal(adminUpdate.status, 200, adminUpdate.text);
  assert.equal(adminUpdate.body.event.title, 'Admin Updated Workshop');
});

test('event updates use create-event validation and leave invalid events unchanged', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'update-validation@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const created = await createEvent(app, organizer.token);
  const path = `/api/events/${created.body.eventId}`;
  const original = (await request(app).get(path)).body.event;

  const invalidCases = [
    { startDateTime: '2020-01-01T10:00' },
    { endDateTime: '2099-11-20T09:00' },
    { capacity: 0 },
    {
      title: '',
      startDateTime: '2020-01-01T10:00',
      endDateTime: '2019-01-01T10:00',
      capacity: 0,
      ticketTypes: []
    }
  ];
  for (const invalid of invalidCases) {
    const response = await updateEvent(app, created.body.eventId, organizer.token, invalid);
    assert.equal(response.status, 400, response.text);
    assert.equal(response.body.error, 'Validation failed');
    assert.ok(Object.keys(response.body.fields).length > 0);
    assert.deepEqual((await request(app).get(path)).body.event, original);
  }
  const multiInvalid = await updateEvent(app, created.body.eventId, organizer.token, invalidCases[3]);
  assert.deepEqual(Object.keys(multiInvalid.body.fields).sort(), [
    'capacity',
    'endDateTime',
    'startDateTime',
    'ticketTypes',
    'title'
  ]);
});

test('event update rejects capacity below confirmed registrations without changing the event', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'update-capacity-owner@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const created = await createEvent(app, organizer.token, {
    capacity: 2,
    ticketTypes: [{ name: 'General Admission', price: 15.5, quantity: 2 }]
  });
  const attendeeOne = await createUser(app, { email: 'update-capacity-one@example.test' });
  const attendeeTwo = await createUser(app, { email: 'update-capacity-two@example.test' });
  for (const attendee of [attendeeOne, attendeeTwo]) {
    const registration = await request(app)
      .post(`/api/events/${created.body.eventId}/register`)
      .set('Authorization', `Bearer ${attendee.token}`);
    assert.equal(registration.status, 200, registration.text);
    assert.equal(registration.body.status, 'confirmed');
  }

  const path = `/api/events/${created.body.eventId}`;
  const original = (await request(app).get(path)).body.event;
  const response = await updateEvent(app, created.body.eventId, organizer.token, {
    capacity: 1,
    ticketTypes: [{ name: 'General Admission', price: 15.5, quantity: 1 }]
  });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /capacity cannot be lower than the current confirmed registration count/i);
  assert.deepEqual((await request(app).get(path)).body.event, original);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM audit_logs').count, 0);
});

test('started and cancelled events cannot be updated', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'update-state-owner@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const started = await createEvent(app, organizer.token);
  db.run(
    'UPDATE events SET start_datetime = ?, event_date = ?, start_time = ? WHERE id = ?',
    ['2020-01-01T10:00', '2020-01-01', '10:00', started.body.eventId]
  );
  const startedPath = `/api/events/${started.body.eventId}`;
  const startedBefore = (await request(app).get(startedPath)).body.event;
  const startedUpdate = await updateEvent(app, started.body.eventId, organizer.token, { title: 'Too Late' });
  assert.equal(startedUpdate.status, 409);
  assert.equal(startedUpdate.body.error, 'Event has already started');
  assert.deepEqual((await request(app).get(startedPath)).body.event, startedBefore);

  const cancelled = await createEvent(app, organizer.token, { title: 'Cancelled Workshop' });
  const cancelResponse = await request(app)
    .delete(`/api/events/${cancelled.body.eventId}`)
    .set('Authorization', `Bearer ${organizer.token}`);
  assert.equal(cancelResponse.status, 200);
  const cancelledPath = `/api/events/${cancelled.body.eventId}`;
  const cancelledBefore = (await request(app).get(cancelledPath)).body.event;
  const cancelledUpdate = await updateEvent(app, cancelled.body.eventId, organizer.token, { title: 'Too Late' });
  assert.equal(cancelledUpdate.status, 409);
  assert.match(cancelledUpdate.body.error, /cancelled/i);
  assert.deepEqual((await request(app).get(cancelledPath)).body.event, cancelledBefore);
});

test('event audit history is restricted to the event owner or an admin', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const owner = await createUser(app, { email: 'audit-owner@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', owner.user.id]);
  const otherOrganizer = await createUser(app, { email: 'audit-other@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', otherOrganizer.user.id]);
  const attendee = await createUser(app, { email: 'audit-attendee@example.test' });
  const admin = await createUser(app, { email: 'audit-admin@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Admin', admin.user.id]);
  const created = await createEvent(app, owner.token);
  await updateEvent(app, created.body.eventId, owner.token, { title: 'Audited Workshop' });
  const auditPath = `/api/events/${created.body.eventId}/audit`;

  assert.equal((await request(app).get(auditPath)).status, 401);
  assert.equal((await request(app).get(auditPath).set('Authorization', `Bearer ${otherOrganizer.token}`)).status, 403);
  assert.equal((await request(app).get(auditPath).set('Authorization', `Bearer ${attendee.token}`)).status, 403);
  assert.equal((await request(app).get('/api/events/99999/audit')
    .set('Authorization', `Bearer ${owner.token}`)).status, 404);
  assert.equal((await request(app).get(auditPath)
    .set('Authorization', `Bearer ${admin.token}`)).status, 200);
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

test('confirmed registrations email event details and ticket code, but waitlisted registrations do not', async (t) => {
  const messages = [];
  const { app, db } = setup({
    mailer: { async sendMail(message) { messages.push(message); } }
  });
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'confirmation-organizer@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const event = await createEvent(app, organizer.token);
  const attendeeOne = await createUser(app, { email: 'confirmation-one@example.test' });
  const attendeeTwo = await createUser(app, { email: 'confirmation-two@example.test' });

  const confirmed = await request(app)
    .post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${attendeeOne.token}`);
  assert.equal(confirmed.status, 200);
  const confirmation = messages.find((message) => message.subject === 'Registration confirmed: Future Workshop');
  assert.ok(confirmation);
  assert.equal(confirmation.to, 'confirmation-one@example.test');
  assert.match(confirmation.text, /Future Workshop/);
  assert.match(confirmation.text, /2099-11-20T10:00/);
  assert.match(confirmation.text, new RegExp(confirmed.body.ticketCode));

  const confirmationCount = messages.filter((message) => message.subject.startsWith('Registration confirmed:')).length;
  const waitlisted = await request(app)
    .post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${attendeeTwo.token}`);
  assert.equal(waitlisted.status, 200);
  assert.equal(waitlisted.body.status, 'waitlist');
  assert.equal(messages.filter((message) => message.subject.startsWith('Registration confirmed:')).length, confirmationCount);
  assert.equal(attendeeOne.user.email, confirmation.to);
  assert.equal(attendeeTwo.user.email, 'confirmation-two@example.test');
});

test('verification and registration mail failures do not fail the API or log message secrets', async (t) => {
  const originalError = console.error;
  const logs = [];
  const smtpPassword = 'secret-smtp-password';
  const mailer = {
    async sendMail(message) {
      throw new Error(`SMTP_PASS=${smtpPassword}; body=${message.text}`);
    }
  };
  const { app, db } = setup({ mailer });
  t.after(() => {
    console.error = originalError;
    db.close();
  });
  console.error = (...args) => logs.push(args);

  const attendee = await createUser(app, { email: 'mail-failure@example.test' });
  const organizer = await createUser(app, { email: 'mail-organizer@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const event = await createEvent(app, organizer.token);
  const registration = await request(app)
    .post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${attendee.token}`);

  assert.equal(registration.status, 200);
  assert.equal(registration.body.status, 'confirmed');
  assert.equal(db.get('SELECT status FROM registrations WHERE user_id = ?', [attendee.user.id]).status, 'confirmed');
  assert.equal(logs.length, 3);
  assert.ok(logs.every((entry) => entry.length === 1 && entry[0] === 'Email delivery failed'));
  assert.doesNotMatch(JSON.stringify(logs), /secret-smtp-password|Verify your email address|EMRS-[0-9a-f]{8}/);
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

async function seedFilterApi(app, db) {
  const organizer = await createUser(app, { email: 'filter-organizer@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const make = async (title, day, address, category = 'Workshop') => {
    const response = await createEvent(app, organizer.token, {
      title,
      category,
      address,
      startDateTime: `2099-11-${day}T10:00`,
      endDateTime: `2099-11-${day}T12:00`
    });
    assert.equal(response.status, 201, response.text);
    return response.body.eventId;
  };
  return {
    organizer,
    nov1: await make('Early Event', '01', 'Auditorium Hall A', 'Conference'),
    nov10: await make('Middle Event', '10', 'Auditorium Hall A'),
    nov20: await make('Late Event', '20', 'City Park')
  };
}

const ids = (response) => response.body.events.map((event) => event.id);

test('GET /api/events filters by date range, both dates inclusive', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const seeded = await seedFilterApi(app, db);

  const range = await request(app).get('/api/events?from=2099-11-05&to=2099-11-15');
  assert.equal(range.status, 200);
  assert.deepEqual(ids(range), [seeded.nov10]);

  const exact = await request(app).get('/api/events?from=2099-11-01&to=2099-11-20');
  assert.deepEqual(ids(exact), [seeded.nov1, seeded.nov10, seeded.nov20]);

  assert.deepEqual(ids(await request(app).get('/api/events?from=2099-11-10')), [seeded.nov10, seeded.nov20]);
  assert.deepEqual(ids(await request(app).get('/api/events?to=2099-11-10')), [seeded.nov1, seeded.nov10]);
  assert.deepEqual(ids(await request(app).get('/api/events?from=&to=')), [seeded.nov1, seeded.nov10, seeded.nov20]);
});

test('GET /api/events filters by location, ignoring case', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const seeded = await seedFilterApi(app, db);

  assert.deepEqual(ids(await request(app).get('/api/events?location=hall%20a')), [seeded.nov1, seeded.nov10]);
  assert.deepEqual(ids(await request(app).get('/api/events?location=CITY')), [seeded.nov20]);
  assert.deepEqual(ids(await request(app).get('/api/events?location=nowhere')), []);
});

test('GET /api/events combines date, location, category and search with AND', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const seeded = await seedFilterApi(app, db);

  const combined = await request(app).get('/api/events?from=2099-11-05&to=2099-11-30&location=hall%20a');
  assert.deepEqual(ids(combined), [seeded.nov10]);
  assert.deepEqual(ids(await request(app).get('/api/events?location=hall%20a&category=Conference')), [seeded.nov1]);
  assert.deepEqual(ids(await request(app).get('/api/events?location=hall%20a&search=Middle&from=2099-11-01')), [seeded.nov10]);
  assert.deepEqual(ids(await request(app).get('/api/events?location=city&to=2099-11-15')), []);
});

test('GET /api/events never returns cancelled events when filtering', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const seeded = await seedFilterApi(app, db);

  const cancelled = await request(app)
    .delete(`/api/events/${seeded.nov10}`)
    .set('Authorization', `Bearer ${seeded.organizer.token}`);
  assert.equal(cancelled.status, 200);
  assert.deepEqual(ids(await request(app).get('/api/events?from=2099-11-05&to=2099-11-15')), []);
  assert.deepEqual(ids(await request(app).get('/api/events?location=hall%20a')), [seeded.nov1]);
});

test('GET /api/events rejects invalid filters with 400 naming the field', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  await seedFilterApi(app, db);

  const cases = [
    ['from=not-a-date', ['from']],
    ['to=2099-13-01', ['to']],
    ['from=2099-02-30', ['from']],
    ['from=2099-11-20T10:00', ['from']],
    ['from=2099-11-15&to=2099-11-05', ['from']],
    ['from=bad&to=worse', ['from', 'to']],
    ['from=2099-11-01&from=2099-11-02', ['from']],
    [`location=${'x'.repeat(201)}`, ['location']],
    ['location=a&location=b', ['location']]
  ];
  for (const [query, expected] of cases) {
    const response = await request(app).get(`/api/events?${query}`);
    assert.equal(response.status, 400, query);
    assert.equal(response.body.error, 'Validation failed', query);
    assert.deepEqual(Object.keys(response.body.fields).sort(), expected, query);
  }
});

test('POST /api/events/:id/register verifies all EMRS-F-010 acceptance criteria', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'f10_org@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);

  const attendee1 = await createUser(app, { email: 'f10_att1@example.test' });
  const attendee2 = await createUser(app, { email: 'f10_att2@example.test' });

  // 1. Create event with capacity 1
  const eventRes = await createEvent(app, organizer.token, {
    title: 'F010 Workshop',
    capacity: 1
  });
  assert.equal(eventRes.status, 201);
  const eventId = eventRes.body.eventId;

  // Given logged out, then 401
  const unauthRes = await request(app).post(`/api/events/${eventId}/register`);
  assert.equal(unauthRes.status, 401);

  // Given seats left, then confirmed registration and ticket
  const reg1 = await request(app)
    .post(`/api/events/${eventId}/register`)
    .set('Authorization', `Bearer ${attendee1.token}`);
  assert.equal(reg1.status, 200);
  assert.equal(reg1.body.status, 'confirmed');
  assert.ok(reg1.body.ticketCode);
  assert.match(reg1.body.ticketCode, /^EMRS-[0-9a-f]{8}$/);

  // Given event full, then join waitlist
  const reg2 = await request(app)
    .post(`/api/events/${eventId}/register`)
    .set('Authorization', `Bearer ${attendee2.token}`);
  assert.equal(reg2.status, 200);
  assert.equal(reg2.body.status, 'waitlist');

  // Given already registered, then 409
  const dupRes = await request(app)
    .post(`/api/events/${eventId}/register`)
    .set('Authorization', `Bearer ${attendee1.token}`);
  assert.equal(dupRes.status, 409);
  assert.match(dupRes.body.error, /already registered/i);

  // Given a cancelled event, then 400
  const cancelEventRes = await request(app)
    .delete(`/api/events/${eventId}`)
    .set('Authorization', `Bearer ${organizer.token}`);
  assert.equal(cancelEventRes.status, 200);

  const regOnCancelled = await request(app)
    .post(`/api/events/${eventId}/register`)
    .set('Authorization', `Bearer ${attendee1.token}`);
  assert.equal(regOnCancelled.status, 400);
  assert.match(regOnCancelled.body.error, /cancelled/i);

  // Given a started event, then 400
  db.run(
    `INSERT INTO events (organizer_id, title, description, category, event_date, start_time, start_datetime, end_datetime, venue_type, venue, capacity, ticket_details, price, currency, tags, status, created_at)
     VALUES (?, 'Started Event', 'Desc', 'Meetup', '2020-01-01', '10:00:00', '2020-01-01T10:00:00Z', '2020-01-01T12:00:00Z', 'physical', 'Hall 2', 10, '[]', 0, 'INR', '[]', 'active', 1000)`,
    [organizer.user.id]
  );
  const pastId = db.get("SELECT id FROM events WHERE title = 'Started Event'").id;
  const regOnStarted = await request(app)
    .post(`/api/events/${pastId}/register`)
    .set('Authorization', `Bearer ${attendee1.token}`);
  assert.equal(regOnStarted.status, 400);
  assert.match(regOnStarted.body.error, /started/i);
});

test('DELETE /api/registrations/:id verifies all EMRS-F-011 acceptance criteria', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await createUser(app, { email: 'f11_org@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const attendee = await createUser(app, { email: 'f11_att@example.test' });
  const otherUser = await createUser(app, { email: 'f11_other@example.test' });

  const eventRes = await createEvent(app, organizer.token, {
    title: 'F011 Cancel Test Event',
    capacity: 5
  });
  assert.equal(eventRes.status, 201);
  const eventId = eventRes.body.eventId;

  const regRes = await request(app)
    .post(`/api/events/${eventId}/register`)
    .set('Authorization', `Bearer ${attendee.token}`);
  assert.equal(regRes.status, 200);
  const regId = regRes.body.registrationId;
  const ticketCode = regRes.body.ticketCode;

  // Given logged out, then 401
  const unauthCancel = await request(app).delete(`/api/registrations/${regId}`);
  assert.equal(unauthCancel.status, 401);

  // Given other user tries to cancel, then 404 (only own registration)
  const otherCancel = await request(app)
    .delete(`/api/registrations/${regId}`)
    .set('Authorization', `Bearer ${otherUser.token}`);
  assert.equal(otherCancel.status, 404);

  // Given I cancel before the event starts, then seat freed and ticket stops working
  const cancelRes = await request(app)
    .delete(`/api/registrations/${regId}`)
    .set('Authorization', `Bearer ${attendee.token}`);
  assert.equal(cancelRes.status, 200);

  // Ticket stops working: checking in the ticket code is now rejected
  const checkinRes = await request(app)
    .post('/api/tickets/checkin')
    .set('Authorization', `Bearer ${organizer.token}`)
    .send({ ticketCode });
  assert.equal(checkinRes.status, 400);
  assert.match(checkinRes.body.error, /cancelled/i);

  // Given the event has started, cannot cancel
  db.run(
    `INSERT INTO events (organizer_id, title, description, category, event_date, start_time, start_datetime, end_datetime, venue_type, venue, capacity, ticket_details, price, currency, tags, status, created_at)
     VALUES (?, 'Past Event For Cancel', 'Desc', 'Meetup', '2020-01-01', '10:00:00', '2020-01-01T10:00:00Z', '2020-01-01T12:00:00Z', 'physical', 'Room 4', 10, '[]', 0, 'INR', '[]', 'active', 1000)`,
    [organizer.user.id]
  );
  const pastEventId = db.get("SELECT id FROM events WHERE title = 'Past Event For Cancel'").id;
  const pastRegInsert = db.run(
    'INSERT INTO registrations (event_id, user_id, status, created_at) VALUES (?, ?, ?, ?)',
    [pastEventId, attendee.user.id, 'confirmed', 1000]
  );
  const pastRegId = Number(pastRegInsert.lastInsertRowid);

  const lateCancel = await request(app)
    .delete(`/api/registrations/${pastRegId}`)
    .set('Authorization', `Bearer ${attendee.token}`);
  assert.equal(lateCancel.status, 400);
  assert.match(lateCancel.body.error, /started/i);
});

test('Check-in verifies all EMRS-F-016 acceptance criteria', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const org1 = await createUser(app, { email: 'f16_org1@example.test' });
  const org2 = await createUser(app, { email: 'f16_org2@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', org1.user.id]);
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', org2.user.id]);

  const attendee = await createUser(app, { email: 'f16_att@example.test' });

  const eventRes = await createEvent(app, org1.token, {
    title: 'F016 Check-in Event',
    capacity: 10
  });
  assert.equal(eventRes.status, 201);
  const eventId = eventRes.body.eventId;

  const regRes = await request(app)
    .post(`/api/events/${eventId}/register`)
    .set('Authorization', `Bearer ${attendee.token}`);
  const ticketCode = regRes.body.ticketCode;

  // Given unauthenticated, then 401
  const unauthCheckin = await request(app)
    .post('/api/tickets/checkin')
    .send({ ticketCode });
  assert.equal(unauthCheckin.status, 401);

  // Given attendee role (not organizer), then 403
  const attendeeCheckin = await request(app)
    .post('/api/tickets/checkin')
    .set('Authorization', `Bearer ${attendee.token}`)
    .send({ ticketCode });
  assert.equal(attendeeCheckin.status, 403);

  // Given another organizer's event, then 403
  const otherOrgCheckin = await request(app)
    .post('/api/tickets/checkin')
    .set('Authorization', `Bearer ${org2.token}`)
    .send({ ticketCode });
  assert.equal(otherOrgCheckin.status, 403);
  assert.match(otherOrgCheckin.body.error, /organizer can check in/i);

  // Given an unknown ticket code, then 404
  const unknownCheckin = await request(app)
    .post('/api/tickets/checkin')
    .set('Authorization', `Bearer ${org1.token}`)
    .send({ ticketCode: 'EMRS-ffffffff' });
  assert.equal(unknownCheckin.status, 404);

  // Given a valid ticket and I am the organizer, attendee admitted & time recorded
  const successCheckin = await request(app)
    .post('/api/tickets/checkin')
    .set('Authorization', `Bearer ${org1.token}`)
    .send({ ticketCode });
  assert.equal(successCheckin.status, 200);
  assert.equal(successCheckin.body.eventTitle, 'F016 Check-in Event');

  // Given the same code again, then 409 already checked in
  const repeatCheckin = await request(app)
    .post('/api/tickets/checkin')
    .set('Authorization', `Bearer ${org1.token}`)
    .send({ ticketCode });
  assert.equal(repeatCheckin.status, 409);
  assert.match(repeatCheckin.body.error, /already been checked in/i);

  // Ticket validation endpoint GET /api/tickets/:code
  const validGet = await request(app)
    .get(`/api/tickets/${ticketCode}`)
    .set('Authorization', `Bearer ${org1.token}`);
  assert.equal(validGet.status, 200);
  assert.equal(validGet.body.checkedIn, true);
  assert.ok(validGet.body.checkedInAt > 0);

  // Other organizer cannot validate ticket: 403
  const otherGet = await request(app)
    .get(`/api/tickets/${ticketCode}`)
    .set('Authorization', `Bearer ${org2.token}`);
  assert.equal(otherGet.status, 403);
});

test('DELETE /api/events/:id cancels the event, registrations, tickets, and notifies all attendees once', async (t) => {
  const sentMessages = [];
  const mailer = { async sendMail(message) { sentMessages.push(message); } };
  const { app, db } = setup({
    mailer,
    publicAuthRateLimitOptions: {
      registration: { windowMs: 60_000, limit: 20 }
    }
  });
  t.after(() => db.close());

  const organizer = await createUser(app, { email: 'emt16-organizer@example.test' });
  const otherOrganizer = await createUser(app, { email: 'emt16-other-organizer@example.test' });
  db.run('UPDATE users SET role = ? WHERE id IN (?, ?)', [
    'Organizer',
    organizer.user.id,
    otherOrganizer.user.id
  ]);
  const attendees = [];
  for (let index = 1; index <= 5; index += 1) {
    attendees.push(await createUser(app, { email: `emt16-attendee-${index}@example.test` }));
  }
  const event = await createEvent(app, organizer.token, {
    title: 'EMT-16 Community Workshop',
    startDateTime: '2099-11-20T10:00:00',
    capacity: 3
  });
  assert.equal(event.status, 201);

  const registrations = [];
  for (const attendee of attendees) {
    const registration = await request(app)
      .post(`/api/events/${event.body.eventId}/register`)
      .set('Authorization', `Bearer ${attendee.token}`);
    assert.equal(registration.status, 200);
    registrations.push(registration.body);
  }
  assert.deepEqual(registrations.map(({ status }) => status), [
    'confirmed', 'confirmed', 'confirmed', 'waitlist', 'waitlist'
  ]);
  sentMessages.length = 0;

  const eventPath = `/api/events/${event.body.eventId}`;
  const unauthenticated = await request(app).delete(eventPath);
  assert.equal(unauthenticated.status, 401);

  const deniedOrganizer = await request(app)
    .delete(eventPath)
    .set('Authorization', `Bearer ${otherOrganizer.token}`);
  assert.equal(deniedOrganizer.status, 403);
  const deniedAttendee = await request(app)
    .delete(eventPath)
    .set('Authorization', `Bearer ${attendees[0].token}`);
  assert.equal(deniedAttendee.status, 403);
  assert.equal(db.get('SELECT status FROM events WHERE id = ?', [event.body.eventId]).status, 'Upcoming');
  assert.deepEqual(
    db.all('SELECT status FROM registrations WHERE event_id = ? ORDER BY id', [event.body.eventId])
      .map(({ status }) => status),
    ['confirmed', 'confirmed', 'confirmed', 'waitlist', 'waitlist']
  );
  assert.equal(db.get('SELECT COUNT(*) AS count FROM audit_logs').count, 0);
  assert.equal(sentMessages.length, 0);

  const cancelled = await request(app)
    .delete(eventPath)
    .set('Authorization', `Bearer ${organizer.token}`);
  assert.equal(cancelled.status, 200, cancelled.text);
  assert.equal(db.get('SELECT status FROM events WHERE id = ?', [event.body.eventId]).status, 'cancelled');
  assert.deepEqual(
    db.all('SELECT status FROM registrations WHERE event_id = ? ORDER BY id', [event.body.eventId])
      .map(({ status }) => status),
    ['cancelled', 'cancelled', 'cancelled', 'cancelled', 'cancelled']
  );
  assert.equal(sentMessages.length, 5);
  assert.deepEqual(
    sentMessages.map(({ to }) => to).sort(),
    attendees.map(({ user }) => user.email).sort()
  );
  for (const message of sentMessages) {
    assert.match(message.subject, /EMT-16 Community Workshop/);
    assert.match(message.text, /EMT-16 Community Workshop/);
    assert.match(message.text, /2099-11-20/);
  }

  const audit = db.get(
    'SELECT user_id, action, details FROM audit_logs ORDER BY id DESC LIMIT 1'
  );
  assert.equal(audit.user_id, organizer.user.id);
  assert.equal(audit.action, 'event_cancelled');
  assert.deepEqual(JSON.parse(audit.details), {
    eventId: event.body.eventId,
    title: 'EMT-16 Community Workshop'
  });

  const rejectedCheckIn = await request(app)
    .post('/api/tickets/checkin')
    .set('Authorization', `Bearer ${organizer.token}`)
    .send({ ticketCode: registrations[0].ticketCode });
  assert.equal(rejectedCheckIn.status, 400);
  assert.match(rejectedCheckIn.body.error, /cancelled/i);

  const repeatedCancellation = await request(app)
    .delete(eventPath)
    .set('Authorization', `Bearer ${organizer.token}`);
  assert.equal(repeatedCancellation.status, 409);
  assert.equal(sentMessages.length, 5);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM audit_logs').count, 1);
  assert.equal(
    db.get('SELECT COUNT(*) AS count FROM registrations WHERE event_id = ? AND status != ?', [
      event.body.eventId,
      'cancelled'
    ]).count,
    0
  );

  const registrationAfterCancellation = await request(app)
    .post(`${eventPath}/register`)
    .set('Authorization', `Bearer ${attendees[0].token}`);
  assert.equal(registrationAfterCancellation.status, 400);
  assert.match(registrationAfterCancellation.body.error, /cancelled/i);

  const startedEvent = await createEvent(app, organizer.token, {
    title: 'Already Started Workshop'
  });
  assert.equal(startedEvent.status, 201);
  db.run(
    `UPDATE events
     SET event_date = '2020-01-01', start_time = '10:00:00',
         start_datetime = '2020-01-01T10:00:00Z'
     WHERE id = ?`,
    [startedEvent.body.eventId]
  );
  const startedCancellation = await request(app)
    .delete(`/api/events/${startedEvent.body.eventId}`)
    .set('Authorization', `Bearer ${organizer.token}`);
  assert.equal(startedCancellation.status, 409);
  assert.equal(startedCancellation.body.error, 'Event has already started');
  assert.equal(db.get('SELECT status FROM events WHERE id = ?', [startedEvent.body.eventId]).status, 'Upcoming');
  assert.equal(db.get('SELECT COUNT(*) AS count FROM audit_logs').count, 1);
  assert.equal(sentMessages.length, 5);
});

test('DELETE /api/events/:id stays successful and logs individual mail failures', async (t) => {
  let failDelivery = false;
  const attempts = [];
  const mailer = {
    async sendMail(message) {
      attempts.push(message);
      if (failDelivery) throw new Error('SMTP unavailable');
    }
  };
  const { app, db } = setup({ mailer });
  t.after(() => db.close());

  const organizer = await createUser(app, { email: 'emt16-failure-organizer@example.test' });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  const attendee = await createUser(app, { email: 'emt16-failure-attendee@example.test' });
  const event = await createEvent(app, organizer.token, {
    title: 'Mail Failure Workshop',
    startDateTime: '2099-12-01T10:00:00',
    endDateTime: '2099-12-01T12:00:00',
    capacity: 1
  });
  const registration = await request(app)
    .post(`/api/events/${event.body.eventId}/register`)
    .set('Authorization', `Bearer ${attendee.token}`);
  assert.equal(registration.status, 200);
  attempts.length = 0;
  failDelivery = true;

  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const cancelled = await request(app)
      .delete(`/api/events/${event.body.eventId}`)
      .set('Authorization', `Bearer ${organizer.token}`);
    assert.equal(cancelled.status, 200);
  } finally {
    console.error = originalError;
  }
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].to, attendee.user.email);
  assert.deepEqual(logs, [['Email delivery failed']]);
  assert.equal(db.get('SELECT status FROM events WHERE id = ?', [event.body.eventId]).status, 'cancelled');
  assert.equal(
    db.get('SELECT status FROM registrations WHERE id = ?', [registration.body.registrationId]).status,
    'cancelled'
  );
  assert.equal(db.get('SELECT COUNT(*) AS count FROM audit_logs').count, 1);
});

test('DELETE /api/events/:id applies its protected-route rate limit before authentication', async (t) => {
  const { app, db } = setup({
    protectedRouteRateLimitOptions: { windowMs: 60_000, limit: 1 }
  });
  t.after(() => db.close());

  const first = await request(app).delete('/api/events/1');
  assert.equal(first.status, 401);
  const limited = await request(app).delete('/api/events/1');
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { error: 'Too many requests, please try again later.' });
});

// ---- Sprint 2 QA (EMT-33): edge cases found by exploratory testing ----

async function organizerFor(app, db, email = 'qa-organizer@example.test') {
  const organizer = await createUser(app, { email });
  db.run('UPDATE users SET role = ? WHERE id = ?', ['Organizer', organizer.user.id]);
  return organizer;
}
const registerFor = (app, eventId, user) => request(app)
  .post(`/api/events/${eventId}/register`)
  .set('Authorization', `Bearer ${user.token}`);

test('Sprint 2 QA: cancelling an event emails confirmed and waitlisted attendees but not people who already cancelled', async (t) => {
  const messages = [];
  const { app, db } = setup({ mailer: { async sendMail(message) { messages.push(message); } } });
  t.after(() => db.close());
  const organizer = await organizerFor(app, db);
  const event = await createEvent(app, organizer.token, { capacity: 1 });
  const confirmed = await createUser(app, { email: 'qa-confirmed@example.test' });
  const waitlisted = await createUser(app, { email: 'qa-waitlisted@example.test' });
  const leaver = await createUser(app, { email: 'qa-left@example.test' });
  const eventId = event.body.eventId;

  await registerFor(app, eventId, confirmed);
  await registerFor(app, eventId, waitlisted);
  const leaverRegistration = await registerFor(app, eventId, leaver);
  await request(app).delete(`/api/registrations/${leaverRegistration.body.registrationId}`)
    .set('Authorization', `Bearer ${leaver.token}`);

  messages.length = 0;
  const cancelled = await request(app).delete(`/api/events/${eventId}`).set('Authorization', `Bearer ${organizer.token}`);
  assert.equal(cancelled.status, 200, cancelled.text);
  assert.deepEqual(messages.map((message) => message.to).sort(), ['qa-confirmed@example.test', 'qa-waitlisted@example.test']);
  assert.deepEqual(db.all('SELECT status FROM registrations ORDER BY id').map((row) => row.status), ['cancelled', 'cancelled', 'cancelled']);
});

test('Sprint 2 QA: an organizer can lower capacity to exactly the confirmed count but not below it', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await organizerFor(app, db);
  const event = await createEvent(app, organizer.token, { capacity: 5 });
  for (const email of ['qa-a@example.test', 'qa-b@example.test']) {
    assert.equal((await registerFor(app, event.body.eventId, await createUser(app, { email }))).status, 200);
  }
  assert.equal((await updateEvent(app, event.body.eventId, organizer.token, { capacity: 1 })).status, 400);
  assert.equal((await updateEvent(app, event.body.eventId, organizer.token, { capacity: 2 })).status, 200);
  assert.equal(db.get('SELECT capacity FROM events WHERE id = ?', [event.body.eventId]).capacity, 2);
});

test('Sprint 2 QA: the "to" date of a search includes an event that starts late that evening', async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await organizerFor(app, db);
  const late = await createEvent(app, organizer.token, { startDateTime: '2099-11-10T23:30', endDateTime: '2099-11-11T01:00' });
  assert.equal(late.status, 201, late.text);
  const response = await request(app).get('/api/events?from=2099-11-10&to=2099-11-10');
  assert.deepEqual(response.body.events.map((event) => event.id), [late.body.eventId]);
});

test('Sprint 2 QA: concurrent clicks on one verification link verify once and reject the rest', async (t) => {
  const messages = [];
  const { app, db } = setup({ mailer: { async sendMail(message) { messages.push(message); } } });
  t.after(() => db.close());
  await request(app).post('/api/auth/register').send(REGISTRATION);
  const token = tokenFromEmail(messages[0]);
  const responses = await Promise.all([verifyEmail(app, token), verifyEmail(app, token), verifyEmail(app, token)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400, 400]);
  assert.equal(db.get('SELECT email_verified FROM users').email_verified, 1);
});

// Known defects (see docs/Sprint_2_Test_Plan.md section 7). These describe the expected behaviour and are
// marked `todo` so they are reported but do not fail the build. Remove `todo` when the defect is fixed.

test('BUG-S2-01: raising an event\'s capacity promotes waitlisted attendees (EMRS-F-012)', { todo: 'defect: not implemented' }, async (t) => {
  const { app, db } = setup();
  t.after(() => db.close());
  const organizer = await organizerFor(app, db);
  const event = await createEvent(app, organizer.token, { capacity: 1 });
  await registerFor(app, event.body.eventId, await createUser(app, { email: 'bug1-a@example.test' }));
  const waitlisted = await registerFor(app, event.body.eventId, await createUser(app, { email: 'bug1-b@example.test' }));
  assert.equal(waitlisted.body.status, 'waitlist');

  assert.equal((await updateEvent(app, event.body.eventId, organizer.token, { capacity: 5 })).status, 200);
  assert.deepEqual(db.all('SELECT status FROM registrations ORDER BY id').map((row) => row.status), ['confirmed', 'confirmed']);
});

test('BUG-S2-02: a promoted waitlisted attendee is emailed with their ticket code (EMRS-F-012, EMT-52 AC3)', { todo: 'defect: not implemented' }, async (t) => {
  const messages = [];
  const { app, db } = setup({ mailer: { async sendMail(message) { messages.push(message); } } });
  t.after(() => db.close());
  const organizer = await organizerFor(app, db);
  const event = await createEvent(app, organizer.token, { capacity: 1 });
  const first = await createUser(app, { email: 'bug2-first@example.test' });
  const second = await createUser(app, { email: 'bug2-second@example.test' });
  const firstRegistration = await registerFor(app, event.body.eventId, first);
  await registerFor(app, event.body.eventId, second);

  messages.length = 0;
  await request(app).delete(`/api/registrations/${firstRegistration.body.registrationId}`)
    .set('Authorization', `Bearer ${first.token}`);
  const ticket = db.get("SELECT ticket_code FROM registrations WHERE status = 'confirmed'").ticket_code;
  const promotion = messages.find((message) => message.to === 'bug2-second@example.test');
  assert.ok(promotion, 'the promoted attendee should receive an email');
  assert.match(promotion.text, new RegExp(ticket));
});

test('BUG-S2-03: a waitlisted registration email says "waitlisted", not "confirmed" (EMT-52 AC2)', { todo: 'defect: not implemented' }, async (t) => {
  const messages = [];
  const { app, db } = setup({ mailer: { async sendMail(message) { messages.push(message); } } });
  t.after(() => db.close());
  const organizer = await organizerFor(app, db);
  const event = await createEvent(app, organizer.token, { capacity: 1 });
  await registerFor(app, event.body.eventId, await createUser(app, { email: 'bug3-a@example.test' }));
  messages.length = 0;
  const waitlisted = await registerFor(app, event.body.eventId, await createUser(app, { email: 'bug3-b@example.test' }));
  assert.equal(waitlisted.body.status, 'waitlist');
  const email = messages.find((message) => message.to === 'bug3-b@example.test');
  assert.ok(email, 'the waitlisted attendee should receive an email');
  assert.match(email.text, /waitlisted/i);
  assert.doesNotMatch(email.text, /is confirmed/i);
});
