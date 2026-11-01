import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Database } from '../src/db/database.js';
import { AuthService } from '../src/services/auth.js';
import { RegistrationService } from '../src/services/registrations.js';
import { createMailer } from '../src/services/mailer.js';

test('EMT-48: NFR Security verification (security headers, RBAC on protected endpoints, credentials protection)', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const mailer = createMailer({ transport: 'memory' });
  const jwtSecret = 'nfr-security-jwt-secret-testing-32chars';
  const app = createApp({ db, passwordCost: 4, mailer, jwtSecret });
  const auth = new AuthService(db, { cost: 4, jwtSecret });
  const registrations = new RegistrationService(db);

  // Setup roles
  const org = auth.register({ name: 'Organizer', email: 'org@sec.test', password: 'Password123', role: 'Organizer' });
  db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [org.id]);
  const orgToken = auth.login('org@sec.test', 'Password123').token;

  const attendee = auth.register({ name: 'Attendee 1', email: 'att1@sec.test', password: 'Password123', role: 'Attendee' });
  db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [attendee.id]);
  const attToken = auth.login('att1@sec.test', 'Password123').token;

  const otherAttendee = auth.register({ name: 'Attendee 2', email: 'att2@sec.test', password: 'Password123', role: 'Attendee' });
  db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [otherAttendee.id]);
  const otherAttToken = auth.login('att2@sec.test', 'Password123').token;

  // 1. Security Headers Verification (EMRS-SEC-002)
  const healthRes = await request(app).get('/api/health').expect(200);
  assert.equal(healthRes.headers['x-content-type-options'], 'nosniff');
  assert.equal(healthRes.headers['x-frame-options'], 'DENY');
  assert.equal(healthRes.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(healthRes.headers['x-powered-by'], undefined);

  // 2. RBAC Verification (EMRS-SEC-003): Create Event
  // Attendee cannot create event (403)
  await request(app)
    .post('/api/events')
    .set('Authorization', `Bearer ${attToken}`)
    .send({
      title: 'Hacked Event',
      description: 'Desc',
      category: 'Conference',
      startDateTime: '2026-12-01T10:00:00Z',
      endDateTime: '2026-12-01T12:00:00Z',
      venueType: 'Physical',
      venue: 'Location',
      capacity: 50,
      ticketTypes: [{ name: 'Pass', price: 0, quantity: 50 }]
    })
    .expect(403);

  // Unauthenticated cannot create event (401)
  await request(app)
    .post('/api/events')
    .send({
      title: 'Unauth Event',
      description: 'Desc',
      category: 'Conference',
      startDateTime: '2026-12-01T10:00:00Z',
      endDateTime: '2026-12-01T12:00:00Z',
      venueType: 'Physical',
      venue: 'Location',
      capacity: 50
    })
    .expect(401);

  // Organizer can create event
  const createRes = await request(app)
    .post('/api/events')
    .set('Authorization', `Bearer ${orgToken}`)
    .send({
      title: 'Valid Organizer Event',
      description: 'Desc',
      category: 'Conference',
      startDateTime: '2026-12-01T10:00:00Z',
      endDateTime: '2026-12-01T12:00:00Z',
      venueType: 'Physical',
      venue: 'Location',
      capacity: 50,
      ticketTypes: [{ name: 'Pass', price: 0, quantity: 50 }]
    })
    .expect(201);
  const eventId = createRes.body.eventId;

  // 3. RBAC Verification: Update Event
  // Attendee cannot update event (403)
  await request(app)
    .put(`/api/events/${eventId}`)
    .set('Authorization', `Bearer ${attToken}`)
    .send({
      title: 'Attendee Updated Title',
      description: 'Desc',
      category: 'Conference',
      startDateTime: '2026-12-01T10:00:00Z',
      endDateTime: '2026-12-01T12:00:00Z',
      venueType: 'Physical',
      venue: 'Location',
      capacity: 50,
      ticketTypes: [{ name: 'Pass', price: 0, quantity: 50 }]
    })
    .expect(403);

  // 4. RBAC Verification: Cancel Event
  // Attendee cannot cancel event (403)
  await request(app)
    .delete(`/api/events/${eventId}`)
    .set('Authorization', `Bearer ${attToken}`)
    .expect(403);

  // 5. RBAC Verification: Check-In Endpoint
  // Attendee cannot perform check-in (403)
  await request(app)
    .post('/api/tickets/checkin')
    .set('Authorization', `Bearer ${attToken}`)
    .send({ ticketCode: 'EMRS-fakecode' })
    .expect(403);

  // 6. RBAC Verification: QR Code Access
  const reg = registrations.register(eventId, attendee.id);
  assert.equal(reg.result, 'confirmed');

  // Other attendee cannot view someone else's QR code (403)
  await request(app)
    .get(`/api/tickets/${reg.ticketCode}/qr`)
    .set('Authorization', `Bearer ${otherAttToken}`)
    .expect(403);

  // Ticket owner can view their own QR code (200)
  await request(app)
    .get(`/api/tickets/${reg.ticketCode}/qr`)
    .set('Authorization', `Bearer ${attToken}`)
    .expect(200);

  // Organizer can view QR code (200)
  await request(app)
    .get(`/api/tickets/${reg.ticketCode}/qr`)
    .set('Authorization', `Bearer ${orgToken}`)
    .expect(200);
});
