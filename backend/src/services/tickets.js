export class TicketService {
  constructor(db, clock = () => Math.floor(Date.now() / 1000)) {
    this.db = db;
    this.clock = clock;
  }

  getByCode(code) {
    return this.db.get(
      `SELECT t.id, t.registration_id, t.ticket_code, t.qr_data, t.checked_in,
              t.checked_in_at, r.status AS registration_status,
              e.id AS event_id, e.organizer_id, e.title AS event_title, e.status AS event_status,
              u.name AS attendee_name
       FROM tickets t
       JOIN registrations r ON r.id = t.registration_id
       JOIN events e ON e.id = r.event_id
       JOIN users u ON u.id = r.user_id
       WHERE t.ticket_code = ? COLLATE NOCASE`,
      [code]
    ) ?? null;
  }

  checkIn(code) {
    return this.db.transaction(() => {
      const ticket = this.getByCode(code);
      if (
        !ticket ||
        ticket.checked_in ||
        ticket.registration_status !== 'confirmed' ||
        ticket.event_status === 'cancelled'
      ) {
        return null;
      }
      const updated = this.db.run(
        'UPDATE tickets SET checked_in = 1, checked_in_at = ? WHERE id = ? AND checked_in = 0',
        [this.clock(), ticket.id]
      );
      return updated.changes ? ticket : null;
    });
  }
}
