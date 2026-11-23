import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export function openDatabase(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrationsDir(): string {
  return path.resolve(import.meta.dirname, '../migrations');
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      checksum TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => String(row.version)),
  );

  const files = fs
    .readdirSync(migrationsDir())
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir(), file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)').run(
        version,
        new Date().toISOString(),
        checksum,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
}

export function withTransaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function countRows(db: Db, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  return Number(row?.count ?? 0);
}
