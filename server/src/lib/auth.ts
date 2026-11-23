import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import type { Db } from '../db.ts';
import { addDays, addMinutes, newId, nowIso, randomToken, sha256 } from './ids.ts';

export type SessionRow = {
  id_hash: string;
  user_id: string;
  device_label: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  unlocked_until: string | null;
  ua_hash: string | null;
};

export type AuthContext = {
  session: SessionRow;
  userId: string;
  token: string;
};

export function createSession(
  db: Db,
  config: Config,
  userId: string,
  deviceLabel: string | null,
  uaHash: string | null,
): { token: string; expiresAt: string } {
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = addDays(now, config.sessionTtlDays).toISOString();
  db.prepare(
    `INSERT INTO sessions (id_hash, user_id, device_label, created_at, last_seen_at, expires_at, ua_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(sha256(token), userId, deviceLabel, now.toISOString(), now.toISOString(), expiresAt, uaHash);
  return { token, expiresAt };
}

export function getSession(db: Db, token: string): SessionRow | null {
  if (!token) return null;
  const row = db
    .prepare('SELECT * FROM sessions WHERE id_hash = ?')
    .get(sha256(token)) as SessionRow | undefined;
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

export function touchSession(db: Db, session: SessionRow): void {
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(nowIso(), session.id_hash);
}

export function revokeSession(db: Db, sessionHash: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?').run(nowIso(), sessionHash);
}

export function setSessionCookie(
  reply: FastifyReply,
  config: Config,
  token: string,
  expiresAt: string,
): void {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  reply.setCookie(config.sessionCookie, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(config.sessionCookie, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
  });
}

export function authFromRequest(
  request: FastifyRequest,
  db: Db,
  config: Config,
): AuthContext | null {
  const token = request.cookies?.[config.sessionCookie];
  if (!token) return null;
  const session = getSession(db, token);
  if (!session) return null;
  return { session, userId: session.user_id, token };
}

export function userCount(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  return Number(row?.count ?? 0);
}

export function getOnlyUserId(db: Db): string | null {
  const row = db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get();
  return row ? String(row.id) : null;
}

export function userAgentHash(request: FastifyRequest): string {
  const ua = String(request.headers['user-agent'] ?? '');
  return sha256(ua).slice(0, 16);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = randomBytes(24);
    let raw = '';
    for (const byte of bytes) raw += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    codes.push(raw.match(/.{4}/g)!.join('-'));
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(normalizeRecoveryCode(code), salt, 32, {
    N: 2 ** 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyRecoveryCode(code: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const salt = Buffer.from(saltRaw, 'base64url');
  const expected = Buffer.from(hashRaw, 'base64url');
  const actual = scryptSync(normalizeRecoveryCode(code), salt, expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
    maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function saveRecoveryCodes(db: Db, userId: string, codes: string[]): void {
  const now = nowIso();
  for (const code of codes) {
    db.prepare(
      'INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run(newId(), userId, hashRecoveryCode(code), now);
  }
}

export function remainingRecoveryCodes(db: Db, userId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ? AND used_at IS NULL')
    .get(userId);
  return Number(row?.count ?? 0);
}

export function consumeRecoveryCode(
  db: Db,
  userId: string,
  code: string,
): { ok: boolean; remaining: number } {
  const rows = db
    .prepare('SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL')
    .all(userId) as Array<{ id: string; code_hash: string }>;

  for (const row of rows) {
    if (verifyRecoveryCode(code, row.code_hash)) {
      db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ?').run(nowIso(), row.id);
      return { ok: true, remaining: remainingRecoveryCodes(db, userId) };
    }
  }
  return { ok: false, remaining: rows.length };
}

export function unlockSession(db: Db, sessionHash: string, minutes: number): string {
  const until = addMinutes(new Date(), minutes).toISOString();
  db.prepare('UPDATE sessions SET unlocked_until = ? WHERE id_hash = ?').run(until, sessionHash);
  return until;
}

export class RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly windowMs: number;
  private readonly max: number;

  constructor(windowMs: number, max: number) {
    this.windowMs = windowMs;
    this.max = max;
  }

  check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (bucket.count >= this.max) {
      return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset(): void {
    this.buckets.clear();
  }
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
