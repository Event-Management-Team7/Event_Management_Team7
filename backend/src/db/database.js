import DatabaseConnection from 'better-sqlite3';
import { migrate } from './migrate.js';

export class Database {
  constructor(filename = process.env.EMRS_DB || 'emrs.db') {
    this.connection = new DatabaseConnection(filename);
    this.connection.pragma('foreign_keys = ON');
    migrate(this.connection);
  }

  run(sql, params = []) {
    return this.connection.prepare(sql).run(...params);
  }

  get(sql, params = []) {
    return this.connection.prepare(sql).get(...params);
  }

  all(sql, params = []) {
    return this.connection.prepare(sql).all(...params);
  }

  transaction(callback) {
    return this.connection.transaction(() => callback(this))();
  }

  close() {
    this.connection.close();
  }
}
