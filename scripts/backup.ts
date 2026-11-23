import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadConfig } from '../server/src/config.ts';
import { openDatabase } from '../server/src/db.ts';
import { createBackup, verifyBackup } from '../server/src/lib/backup.ts';

try {
  process.loadEnvFile('.env.local');
} catch {
  // optional
}

const config = loadConfig();
const db = openDatabase(config.dbPath);

try {
  const metadata = createBackup(db, config, 'manual');
  const file = path.join(config.backupDir, metadata.file);
  console.log(`Backup created: ${file}`);
  console.log(`Size: ${(metadata.size / 1024).toFixed(1)} KB`);
  console.log(`SHA-256: ${metadata.sha256}`);

  const result = verifyBackup(file, config.backupPassphrase);
  console.log(
    `Restore test: OK (tables=${result.tables}, users=${result.users}, accounts=${result.accounts}, transactions=${result.transactions})`,
  );

  const latest = path.join(config.backupDir, '.last-verify');
  fs.writeFileSync(latest, new Date().toISOString(), { mode: 0o600 });
} finally {
  db.close();
}
