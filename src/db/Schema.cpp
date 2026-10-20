#include "db/Schema.h"

namespace emrs {

void initSchema(Database& db) {
    db.execute(R"(
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            phone TEXT DEFAULT '',
            role TEXT NOT NULL DEFAULT 'Attendee',
            password_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
    )");

    db.execute(R"(
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
    )");

    db.execute(R"(
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organizer_id INTEGER NOT NULL REFERENCES users(id),
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            category TEXT NOT NULL,

            -- Existing field kept for compatibility with EventService.
            event_date TEXT NOT NULL,

            -- EMT-18 required fields.
            start_time TEXT NOT NULL DEFAULT '',
            venue_type TEXT NOT NULL DEFAULT 'physical',
            venue TEXT NOT NULL,
            capacity INTEGER NOT NULL DEFAULT 50,
            ticket_details TEXT NOT NULL DEFAULT '',
            price REAL NOT NULL DEFAULT 0.0,
            status TEXT NOT NULL DEFAULT 'active',
            created_at INTEGER NOT NULL
        );
    )");

    db.execute(R"(
        CREATE TABLE IF NOT EXISTS registrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'confirmed',
            created_at INTEGER NOT NULL,
            UNIQUE(event_id, user_id)
        );
    )");

    db.execute(R"(
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            registration_id INTEGER NOT NULL UNIQUE
                REFERENCES registrations(id) ON DELETE CASCADE,
            ticket_code TEXT NOT NULL UNIQUE,
            qr_data TEXT NOT NULL,
            checked_in INTEGER NOT NULL DEFAULT 0,
            checked_in_at INTEGER DEFAULT 0
        );
    )");

    db.execute(R"(
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            details TEXT DEFAULT '',
            created_at INTEGER NOT NULL
        );
    )");
}

}  // namespace emrs