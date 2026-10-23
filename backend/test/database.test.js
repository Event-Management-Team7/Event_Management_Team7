import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import DatabaseConnection from 'better-sqlite3';
import { Database } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';

test('creates the six application tables and required event columns', () => {
  const db = new Database(':memory:');
  try {
    const tables = db
      .all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map(({ name }) => name);
    assert.deepEqual(tables, [
      'audit_logs',
      'events',
      'registrations',
      'sessions',
      'tickets',
      'users'
    ]);

    const eventColumns = db.all('PRAGMA table_info(events)').map(({ name }) => name);
    for (const column of [
      'id',
      'organizer_id',
      'title',
      'description',
      'category',
      'event_date',
      'start_time',
      'venue_type',
      'venue',
      'capacity',
      'ticket_details',
      'start_datetime',
      'end_datetime',
      'meeting_link',
      'currency',
      'tags',
      'price',
      'status',
      'created_at'
    ]) {
      assert.ok(eventColumns.includes(column), `Missing events.${column}`);
    }
    assert.equal(db.get('PRAGMA foreign_keys').foreign_keys, 1);
  } finally {
    db.close();
  }
});

test('binds query values and rolls back failed transactions', () => {
  const db = new Database(':memory:');
  try {
    const email = "user@example.test'); DROP TABLE users; --";
    db.run(
      'INSERT INTO users (name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      ['Test User', email, 'Attendee', 'hash', 123]
    );
    assert.equal(db.get('SELECT email FROM users WHERE email = ?', [email]).email, email);

    assert.throws(() =>
      db.transaction((transaction) => {
        transaction.run(
          'INSERT INTO users (name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
          ['Rollback User', 'rollback@example.test', 'Attendee', 'hash', 124]
        );
        throw new Error('force rollback');
      })
    );
    assert.equal(db.get('SELECT id FROM users WHERE email = ?', ['rollback@example.test']), undefined);
    assert.equal(db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").name, 'users');
  } finally {
    db.close();
  }
});

test('adds missing event columns to an existing database without losing data', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'emrs-db-migration-'));
  const filename = path.join(directory, 'legacy.db');
  const legacy = new DatabaseConnection(filename);
  try {
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT DEFAULT '',
        role TEXT NOT NULL DEFAULT 'Attendee',
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organizer_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        event_date TEXT NOT NULL,
        venue TEXT NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 50,
        price REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL
      );
      INSERT INTO users (name, email, password_hash, created_at)
      VALUES ('Existing Organizer', 'organizer@example.test', 'existing-hash', 100);
      INSERT INTO events (organizer_id, title, description, category, event_date, venue, created_at)
      VALUES (1, 'Existing Event', 'Preserve this row', 'Workshop', '2099-01-01', 'Hall A', 101);
    `);
  } finally {
    legacy.close();
  }

  try {
    const db = new Database(filename);
    try {
      const event = db.get('SELECT title, description, venue_type, start_time, ticket_details FROM events WHERE id = 1');
      assert.deepEqual(event, {
        title: 'Existing Event',
        description: 'Preserve this row',
        venue_type: 'physical',
        start_time: '',
        ticket_details: ''
      });
      assert.equal(db.get('SELECT password_hash FROM users WHERE id = 1').password_hash, 'existing-hash');
      assert.equal(db.get('PRAGMA user_version').user_version, 2);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rerunning migrations preserves existing rows', () => {
  const db = new Database(':memory:');
  try {
    db.run(
      'INSERT INTO users (name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      ['Persistent User', 'persistent@example.test', 'Attendee', 'hash', 123]
    );
    db.connection.pragma('user_version = 0');
    assert.doesNotThrow(() => migrate(db.connection));
    assert.equal(db.get('SELECT name FROM users WHERE email = ?', ['persistent@example.test']).name, 'Persistent User');
  } finally {
    db.close();
  }
});
