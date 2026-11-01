import { Database } from './database.js';
import { AuthService } from '../services/auth.js';
import { EventService } from '../services/events.js';
import { RegistrationService } from '../services/registrations.js';

export function seedDemoData(db) {
  const auth = new AuthService(db, { cost: 4 });
  const events = new EventService(db);
  const registrations = new RegistrationService(db);

  // 1. Admin
  let admin = db.get('SELECT id, email FROM users WHERE email = ?', ['admin@emrs.test']);
  if (!admin) {
    admin = auth.provisionUser({
      name: 'System Admin',
      email: 'admin@emrs.test',
      password: 'AdminPassword123!',
      role: 'Admin'
    });
  }

  // 2. Organizer
  let organizer = db.get('SELECT id, email FROM users WHERE email = ?', ['organizer@emrs.test']);
  if (!organizer) {
    organizer = auth.register({
      name: 'Elena Vance (Organizer)',
      email: 'organizer@emrs.test',
      password: 'OrganizerPassword123!',
      role: 'Organizer'
    });
    db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [organizer.id]);
  }

  // 3. Attendee 1
  let attendee1 = db.get('SELECT id, email FROM users WHERE email = ?', ['attendee1@emrs.test']);
  if (!attendee1) {
    attendee1 = auth.register({
      name: 'Gordon Freeman (Attendee)',
      email: 'attendee1@emrs.test',
      password: 'AttendeePassword123!',
      role: 'Attendee'
    });
    db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [attendee1.id]);
  }

  // 4. Attendee 2
  let attendee2 = db.get('SELECT id, email FROM users WHERE email = ?', ['attendee2@emrs.test']);
  if (!attendee2) {
    attendee2 = auth.register({
      name: 'Alyx Vance (Attendee)',
      email: 'attendee2@emrs.test',
      password: 'AttendeePassword123!',
      role: 'Attendee'
    });
    db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [attendee2.id]);
  }

  function ensureEvent(data) {
    const existing = db.get('SELECT id, title, status FROM events WHERE title = ?', [data.title]);
    if (existing) return existing.id;
    return events.create(organizer.id, data);
  }

  const now = new Date();
  const future30 = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString();
  const future45 = new Date(now.getTime() + 45 * 24 * 3600 * 1000).toISOString();
  const future15 = new Date(now.getTime() + 15 * 24 * 3600 * 1000).toISOString();
  const future60 = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
  const past30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

  // Event 1: Free upcoming event
  ensureEvent({
    title: 'Tech Innovators Summit 2026',
    description: 'Annual gathering of software architects, developers, and engineers exploring modern computing paradigms.',
    category: 'Conference',
    startDateTime: future30,
    endDateTime: new Date(Date.parse(future30) + 8 * 3600 * 1000).toISOString(),
    venueType: 'Physical',
    venue: 'Convention Center, Bangalore',
    capacity: 100,
    ticketTypes: [{ name: 'Standard Pass', price: 0, quantity: 100 }]
  });

  // Event 2: Paid upcoming event
  ensureEvent({
    title: 'Cloud Architecture & Microservices Masterclass',
    description: 'Intensive masterclass on scalable distributed systems, container orchestration, and fault tolerance.',
    category: 'Workshop',
    startDateTime: future45,
    endDateTime: new Date(Date.parse(future45) + 6 * 3600 * 1000).toISOString(),
    venueType: 'Physical',
    venue: 'Tech Park Auditorium, Bangalore',
    capacity: 35,
    ticketTypes: [{ name: 'Workshop Ticket', price: 499.0, quantity: 35 }]
  });

  // Event 3: Full event with waitlist
  const fullEventId = ensureEvent({
    title: 'Hands-on DevOps & Kubernetes Boot Camp',
    description: 'Limited-seat deep dive into CI/CD pipelines, Docker containerization, and Kubernetes clustering.',
    category: 'Workshop',
    startDateTime: future15,
    endDateTime: new Date(Date.parse(future15) + 4 * 3600 * 1000).toISOString(),
    venueType: 'Physical',
    venue: 'Lab Room 402',
    capacity: 1,
    ticketTypes: [{ name: 'Hands-on Seat', price: 0, quantity: 1 }]
  });
  registrations.register(fullEventId, attendee1.id);
  registrations.register(fullEventId, attendee2.id);

  // Event 4: Cancelled event
  const cancelledEventId = ensureEvent({
    title: 'Legacy Systems Modernization Seminar',
    description: 'Exploration of monolithic to microservices refactoring strategies.',
    category: 'Seminar',
    startDateTime: future60,
    endDateTime: new Date(Date.parse(future60) + 3 * 3600 * 1000).toISOString(),
    venueType: 'Physical',
    venue: 'Seminar Hall B',
    capacity: 50,
    ticketTypes: [{ name: 'General Admission', price: 0, quantity: 50 }]
  });
  const cancelledCheck = db.get('SELECT status FROM events WHERE id = ?', [cancelledEventId]);
  if (cancelledCheck && cancelledCheck.status !== 'cancelled') {
    events.cancel(cancelledEventId, { id: organizer.id, role: 'Organizer' });
  }

  // Event 5: Past event
  const pastEvent = db.get('SELECT id FROM events WHERE title = ?', ['Spring 2026 Developer Kickoff']);
  if (!pastEvent) {
    db.run(
      `INSERT INTO events (
        organizer_id, title, description, category, event_date, start_time,
        venue_type, venue, capacity, price, status, created_at, start_datetime, end_datetime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        organizer.id,
        'Spring 2026 Developer Kickoff',
        'Opening season gathering and lightning talks for the technology community.',
        'Networking',
        past30.slice(0, 10),
        '18:00',
        'Physical',
        'Community Hub',
        50,
        0,
        'active',
        Math.floor(Date.parse(past30) / 1000) - 86400,
        past30,
        new Date(Date.parse(past30) + 3 * 3600 * 1000).toISOString()
      ]
    );
  }

  return { admin, organizer, attendee1, attendee2 };
}

if (process.argv[1]?.endsWith('seed.js')) {
  const dbPath = process.env.EMRS_DB || 'emrs.db';
  const db = new Database(dbPath);
  try {
    console.log(`Seeding database at ${dbPath}...`);
    seedDemoData(db);
    console.log('Database seeded successfully.');
  } finally {
    db.close();
  }
}
