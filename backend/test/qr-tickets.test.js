import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { createApp } from '../src/app.js';
import { Database } from '../src/db/database.js';
import { AuthService } from '../src/services/auth.js';
import { EventService } from '../src/services/events.js';
import { RegistrationService } from '../src/services/registrations.js';
import { createMailer } from '../src/services/mailer.js';

function decodeQrPng(buffer) {
  const png = PNG.sync.read(buffer);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return result ? result.data : null;
}

test('EMT-40: QR code e-ticket image generation, access rules, and check-in', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const mailer = createMailer({ transport: 'memory' });
  const jwtSecret = 'test-jwt-secret-for-qr-verification-32ch';
  const app = createApp({ db, passwordCost: 4, mailer, jwtSecret });
  const auth = new AuthService(db, { cost: 4, jwtSecret });
  const events = new EventService(db);
  const registrations = new RegistrationService(db);

  // Setup users
  const org = auth.register({ name: 'Organizer One', email: 'org1@test.com', password: 'Password123', role: 'Organizer' });
  db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [org.id]);
  const orgToken = auth.login('org1@test.com', 'Password123').token;

  const attendee1 = auth.register({ name: 'Attendee One', email: 'att1@test.com', password: 'Password123', role: 'Attendee' });
  db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [attendee1.id]);
  const att1Token = auth.login('att1@test.com', 'Password123').token;

  const attendee2 = auth.register({ name: 'Attendee Two', email: 'att2@test.com', password: 'Password123', role: 'Attendee' });
  db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [attendee2.id]);
  const att2Token = auth.login('att2@test.com', 'Password123').token;

  auth.provisionUser({ name: 'Admin User', email: 'admin@test.com', password: 'Password123', role: 'Admin' });
  const adminToken = auth.login('admin@test.com', 'Password123').token;

  // Create event
  const eventId = events.create(org.id, {
    title: 'Web Dev Conference 2026',
    description: 'Conference details',
    category: 'Conference',
    startDateTime: '2026-12-01T10:00:00Z',
    endDateTime: '2026-12-01T18:00:00Z',
    venueType: 'Physical',
    venue: 'Convention Center',
    capacity: 50,
    ticketTypes: [{ name: 'Standard', price: 0, quantity: 50 }]
  });

  // Register attendee 1 and attendee 2
  const reg1 = registrations.register(eventId, attendee1.id);
  const reg2 = registrations.register(eventId, attendee2.id);
  assert.equal(reg1.result, 'confirmed');
  assert.equal(reg2.result, 'confirmed');
  assert.ok(reg1.ticketCode);
  assert.ok(reg2.ticketCode);
  assert.notEqual(reg1.ticketCode, reg2.ticketCode);

  // 1. Given a confirmed registration, attendee can download QR image that decodes to their ticket code
  const res1 = await request(app)
    .get(`/api/tickets/${reg1.ticketCode}/qr`)
    .set('Authorization', `Bearer ${att1Token}`)
    .expect(200);

  assert.equal(res1.headers['content-type'], 'image/png');
  const decoded1 = decodeQrPng(res1.body);
  assert.equal(decoded1, reg1.ticketCode);

  // 2. Given two registrations, their QR codes are different
  const res2 = await request(app)
    .get(`/api/tickets/${reg2.ticketCode}/qr`)
    .set('Authorization', `Bearer ${att2Token}`)
    .expect(200);

  const decoded2 = decodeQrPng(res2.body);
  assert.equal(decoded2, reg2.ticketCode);
  assert.notEqual(decoded1, decoded2);
  assert.notDeepEqual(res1.body, res2.body);

  // 3. Organizer of the event can also view/download attendee's QR
  const resOrg = await request(app)
    .get(`/api/tickets/${reg1.ticketCode}/qr`)
    .set('Authorization', `Bearer ${orgToken}`)
    .expect(200);
  assert.equal(decodeQrPng(resOrg.body), reg1.ticketCode);

  // 4. Admin can also view/download attendee's QR
  const resAdmin = await request(app)
    .get(`/api/tickets/${reg1.ticketCode}/qr`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.equal(decodeQrPng(resAdmin.body), reg1.ticketCode);

  // 5. Given someone else's ticket code, attendee gets 403 Forbidden
  await request(app)
    .get(`/api/tickets/${reg1.ticketCode}/qr`)
    .set('Authorization', `Bearer ${att2Token}`)
    .expect(403);

  // 6. Unauthenticated request gets 401 Unauthorized
  await request(app)
    .get(`/api/tickets/${reg1.ticketCode}/qr`)
    .expect(401);

  // 7. Unknown ticket code returns 404 Not Found
  await request(app)
    .get('/api/tickets/UNKNOWN-CODE-999/qr')
    .set('Authorization', `Bearer ${att1Token}`)
    .expect(404);

  // 8. Cancelled registration returns 400 Bad Request (no QR available)
  registrations.cancel(reg1.registrationId, attendee1.id);
  await request(app)
    .get(`/api/tickets/${reg1.ticketCode}/qr`)
    .set('Authorization', `Bearer ${att1Token}`)
    .expect(400);

  // 9. Cancelled event returns 400 Bad Request
  events.cancel(eventId, { id: org.id, role: 'Organizer' });
  await request(app)
    .get(`/api/tickets/${reg2.ticketCode}/qr`)
    .set('Authorization', `Bearer ${att2Token}`)
    .expect(400);

  // 10. Check-in with decoded QR value into check-in endpoint
  // Create another event and registration to test check-in flow
  const eventId2 = events.create(org.id, {
    title: 'Check-in Test Event',
    description: 'Event for testing check-in',
    category: 'Workshop',
    startDateTime: '2026-12-10T14:00:00Z',
    endDateTime: '2026-12-10T16:00:00Z',
    venueType: 'Physical',
    venue: 'Room 101',
    capacity: 20,
    ticketTypes: [{ name: 'Standard', price: 0, quantity: 20 }]
  });
  const reg3 = registrations.register(eventId2, attendee1.id);
  const qrRes = await request(app)
    .get(`/api/tickets/${reg3.ticketCode}/qr`)
    .set('Authorization', `Bearer ${att1Token}`)
    .expect(200);

  const scannedCode = decodeQrPng(qrRes.body);
  assert.equal(scannedCode, reg3.ticketCode);

  // Organizer checks in attendee using the scanned code
  const checkInRes = await request(app)
    .post('/api/tickets/checkin')
    .set('Authorization', `Bearer ${orgToken}`)
    .send({ ticketCode: scannedCode })
    .expect(200);

  assert.equal(checkInRes.body.message, 'Check-in successful!');

  // Second scan returns 409 Conflict (already checked in)
  await request(app)
    .post('/api/tickets/checkin')
    .set('Authorization', `Bearer ${orgToken}`)
    .send({ ticketCode: scannedCode })
    .expect(409);
});
