import path from 'node:path';
import process from 'node:process';
import { loadConfig } from '../server/src/config.ts';
import { latestBackup, verifyBackup } from '../server/src/lib/backup.ts';

try {
  process.loadEnvFile('.env.local');
} catch {
  // optional
}

const config = loadConfig();
const requested = process.argv[2];
const latest = latestBackup(config);
const file = requested ? path.resolve(requested) : latest ? path.join(config.backupDir, latest.file) : null;

if (!file) {
  console.error('No backups found. Run: npm run backup');
  process.exit(1);
}

try {
  const result = verifyBackup(file, config.backupPassphrase);
  console.log(`Verified: ${result.file}`);
  console.log(`Integrity: ${result.integrity}`);
  console.log(
    `Tables: ${result.tables}, users: ${result.users}, accounts: ${result.accounts}, transactions: ${result.transactions}`,
  );
} catch (error) {
  console.error(`Verification failed: ${(error as Error).message}`);
  process.exit(1);
}
