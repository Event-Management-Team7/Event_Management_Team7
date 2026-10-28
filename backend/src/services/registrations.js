import { randomBytes } from 'node:crypto';

function issueTicket(db, registrationId, eventId, userId) {
  const code = `EMRS-${randomBytes(4).toString('hex')}`;
  const qrData = `TICKET:${code}:EVENT:${eventId}:USER:${userId}`;
  db.run(
    `INSERT INTO tickets (registration_id, ticket_code, qr_data, checked_in, checked_in_at)
     VALUES (?, ?, ?, 0, 0)
     ON CONFLICT(registration_id) DO UPDATE SET
       ticket_code = excluded.ticket_code,
       qr_data = excluded.qr_data,
       checked_in = 0,
       checked_in_at = 0`,
    [registrationId, code, qrData]
  );
  return code;
}

export class RegistrationService {
  constructor(db, clock = () => Math.floor(Date.now() / 1000)) {
    this.db = db;
    this.clock = clock;
  }

  register(eventId, userId) {
    return this.db.transaction(() => {
      const event = this.db.get(
        `SELECT capacity, status, title, event_date, start_time, start_datetime
         FROM events WHERE id = ?`,
        [eventId]
      );
      if (!event) return { result: 'not-found' };
      if (event.status === 'cancelled') return { result: 'event-cancelled' };

      const existing = this.db.get(
        'SELECT id, status FROM registrations WHERE event_id = ? AND user_id = ?',
        [eventId, userId]
      );
      if (existing && existing.status !== 'cancelled') return { result: 'already-registered' };

      const count = this.db.get(
        "SELECT COUNT(*) AS count FROM registrations WHERE event_id = ? AND status = 'confirmed'",
        [eventId]
      ).count;
      const status = count < event.capacity ? 'confirmed' : 'waitlist';
      const now = this.clock();
      let registrationId;
      if (existing) {
        registrationId = existing.id;
        this.db.run('UPDATE registrations SET status = ?, created_at = ? WHERE id = ?', [
          status,
          now,
          registrationId
        ]);
      } else {
        const insert = this.db.run(
          'INSERT INTO registrations (event_id, user_id, status, created_at) VALUES (?, ?, ?, ?)',
          [eventId, userId, status, now]
        );
        registrationId = Number(insert.lastInsertRowid);
      }

      if (status === 'confirmed') {
        const attendee = this.db.get('SELECT email FROM users WHERE id = ?', [userId]);
        return {
          result: status,
          registrationId,
          ticketCode: issueTicket(this.db, registrationId, eventId, userId),
          email: attendee.email,
          eventTitle: event.title,
          eventDateTime: event.start_datetime || (
            event.start_time ? `${event.event_date}T${event.start_time}` : event.event_date
          )
        };
      }
      return { result: status, registrationId };
    });
  }

  cancel(registrationId, userId) {
    return this.db.transaction(() => {
      const registration = this.db.get(
        'SELECT event_id, status FROM registrations WHERE id = ? AND user_id = ?',
        [registrationId, userId]
      );
      if (!registration || registration.status === 'cancelled') return false;

      this.db.run("UPDATE registrations SET status = 'cancelled' WHERE id = ?", [registrationId]);
      this.db.run('DELETE FROM tickets WHERE registration_id = ?', [registrationId]);
      if (registration.status === 'confirmed') {
        const next = this.db.get(
          `SELECT id, user_id FROM registrations
           WHERE event_id = ? AND status = 'waitlist'
           ORDER BY created_at ASC, id ASC LIMIT 1`,
          [registration.event_id]
        );
        if (next) {
          this.db.run("UPDATE registrations SET status = 'confirmed' WHERE id = ?", [next.id]);
          issueTicket(this.db, next.id, registration.event_id, next.user_id);
        }
      }
      return true;
    });
  }

  listUser(userId) {
    return this.db.all(
      `SELECT r.id, r.event_id, r.status, r.created_at, e.title AS event_title,
              COALESCE(t.ticket_code, '') AS ticket_code
       FROM registrations r
       JOIN events e ON r.event_id = e.id
       LEFT JOIN tickets t ON t.registration_id = r.id
       WHERE r.user_id = ? AND r.status != 'cancelled'
       ORDER BY r.created_at DESC, r.id DESC`,
      [userId]
    ).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventTitle: row.event_title,
      status: row.status,
      ticketCode: row.ticket_code,
      createdAt: row.created_at
    }));
  }
}
