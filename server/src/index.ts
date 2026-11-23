import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadConfig } from './config.ts';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';
import { userCount } from './lib/auth.ts';
import { randomToken } from './lib/ids.ts';
import { startBackupScheduler } from './lib/backup.ts';

try {
  process.loadEnvFile('.env.local');
} catch {
  // .env.local is optional for tests; local runs use it for tokens.
}

const config = loadConfig();
const db = openDatabase(config.dbPath);

if (userCount(db) === 0 && !config.setupToken) {
  const token = randomToken(24);
  config.setupToken = token;
  const dir = path.dirname(path.resolve(config.dbPath));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'setup-token.txt');
  fs.writeFileSync(file, token, { mode: 0o600 });
  console.log(`\n=== SETUP TOKEN (локально, одноразовый) ===\n${token}\nФайл: ${file}\n`);
}

const app = await createApp({ config, db });
const stopBackups = startBackupScheduler(db, config, app.log);

const shutdown = async () => {
  stopBackups();
  await app.close();
  db.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
app.log.info(
  {
    url: `http://${config.host}:${config.port}`,
    origin: config.appOrigin,
    rpId: config.rpId,
    env: config.appEnv,
    demoMode: config.demoMode,
    backupEnabled: config.backupEnabled,
  },
  'personal-finance API started',
);
