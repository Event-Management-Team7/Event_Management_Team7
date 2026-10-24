import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
const schemaSql = readFileSync(schemaPath, 'utf8');
const CURRENT_SCHEMA_VERSION = 3;
const EVENT_COLUMNS = new Map([
  ['start_time', "TEXT NOT NULL DEFAULT ''"],
  ['venue_type', "TEXT NOT NULL DEFAULT 'physical'"],
  ['ticket_details', "TEXT NOT NULL DEFAULT ''"],
  ['start_datetime', "TEXT NOT NULL DEFAULT ''"],
  ['end_datetime', "TEXT NOT NULL DEFAULT ''"],
  ['meeting_link', "TEXT NOT NULL DEFAULT ''"],
  ['currency', "TEXT NOT NULL DEFAULT 'INR'"],
  ['tags', "TEXT NOT NULL DEFAULT '[]'"]
]);

export function migrate(db) {
  const currentVersion = db.pragma('user_version', { simple: true });
  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`
    );
  }

  db.transaction(() => {
    db.exec(schemaSql);

    const existingEventColumns = new Set(
      db.prepare('PRAGMA table_info(events)').all().map((column) => column.name)
    );
    for (const [column, definition] of EVENT_COLUMNS) {
      if (!existingEventColumns.has(column)) {
        db.exec(`ALTER TABLE events ADD COLUMN ${column} ${definition}`);
      }
    }

    // email_verified is stored now so Sprint 2 can add email verification without a data migration.
    const existingUserColumns = new Set(
      db.prepare('PRAGMA table_info(users)').all().map((column) => column.name)
    );
    if (!existingUserColumns.has('email_verified')) {
      db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
    }

    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  })();
}
