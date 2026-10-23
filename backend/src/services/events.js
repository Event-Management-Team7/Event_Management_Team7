const EVENT_SELECT = `
  SELECT e.id, e.organizer_id, e.title, e.description, e.category, e.event_date,
         e.start_time, e.start_datetime, e.end_datetime, e.venue_type, e.venue,
         e.meeting_link, e.capacity, e.ticket_details, e.price, e.currency, e.tags,
         e.status, e.created_at,
         COUNT(r.id) AS registered_count
  FROM events e
  LEFT JOIN registrations r ON r.event_id = e.id AND r.status = 'confirmed'
`;

function parseJsonArray(value) {
  if (!value || !value.startsWith('[')) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

function serializeEvent(row) {
  const startDateTime = row.start_datetime || (
    row.start_time ? `${row.event_date}T${row.start_time}` : row.event_date
  );
  return {
    id: row.id,
    organizerId: row.organizer_id,
    title: row.title,
    description: row.description,
    category: row.category,
    date: startDateTime,
    startDateTime,
    endDateTime: row.end_datetime,
    venueType: row.venue_type === 'virtual' ? 'Virtual' : 'Physical',
    venue: row.venue,
    address: row.venue,
    meetingLink: row.meeting_link,
    capacity: row.capacity,
    price: row.price,
    ticketTypes: parseJsonArray(row.ticket_details),
    currency: row.currency,
    tags: parseJsonArray(row.tags),
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
    const conditions = ["e.status IN ('active', 'Upcoming')"];
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
    const start = input.startDateTime;
    const ticketTypes = input.ticketTypes.map((ticket) => ({
      ...ticket,
      quantity: ticket.quantity === undefined ? input.capacity : ticket.quantity
    }));
    const result = this.db.run(
      `INSERT INTO events
       (organizer_id, title, description, category, event_date, start_time, start_datetime,
        end_datetime, venue_type, venue, meeting_link, capacity, ticket_details, price,
        currency, tags, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Upcoming', ?)`,
      [
        organizerId,
        input.title.trim(),
        input.description,
        input.category,
        start.slice(0, 10),
        start.slice(11),
        start,
        input.endDateTime,
        input.venueType.toLowerCase(),
        input.venue,
        input.meetingLink ?? '',
        input.capacity,
        JSON.stringify(ticketTypes),
        ticketTypes[0].price,
        input.currency ?? 'INR',
        JSON.stringify(input.tags ?? []),
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
