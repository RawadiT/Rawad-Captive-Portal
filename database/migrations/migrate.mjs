import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function runMigrations(dbPath, schemaDir) {
  const dir = path.dirname(dbPath);
  if (dbPath !== ':memory:' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const files = fs
    .readdirSync(schemaDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all();
  const applied = new Set(appliedRows.map((r) => r.version));

  const appliedNow = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(schemaDir, file), 'utf8');
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        version,
        new Date().toISOString()
      );
      db.exec('COMMIT;');
      appliedNow.push(version);
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  return { db, appliedNow };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('migrate.mjs')) {
  const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'database', 'rawad_portal.db');
  const schemaDir = path.resolve(process.cwd(), 'database', 'schema');
  const { db, appliedNow } = runMigrations(dbPath, schemaDir);
  db.close();
  console.log(`Migrations complete. Newly applied: ${appliedNow.length ? appliedNow.join(', ') : 'none'}`);
}
