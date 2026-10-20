const EVENT_SELECT = `
  SELECT e.id, e.organizer_id, e.title, e.description, e.category, e.event_date,
         e.venue, e.capacity, e.price, e.status, e.created_at,
         COUNT(r.id) AS registered_count
  FROM events e
  LEFT JOIN registrations r ON r.event_id = e.id AND r.status = 'confirmed'
`;

function serializeEvent(row) {
  return {
    id: row.id,
    organizerId: row.organizer_id,
    title: row.title,
    description: row.description,
    category: row.category,
    date: row.event_date,
    venue: row.venue,
    capacity: row.capacity,
    price: row.price,
    registeredCount: row.registered_count,
    status: row.status
  };
}

export class EventService {
  constructor(db, clock = () => Math.floor(Date.now() / 1000)) {
    this.db = db;
    this.clock = clock;
  }

  list({ category = '', search = '' } = {}) {
    const conditions = ["e.status = 'active'"];
    const params = [];
    if (category) {
      conditions.push('e.category = ?');
      params.push(category);
    }
    if (search) {
      conditions.push('(e.title LIKE ? OR e.description LIKE ? OR e.venue LIKE ?)');
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern);
    }
    const rows = this.db.all(
      `${EVENT_SELECT} WHERE ${conditions.join(' AND ')} GROUP BY e.id ORDER BY e.event_date ASC`,
      params
    );
    return rows.map(serializeEvent);
  }

  get(id) {
    const row = this.db.get(`${EVENT_SELECT} WHERE e.id = ? GROUP BY e.id`, [id]);
    return row ? serializeEvent(row) : null;
  }

  listOrganizer(organizerId) {
    return this.db.all(
      `${EVENT_SELECT} WHERE e.organizer_id = ? GROUP BY e.id ORDER BY e.created_at DESC`,
      [organizerId]
    ).map(serializeEvent);
  }

  create(organizerId, input) {
    const result = this.db.run(
      `INSERT INTO events
       (organizer_id, title, description, category, event_date, venue, capacity, price, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [
        organizerId,
        input.title,
        input.description,
        input.category,
        input.date,
        input.venue,
        input.capacity,
        input.price,
        this.clock()
      ]
    );
    return Number(result.lastInsertRowid);
  }

  cancel(id, user) {
    const event = this.db.get('SELECT organizer_id FROM events WHERE id = ?', [id]);
    if (!event) return 'not-found';
    if (user.role !== 'Admin' && event.organizer_id !== user.id) return 'forbidden';
    this.db.run("UPDATE events SET status = 'cancelled' WHERE id = ?", [id]);
    return 'cancelled';
  }
}
