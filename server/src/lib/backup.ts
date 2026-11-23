import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import type { Config } from '../config.ts';
import type { Db } from '../db.ts';

const MAGIC = Buffer.from('PFBK1');
const SALT_LEN = 16;
const NONCE_LEN = 12;
const TAG_LEN = 16;

export type BackupMetadata = {
  file: string;
  createdAt: string;
  size: number;
  sha256: string;
  reason: string;
};

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 12) throw new Error('Парольная фраза бэкапа должна быть не короче 12 символов');
  return scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function createBackup(db: Db, config: Config, reason = 'manual'): BackupMetadata {
  if (!config.backupPassphrase) throw new Error('BACKUP_PASSPHRASE не задан');
  fs.mkdirSync(config.backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseName = `finance-${stamp}.sqlite.gz.enc`;
  const target = path.join(config.backupDir, baseName);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-backup-'));
  const snapshotPath = path.join(tempDir, 'snapshot.sqlite');
  try {
    db.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);
    const raw = fs.readFileSync(snapshotPath);
    const compressed = gzipSync(raw, { level: 9 });

    const salt = randomBytes(SALT_LEN);
    const nonce = randomBytes(NONCE_LEN);
    const key = deriveKey(config.backupPassphrase, salt);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([MAGIC, salt, nonce, tag, ciphertext]);
    fs.writeFileSync(target, payload, { mode: 0o600 });

    const metadata: BackupMetadata = {
      file: baseName,
      createdAt: new Date().toISOString(),
      size: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex'),
      reason,
    };
    fs.writeFileSync(target + '.json', JSON.stringify(metadata, null, 2), { mode: 0o600 });
    return metadata;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export type VerifyResult = {
  ok: true;
  file: string;
  tables: number;
  users: number;
  accounts: number;
  transactions: number;
  integrity: string;
};

export function verifyBackup(file: string, passphrase: string): VerifyResult {
  const payload = fs.readFileSync(file);
  if (payload.length < MAGIC.length + SALT_LEN + NONCE_LEN + TAG_LEN) {
    throw new Error('Файл бэкапа повреждён или слишком мал');
  }
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Неизвестный формат бэкапа');
  }

  let offset = MAGIC.length;
  const salt = payload.subarray(offset, (offset += SALT_LEN));
  const nonce = payload.subarray(offset, (offset += NONCE_LEN));
  const tag = payload.subarray(offset, (offset += TAG_LEN));
  const ciphertext = payload.subarray(offset);

  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  let compressed: Buffer;
  try {
    compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('Не удалось расшифровать бэкап: неверная парольная фраза или повреждённый файл');
  }

  const raw = gunzipSync(compressed);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-restore-'));
  const restorePath = path.join(tempDir, 'restore.sqlite');
  fs.writeFileSync(restorePath, raw, { mode: 0o600 });

  const restored = new DatabaseSync(restorePath);
  try {
    const integrityRow = restored.prepare('PRAGMA integrity_check').get() as
      | { integrity_check: string }
      | undefined;
    const integrity = String(integrityRow?.integrity_check ?? 'unknown');
    if (integrity !== 'ok') throw new Error(`Integrity check failed: ${integrity}`);

    const tables = restored
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .get() as { count: number };
    const users = restored.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    const accounts = restored.prepare('SELECT COUNT(*) AS count FROM accounts').get() as {
      count: number;
    };
    const transactions = restored.prepare('SELECT COUNT(*) AS count FROM transactions').get() as {
      count: number;
    };

    return {
      ok: true,
      file,
      tables: Number(tables.count),
      users: Number(users.count),
      accounts: Number(accounts.count),
      transactions: Number(transactions.count),
      integrity,
    };
  } finally {
    restored.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function latestBackup(config: Config): BackupMetadata | null {
  if (!fs.existsSync(config.backupDir)) return null;
  const files = fs
    .readdirSync(config.backupDir)
    .filter((name) => name.endsWith('.sqlite.gz.enc.json'))
    .sort()
    .reverse();
  for (const file of files) {
    try {
      return JSON.parse(fs.readFileSync(path.join(config.backupDir, file), 'utf8')) as BackupMetadata;
    } catch {
      continue;
    }
  }
  return null;
}

export function startBackupScheduler(db: Db, config: Config, logger: { info: Function; error: Function }): () => void {
  if (!config.backupEnabled || !config.backupPassphrase) return () => {};

  const check = () => {
    try {
      const latest = latestBackup(config);
      const ageHours = latest
        ? (Date.now() - new Date(latest.createdAt).getTime()) / 3_600_000
        : Number.POSITIVE_INFINITY;
      if (ageHours >= config.backupIntervalHours) {
        const metadata = createBackup(db, config, 'scheduled');
        logger.info({ file: metadata.file, size: metadata.size }, 'backup created');
      }

      const latestAfter = latestBackup(config);
      if (latestAfter) {
        const verifyMarker = path.join(config.backupDir, '.last-verify');
        const lastVerify = fs.existsSync(verifyMarker)
          ? new Date(fs.readFileSync(verifyMarker, 'utf8')).getTime()
          : 0;
        if (Date.now() - lastVerify > 30 * 24 * 3_600_000) {
          const result = verifyBackup(path.join(config.backupDir, latestAfter.file), config.backupPassphrase);
          fs.writeFileSync(verifyMarker, new Date().toISOString(), { mode: 0o600 });
          logger.info(result, 'backup restore test passed');
        }
      }
    } catch (error) {
      logger.error({ err: (error as Error).message }, 'backup check failed');
    }
  };

  const initial = setTimeout(check, 10_000);
  const interval = setInterval(check, 60 * 60_000);
  initial.unref();
  interval.unref();
  return () => {
    clearTimeout(initial);
    clearInterval(interval);
  };
}
