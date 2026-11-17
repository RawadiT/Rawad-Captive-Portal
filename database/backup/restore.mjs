import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function restoreDatabase(snapshotPath, targetDbPath) {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot file not found: ${snapshotPath}`);
  }
  const dir = path.dirname(targetDbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Validate snapshot integrity before restoring
  const checkDb = new DatabaseSync(snapshotPath, { readOnly: true });
  try {
    const res = checkDb.prepare('PRAGMA integrity_check;').get();
    if (!res || res.integrity_check !== 'ok') {
      throw new Error('Snapshot failed SQLite integrity_check');
    }
  } finally {
    checkDb.close();
  }

  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${targetDbPath}${suffix}`;
    if (fs.existsSync(f) && suffix !== '') {
      fs.unlinkSync(f);
    }
  }
  fs.copyFileSync(snapshotPath, targetDbPath);
  return targetDbPath;
}

if (process.argv[1]?.endsWith('restore.mjs')) {
  const snapshot = process.argv[2];
  if (!snapshot) {
    console.error('Usage: node database/backup/restore.mjs <snapshot-path>');
    process.exit(1);
  }
  const targetDbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'database', 'rawad_portal.db');
  restoreDatabase(path.resolve(snapshot), targetDbPath);
  console.log(`Database restored from ${snapshot} to ${targetDbPath}`);
}
