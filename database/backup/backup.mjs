import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function backupDatabase(dbPath, backupDir) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `rawad_portal-${stamp}.db`);

  const db = new DatabaseSync(dbPath);
  try {
    // Flush WAL into main DB file before copying
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } finally {
    db.close();
  }

  fs.copyFileSync(dbPath, target);
  return target;
}

if (process.argv[1]?.endsWith('backup.mjs')) {
  const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'database', 'rawad_portal.db');
  const backupDir = process.env.BACKUP_DIR || path.resolve(process.cwd(), 'database', 'backup', 'snapshots');
  const out = backupDatabase(dbPath, backupDir);
  console.log(`Backup created: ${out}`);
}
