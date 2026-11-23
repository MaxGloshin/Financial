import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export type AppEnv = 'local' | 'production';

export type Config = {
  appEnv: AppEnv;
  port: number;
  host: string;
  appOrigin: string;
  rpId: string;
  rpName: string;
  dbPath: string;
  backupDir: string;
  backupPassphrase: string;
  backupEnabled: boolean;
  backupIntervalHours: number;
  setupToken: string;
  demoMode: boolean;
  demoToken: string;
  sessionCookie: string;
  secureCookies: boolean;
  sessionTtlDays: number;
  lockTimeoutMinutes: number;
  timezone: string;
  rateLimitEnabled: boolean;
  staticDir: string | null;
  logLevel: string;
};

function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be a positive number`);
  return Math.floor(value);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const appEnv = (env.APP_ENV ?? 'local') as AppEnv;
  if (appEnv !== 'local' && appEnv !== 'production') {
    throw new Error('APP_ENV must be "local" or "production"');
  }

  const appOrigin = env.APP_ORIGIN ?? 'http://localhost:5173';
  const rpId = env.WEBAUTHN_RP_ID ?? 'localhost';
  const secureCookies = appEnv === 'production';
  const demoMode = env.DEMO_MODE === '1';
  const demoToken = env.DEMO_TOKEN ?? '';
  const setupToken = env.SETUP_TOKEN ?? '';

  const config: Config = {
    appEnv,
    port: envInt(env, 'PORT', 3000),
    host: env.HOST ?? '127.0.0.1',
    appOrigin,
    rpId,
    rpName: env.WEBAUTHN_RP_NAME ?? 'Personal Finance',
    dbPath: env.DB_PATH ?? path.resolve('data/dev.sqlite'),
    backupDir: env.BACKUP_DIR ?? path.resolve('backups'),
    backupPassphrase: env.BACKUP_PASSPHRASE ?? '',
    backupEnabled: env.BACKUP_ENABLED === '1',
    backupIntervalHours: envInt(env, 'BACKUP_INTERVAL_HOURS', 24),
    setupToken,
    demoMode,
    demoToken,
    sessionCookie: secureCookies ? '__Host-pf_sid' : 'pf_sid',
    secureCookies,
    sessionTtlDays: envInt(env, 'SESSION_TTL_DAYS', 30),
    lockTimeoutMinutes: envInt(env, 'LOCK_TIMEOUT_MINUTES', 15),
    timezone: env.APP_TIMEZONE ?? 'Europe/Moscow',
    rateLimitEnabled: env.RATE_LIMIT !== '0',
    staticDir: env.STATIC_DIR ?? null,
    logLevel: env.LOG_LEVEL ?? 'info',
  };

  validateConfig(config);
  return config;
}

export function validateConfig(config: Config): void {
  let origin: URL;
  try {
    origin = new URL(config.appOrigin);
  } catch {
    throw new Error('APP_ORIGIN must be a valid URL');
  }

  if (config.appEnv === 'production') {
    if (origin.protocol !== 'https:') throw new Error('APP_ORIGIN must use https in production');
    if (config.demoMode) throw new Error('DEMO_MODE is forbidden when APP_ENV=production');
    if (!origin.hostname.endsWith(config.rpId) && origin.hostname !== config.rpId) {
      throw new Error('WEBAUTHN_RP_ID must be the origin host or its parent domain');
    }
    if (config.setupToken && config.setupToken.length < 32) {
      throw new Error('SETUP_TOKEN must be at least 32 characters in production');
    }
    if (config.backupEnabled && config.backupPassphrase.length < 12) {
      throw new Error('BACKUP_PASSPHRASE must be at least 12 characters when backups are enabled');
    }
    return;
  }

  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    throw new Error('APP_ORIGIN must use http or https locally');
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (!localHosts.has(origin.hostname)) {
    throw new Error('Local APP_ORIGIN must point to localhost or 127.0.0.1');
  }
  if (!localHosts.has(config.rpId) && config.rpId !== 'localhost') {
    throw new Error('Local WEBAUTHN_RP_ID must be localhost or 127.0.0.1');
  }
  if (config.demoMode && config.demoToken.length < 16) {
    throw new Error('DEMO_TOKEN must be at least 16 characters when DEMO_MODE=1');
  }
}

export function ensureLocalEnvFile(file = '.env.local'): void {
  if (fs.existsSync(file)) return;
  throw new Error(
    `${file} not found. Copy .env.example to .env.local and set SETUP_TOKEN/DEMO_TOKEN (local only).`,
  );
}
