import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config';
import { logger } from '../lib/logger';

let _db: Database.Database | null = null;

/**
 * Open (and lazily create) the application's SQLite database.
 *
 * - Lives in DATA_DIR (Coolify persistent volume mounted at /data in prod).
 * - WAL mode + foreign keys enforced.
 * - Single instance per process; better-sqlite3 is fully synchronous so
 *   no connection pool is required.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  const dataDir = path.resolve(config.dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'paninipano.sqlite');

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  _db = db;
  logger.info({ dbPath }, 'sqlite opened');
  return db;
}

/**
 * Close the database. Use in tests / graceful shutdown.
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
