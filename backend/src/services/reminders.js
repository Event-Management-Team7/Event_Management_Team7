import { sendMailSafely } from './mailer.js';

export class ReminderService {
  constructor(db, mailer, clock = () => Math.floor(Date.now() / 1000)) {
    this.db = db;
    this.mailer = mailer;
    this.clock = clock;
    this.timer = null;
  }

  async sendDueReminders() {
    const nowSec = this.clock();
    const windowSec = 24 * 3600;

    const candidates = this.db.all(
      `SELECT r.id AS registration_id, r.user_id, u.email, u.name AS attendee_name,
              e.id AS event_id, e.title AS event_title, e.start_datetime, e.event_date,
              e.start_time, e.venue, e.status AS event_status, r.status AS registration_status
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       JOIN events e ON e.id = r.event_id
       WHERE r.status = 'confirmed'
         AND e.status != 'cancelled'
         AND NOT EXISTS (
           SELECT 1 FROM audit_logs a
           WHERE a.action = 'event_reminder_sent'
             AND a.details = 'registration:' || r.id
         )`
    );

    const sent = [];
    for (const item of candidates) {
      const iso = item.start_datetime || (
        item.start_time ? `${item.event_date}T${item.start_time}` : item.event_date
      );
      const startMs = Date.parse(iso);
      if (Number.isNaN(startMs)) continue;
      const startSec = Math.floor(startMs / 1000);

      // Event is scheduled within 24 hours from now (e.g. 23 hours ahead)
      if (startSec > nowSec && startSec <= nowSec + windowSec) {
        this.db.run(
          'INSERT INTO audit_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)',
          [item.user_id, 'event_reminder_sent', `registration:${item.registration_id}`, nowSec]
        );

        if (this.mailer) {
          await sendMailSafely(this.mailer, {
            to: item.email,
            subject: `Reminder: Upcoming event "${item.event_title}"`,
            text: [
              `Hello ${item.attendee_name},`,
              `This is a reminder that the event "${item.event_title}" starts in less than 24 hours.`,
              `Event date: ${iso}`,
              `Venue: ${item.venue}`,
              'We look forward to seeing you there!'
            ].join('\n')
          });
        }
        sent.push(item);
      }
    }
    return sent;
  }

  start(intervalMs = 15 * 60 * 1000) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.sendDueReminders().catch((err) => {
        console.error('Error sending event reminders:', err);
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
