import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Database } from '../src/db/database.js';
import { AuthService } from '../src/services/auth.js';
import { EventService } from '../src/services/events.js';
import { RegistrationService } from '../src/services/registrations.js';
import { ReminderService } from '../src/services/reminders.js';
import { createMailer } from '../src/services/mailer.js';

test('EMT-47: Cancellation confirmation email and event reminders with controllable clock', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const mailer = createMailer({ transport: 'memory' });
  let currentSec = 1767225600; // 2026-01-01T00:00:00Z
  const clock = () => currentSec;
  const jwtSecret = 'test-jwt-secret-for-reminders-32ch';

  const app = createApp({ db, clock, mailer, jwtSecret, passwordCost: 4 });
  const auth = new AuthService(db, { clock, cost: 4, jwtSecret });
  const events = new EventService(db, clock);
  const registrations = new RegistrationService(db, clock);
  const reminders = new ReminderService(db, mailer, clock);

  // Setup accounts
  const org = auth.register({ name: 'Organizer', email: 'org@test.com', password: 'Password123', role: 'Organizer' });
  db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [org.id]);

  const attendee = auth.register({ name: 'Attendee Alice', email: 'alice@test.com', password: 'Password123', role: 'Attendee' });
  db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [attendee.id]);
  const aliceToken = auth.login('alice@test.com', 'Password123').token;

  const attendeeBob = auth.register({ name: 'Attendee Bob', email: 'bob@test.com', password: 'Password123', role: 'Attendee' });
  db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [attendeeBob.id]);

  // Event 1: starts in 48 hours (no reminder due yet)
  const event1Start = new Date((currentSec + 48 * 3600) * 1000).toISOString();
  const event1Id = events.create(org.id, {
    title: 'Future Summit',
    description: 'Summit details',
    category: 'Conference',
    startDateTime: event1Start,
    endDateTime: new Date((currentSec + 52 * 3600) * 1000).toISOString(),
    venueType: 'Physical',
    venue: 'Hall 1',
    capacity: 10,
    ticketTypes: [{ name: 'Standard', price: 0, quantity: 10 }]
  });

  // Event 2: starts in 23 hours (reminder IS due!)
  const event2Start = new Date((currentSec + 23 * 3600) * 1000).toISOString();
  const event2Id = events.create(org.id, {
    title: 'Tomorrow Tech Talk',
    description: 'Talk details',
    category: 'Tech',
    startDateTime: event2Start,
    endDateTime: new Date((currentSec + 25 * 3600) * 1000).toISOString(),
    venueType: 'Physical',
    venue: 'Auditorium B',
    capacity: 10,
    ticketTypes: [{ name: 'Standard', price: 0, quantity: 10 }]
  });

  // Alice registers for Event 1 and Event 2
  const reg1 = registrations.register(event1Id, attendee.id);
  const reg2 = registrations.register(event2Id, attendee.id);
  // Bob registers for Event 2
  const regBob = registrations.register(event2Id, attendeeBob.id);
  assert.equal(reg1.result, 'confirmed');
  assert.equal(reg2.result, 'confirmed');
  assert.equal(regBob.result, 'confirmed');

  mailer.clear();

  // 1. Acceptance Criteria: Given I cancel my registration, then I receive one confirmation email
  const cancelRes = await request(app)
    .delete(`/api/registrations/${reg1.registrationId}`)
    .set('Authorization', `Bearer ${aliceToken}`)
    .expect(200);

  assert.equal(cancelRes.body.message, 'Registration cancelled successfully');

  const cancelMails = mailer.getSentMessages().filter((m) => m.subject.includes('Registration cancelled'));
  assert.equal(cancelMails.length, 1);
  assert.equal(cancelMails[0].to, 'alice@test.com');
  assert.match(cancelMails[0].text, /Future Summit/);

  // 2. Acceptance Criteria: Given an event starts in 23 hours, then each confirmed attendee receives one reminder
  mailer.clear();
  const sentReminders = await reminders.sendDueReminders();
  assert.equal(sentReminders.length, 2); // Alice and Bob for Event 2

  const reminderMails = mailer.getSentMessages();
  assert.equal(reminderMails.length, 2);
  const recipients = reminderMails.map((m) => m.to).sort();
  assert.deepEqual(recipients, ['alice@test.com', 'bob@test.com']);
  assert.match(reminderMails[0].subject, /Reminder: Upcoming event/);
  assert.match(reminderMails[0].text, /Tomorrow Tech Talk/);

  // 3. Acceptance Criteria: Never a second reminder
  mailer.clear();
  const secondRun = await reminders.sendDueReminders();
  assert.equal(secondRun.length, 0);
  assert.equal(mailer.getSentMessages().length, 0);

  // 4. Acceptance Criteria: Given a cancelled event or cancelled registration, no reminder is sent
  // Create Event 3 starting in 20 hours
  const event3Start = new Date((currentSec + 20 * 3600) * 1000).toISOString();
  const event3Id = events.create(org.id, {
    title: 'Cancelled Event 3',
    description: 'Will be cancelled',
    category: 'Conference',
    startDateTime: event3Start,
    endDateTime: new Date((currentSec + 22 * 3600) * 1000).toISOString(),
    venueType: 'Physical',
    venue: 'Hall 3',
    capacity: 10,
    ticketTypes: [{ name: 'Standard', price: 0, quantity: 10 }]
  });
  const reg3 = registrations.register(event3Id, attendee.id);
  assert.equal(reg3.result, 'confirmed');

  // Cancel the event
  events.cancel(event3Id, { id: org.id, role: 'Organizer' });
  mailer.clear();

  const cancelEventReminders = await reminders.sendDueReminders();
  assert.equal(cancelEventReminders.length, 0);
  assert.equal(mailer.getSentMessages().length, 0);

  // 5. Acceptance Criteria: Given the mail server is down, action still succeeds and failure is logged
  const brokenMailer = {
    async sendMail() {
      throw new Error('SMTP connection refused: connection timed out');
    }
  };
  const appBrokenMail = createApp({ db, clock, mailer: brokenMailer, jwtSecret, passwordCost: 4 });

  // Alice registers for another event
  const event4Start = new Date((currentSec + 40 * 3600) * 1000).toISOString();
  const event4Id = events.create(org.id, {
    title: 'Broken Mail Event',
    description: 'Testing down mailer',
    category: 'Conference',
    startDateTime: event4Start,
    endDateTime: new Date((currentSec + 42 * 3600) * 1000).toISOString(),
    venueType: 'Physical',
    venue: 'Hall 4',
    capacity: 10,
    ticketTypes: [{ name: 'Standard', price: 0, quantity: 10 }]
  });
  const reg4 = registrations.register(event4Id, attendee.id);

  // Cancel registration with broken mailer -> API request must still succeed with 200
  const cancelWithBrokenMail = await request(appBrokenMail)
    .delete(`/api/registrations/${reg4.registrationId}`)
    .set('Authorization', `Bearer ${aliceToken}`)
    .expect(200);

  assert.equal(cancelWithBrokenMail.body.message, 'Registration cancelled successfully');
});
