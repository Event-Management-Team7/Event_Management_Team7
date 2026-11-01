import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Database } from '../src/db/database.js';
import { seedDemoData } from '../src/db/seed.js';

test('EMT-49: Demo data seed script creates required accounts/events and can be re-run safely', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());

  // 1. Initial run
  const firstResult = seedDemoData(db);
  assert.ok(firstResult.admin);
  assert.ok(firstResult.organizer);
  assert.ok(firstResult.attendee1);
  assert.ok(firstResult.attendee2);

  // Verify accounts in DB
  const users = db.all('SELECT id, email, role, email_verified FROM users ORDER BY email ASC');
  assert.equal(users.length, 4);
  assert.deepEqual(
    users.map((u) => ({ email: u.email, role: u.role, verified: u.email_verified })),
    [
      { email: 'admin@emrs.test', role: 'Admin', verified: 1 },
      { email: 'attendee1@emrs.test', role: 'Attendee', verified: 1 },
      { email: 'attendee2@emrs.test', role: 'Attendee', verified: 1 },
      { email: 'organizer@emrs.test', role: 'Organizer', verified: 1 }
    ]
  );

  // Verify events in DB
  const events = db.all('SELECT id, title, price, status, capacity FROM events ORDER BY id ASC');
  assert.equal(events.length, 5);

  const freeEvent = events.find((e) => e.title.includes('Tech Innovators Summit'));
  assert.ok(freeEvent);
  assert.equal(freeEvent.price, 0);
  assert.equal(freeEvent.status, 'Upcoming');

  const paidEvent = events.find((e) => e.title.includes('Cloud Architecture'));
  assert.ok(paidEvent);
  assert.equal(paidEvent.price, 499);
  assert.equal(paidEvent.status, 'Upcoming');

  const fullEvent = events.find((e) => e.title.includes('Hands-on DevOps'));
  assert.ok(fullEvent);
  assert.equal(fullEvent.capacity, 1);
  assert.equal(fullEvent.status, 'Upcoming');

  // Verify registrations on full event: attendee1 confirmed, attendee2 waitlisted
  const fullRegs = db.all(
    'SELECT user_id, status FROM registrations WHERE event_id = ? ORDER BY id ASC',
    [fullEvent.id]
  );
  assert.equal(fullRegs.length, 2);
  assert.equal(fullRegs[0].status, 'confirmed');
  assert.equal(fullRegs[1].status, 'waitlist');

  const cancelledEvent = events.find((e) => e.title.includes('Legacy Systems Modernization'));
  assert.ok(cancelledEvent);
  assert.equal(cancelledEvent.status, 'cancelled');

  const pastEvent = events.find((e) => e.title.includes('Spring 2026 Developer Kickoff'));
  assert.ok(pastEvent);

  // 2. Acceptance criteria: The seed script can be re-run safely (idempotent)
  assert.doesNotThrow(() => {
    seedDemoData(db);
  });

  // Verify counts didn't duplicate
  const usersAfterSecondRun = db.all('SELECT id FROM users');
  assert.equal(usersAfterSecondRun.length, 4);

  const eventsAfterSecondRun = db.all('SELECT id FROM events');
  assert.equal(eventsAfterSecondRun.length, 5);
});

test('EMT-49: Static web assets and SPA fallback with health probes', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emrs-web-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tempDir, 'index.html'), '<!DOCTYPE html><html><body>EMRS App</body></html>');
  fs.writeFileSync(path.join(tempDir, 'test.txt'), 'hello static');

  const app = createApp({ db, webDir: tempDir });

  // 1. Health check returns 200
  const health = await request(app).get('/api/health').expect(200);
  assert.equal(health.body.status, 'ok');

  // 2. Static file serves
  const staticFile = await request(app).get('/test.txt').expect(200);
  assert.equal(staticFile.text, 'hello static');

  // 3. SPA fallback on non-api GET route serves index.html
  const spa = await request(app).get('/dashboard/events').expect(200);
  assert.match(spa.text, /EMRS App/);

  // 4. API 404 does not serve index.html
  await request(app).get('/api/nonexistent').expect(404);
});
