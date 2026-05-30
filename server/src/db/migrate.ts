import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './index';
import { logger } from '../lib/logger';

/**
 * Apply schema.sql idempotently.
 *
 * SQLite's `CREATE TABLE IF NOT EXISTS` makes this safe to re-run on every
 * container start. For destructive migrations later, switch to a numbered
 * migrations table.
 */
export function runMigrations(): void {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const db = getDb();
  db.exec(sql);
  logger.info('schema applied');
}

// CLI entry: `npm run migrate`
if (require.main === module) {
  runMigrations();
  // eslint-disable-next-line no-console
  console.log('migrations complete');
  process.exit(0);
}
