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

function updateValues(input) {
  const ticketTypes = input.ticketTypes.map((ticket) => ({
    ...ticket,
    quantity: ticket.quantity === undefined ? input.capacity : ticket.quantity
  }));
  return {
    title: input.title.trim(),
    description: input.description,
    category: input.category,
    startDateTime: input.startDateTime,
    endDateTime: input.endDateTime,
    venueType: input.venueType,
    venue: input.venue,
    meetingLink: input.meetingLink ?? '',
    capacity: input.capacity,
    ticketTypes,
    currency: input.currency ?? 'INR',
    tags: input.tags ?? []
  };
}

function currentEventValues(row) {
  return {
    title: row.title,
    description: row.description,
    category: row.category,
    startDateTime: row.start_datetime || (
      row.start_time ? `${row.event_date}T${row.start_time}` : row.event_date
    ),
    endDateTime: row.end_datetime,
    venueType: row.venue_type === 'virtual' ? 'Virtual' : 'Physical',
    venue: row.venue,
    meetingLink: row.meeting_link,
    capacity: row.capacity,
    ticketTypes: parseJsonArray(row.ticket_details),
    currency: row.currency,
    tags: parseJsonArray(row.tags)
  };
}

function changedEventFields(oldValues, newValues) {
  return Object.keys(newValues)
    .filter((field) => JSON.stringify(oldValues[field]) !== JSON.stringify(newValues[field]))
    .map((field) => ({
      field,
      oldValue: oldValues[field],
      newValue: newValues[field]
    }));
}

export class EventService {
  constructor(db, clock = () => Math.floor(Date.now() / 1000)) {
    this.db = db;
    this.clock = clock;
  }

  // `from` and `to` are inclusive YYYY-MM-DD dates compared with the event's start date;
  // `location` is a case-insensitive substring match on the venue. All filters combine with AND.
  list({ category = '', search = '', from = '', to = '', location = '' } = {}) {
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
    if (from) {
      conditions.push('e.event_date >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('e.event_date <= ?');
      params.push(to);
    }
    if (location) {
      conditions.push("e.venue LIKE ? ESCAPE '\\'");
      params.push(`%${location.replace(/[\\%_]/g, '\\$&')}%`);
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

  update(id, user, input) {
    const row = this.db.get('SELECT * FROM events WHERE id = ?', [id]);
    if (!row) return 'not-found';
    if (user.role !== 'Admin' && (user.role !== 'Organizer' || row.organizer_id !== user.id)) {
      return 'forbidden';
    }
    if (row.status.toLowerCase() === 'cancelled') return 'event-cancelled';

    const startDateTime = row.start_datetime || (
      row.start_time ? `${row.event_date}T${row.start_time}` : row.event_date
    );
    if (new Date(startDateTime).getTime() <= this.clock() * 1000) return 'event-started';

    const confirmedCount = this.db.get(
      "SELECT COUNT(*) AS count FROM registrations WHERE event_id = ? AND status = 'confirmed'",
      [id]
    ).count;
    if (input.capacity < confirmedCount) return 'capacity-too-low';

    const oldValues = currentEventValues(row);
    const newValues = updateValues(input);
    const changes = changedEventFields(oldValues, newValues);
    const start = newValues.startDateTime;
    const venueType = newValues.venueType.toLowerCase();
    const ticketDetails = JSON.stringify(newValues.ticketTypes);
    const tags = JSON.stringify(newValues.tags);
    const now = this.clock();

    this.db.transaction(() => {
      this.db.run(
        `UPDATE events
         SET title = ?, description = ?, category = ?, event_date = ?, start_time = ?,
             start_datetime = ?, end_datetime = ?, venue_type = ?, venue = ?, meeting_link = ?,
             capacity = ?, ticket_details = ?, price = ?, currency = ?, tags = ?
         WHERE id = ?`,
        [
          newValues.title,
          newValues.description,
          newValues.category,
          start.slice(0, 10),
          start.slice(11),
          start,
          newValues.endDateTime,
          venueType,
          newValues.venue,
          newValues.meetingLink,
          newValues.capacity,
          ticketDetails,
          newValues.ticketTypes[0].price,
          newValues.currency,
          tags,
          id
        ]
      );
      for (const change of changes) {
        this.db.run(
          'INSERT INTO audit_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)',
          [user.id, 'event.updated', JSON.stringify({ eventId: id, ...change }), now]
        );
      }
    });
    return 'updated';
  }

  auditHistory(id, user) {
    const event = this.db.get('SELECT organizer_id FROM events WHERE id = ?', [id]);
    if (!event) return 'not-found';
    if (user.role !== 'Admin' && (user.role !== 'Organizer' || event.organizer_id !== user.id)) {
      return 'forbidden';
    }

    const rows = this.db.all(
      `SELECT a.id, a.user_id, u.name AS user_name, a.details, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.action = ? AND a.details LIKE ?
       ORDER BY a.created_at DESC, a.id DESC`,
      ['event.updated', `{"eventId":${id},%`]
    );
    return rows.map((row) => {
      const details = JSON.parse(row.details);
      return {
        id: row.id,
        userId: row.user_id,
        userName: row.user_name,
        timestamp: row.created_at,
        field: details.field,
        oldValue: details.oldValue,
        newValue: details.newValue
      };
    });
  }

  cancel(id, user) {
    return this.db.transaction(() => {
      const event = this.db.get(
        `SELECT organizer_id, title, event_date, start_time, start_datetime, status
         FROM events WHERE id = ?`,
        [id]
      );
      if (!event) return 'not-found';
      if (user.role !== 'Admin' && event.organizer_id !== user.id) return 'forbidden';
      if (event.status === 'cancelled') return { result: 'already-cancelled' };

      const startIso = event.start_datetime || (
        event.start_time ? `${event.event_date}T${event.start_time}` : event.event_date
      );
      const startTimeSec = Math.floor(new Date(startIso).getTime() / 1000);
      if (startTimeSec && startTimeSec <= this.clock()) {
        return { result: 'event-started' };
      }

      const attendees = this.db.all(
        `SELECT u.email FROM registrations r
         JOIN users u ON u.id = r.user_id
         WHERE r.event_id = ? AND r.status IN ('confirmed', 'waitlist')
         ORDER BY r.id`,
        [id]
      );
      this.db.run("UPDATE events SET status = 'cancelled' WHERE id = ?", [id]);
      this.db.run(
        `UPDATE registrations SET status = 'cancelled'
         WHERE event_id = ? AND status IN ('confirmed', 'waitlist')`,
        [id]
      );
      this.db.run(
        'INSERT INTO audit_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)',
        [user.id, 'event_cancelled', JSON.stringify({ eventId: id, title: event.title }), this.clock()]
      );

      return {
        result: 'cancelled',
        eventTitle: event.title,
        eventDate: event.event_date,
        attendees
      };
    });
  }
}
