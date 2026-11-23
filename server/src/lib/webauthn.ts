import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import type { Config } from '../config.ts';
import type { Db } from '../db.ts';
import { addMinutes, newId, nowIso } from './ids.ts';

export type ChallengeType = 'register' | 'login' | 'unlock';

type ChallengeRow = {
  id: string;
  user_id: string | null;
  type: ChallengeType;
  challenge: string;
  payload: string | null;
  expires_at: string;
  used_at: string | null;
};

export type PasskeyRow = {
  id: string;
  user_id: string;
  rp_id: string;
  credential_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
};

export function storeChallenge(
  db: Db,
  type: ChallengeType,
  challenge: string,
  userId: string | null,
  payload: unknown,
): string {
  const id = newId();
  db.prepare(
    `INSERT INTO webauthn_challenges (id, user_id, type, challenge, payload, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    type,
    challenge,
    payload === undefined ? null : JSON.stringify(payload),
    addMinutes(new Date(), 5).toISOString(),
    nowIso(),
  );
  return id;
}

export function takeChallenge(db: Db, id: string, type: ChallengeType): ChallengeRow | null {
  const row = db.prepare('SELECT * FROM webauthn_challenges WHERE id = ?').get(id) as
    | ChallengeRow
    | undefined;
  if (!row || row.type !== type || row.used_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  db.prepare('UPDATE webauthn_challenges SET used_at = ? WHERE id = ?').run(nowIso(), id);
  return row;
}

export function parsePayload<T>(row: ChallengeRow): T | null {
  if (!row.payload) return null;
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}

export async function buildRegistrationOptions(
  db: Db,
  config: Config,
  userId: string,
): Promise<{ challengeId: string; options: Awaited<ReturnType<typeof generateRegistrationOptions>> }> {
  const passkeys = db
    .prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ? AND rp_id = ?')
    .all(userId, config.rpId) as Array<{ credential_id: string; transports: string | null }>;

  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userName: 'owner',
    userDisplayName: 'Владелец',
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    excludeCredentials: passkeys.map((passkey) => ({
      id: passkey.credential_id,
      transports: parseTransports(passkey.transports),
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });

  const challengeId = storeChallenge(db, 'register', options.challenge, userId, { userId });
  return { challengeId, options };
}

export async function verifyRegistration(
  db: Db,
  config: Config,
  challengeId: string,
  response: RegistrationResponseJSON,
): Promise<{ userId: string; credential: WebAuthnCredential } | null> {
  const row = takeChallenge(db, challengeId, 'register');
  if (!row) return null;
  const payload = parsePayload<{ userId: string }>(row);
  if (!payload?.userId) return null;

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: row.challenge,
    expectedOrigin: config.appOrigin,
    expectedRPID: config.rpId,
    requireUserVerification: true,
  });

  if (!verification.verified) return null;
  return { userId: payload.userId, credential: verification.registrationInfo.credential };
}

export function savePasskey(
  db: Db,
  userId: string,
  config: Config,
  credential: WebAuthnCredential,
  label: string,
): void {
  db.prepare(
    `INSERT INTO passkeys
     (id, user_id, rp_id, credential_id, public_key, counter, transports, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    userId,
    config.rpId,
    credential.id,
    Buffer.from(credential.publicKey),
    credential.counter,
    JSON.stringify(credential.transports ?? []),
    label.slice(0, 80),
    nowIso(),
  );
}

export async function buildAuthenticationOptions(
  db: Db,
  config: Config,
  userId: string,
  type: ChallengeType = 'login',
): Promise<{
  challengeId: string;
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>> | null;
  rpMismatch: boolean;
}> {
  const passkeys = db
    .prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ? AND rp_id = ?')
    .all(userId, config.rpId) as Array<{ credential_id: string; transports: string | null }>;

  if (passkeys.length === 0) {
    return { challengeId: '', options: null, rpMismatch: true };
  }

  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    allowCredentials: passkeys.map((passkey) => ({
      id: passkey.credential_id,
      transports: parseTransports(passkey.transports),
    })),
    userVerification: 'required',
  });

  const challengeId = storeChallenge(db, type, options.challenge, userId, { userId });
  return { challengeId, options, rpMismatch: false };
}

export async function verifyAuthentication(
  db: Db,
  config: Config,
  challengeId: string,
  response: AuthenticationResponseJSON,
  type: ChallengeType = 'login',
): Promise<{ userId: string; passkeyId: string; newCounter: number } | null> {
  const row = takeChallenge(db, challengeId, type);
  if (!row) return null;
  const payload = parsePayload<{ userId: string }>(row);
  if (!payload?.userId) return null;

  const passkey = db
    .prepare('SELECT * FROM passkeys WHERE credential_id = ? AND user_id = ? AND rp_id = ?')
    .get(response.id, payload.userId, config.rpId) as PasskeyRow | undefined;
  if (!passkey) return null;

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: row.challenge,
    expectedOrigin: config.appOrigin,
    expectedRPID: config.rpId,
    credential: {
      id: passkey.credential_id,
      publicKey: new Uint8Array(passkey.public_key),
      counter: passkey.counter,
      transports: parseTransports(passkey.transports),
    },
    requireUserVerification: true,
  });

  if (!verification.verified) return null;

  const newCounter = verification.authenticationInfo.newCounter;
  db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(
    newCounter,
    nowIso(),
    passkey.id,
  );

  return { userId: payload.userId, passkeyId: passkey.id, newCounter };
}

export function listPasskeys(db: Db, userId: string, rpId: string): PasskeyRow[] {
  return db
    .prepare('SELECT * FROM passkeys WHERE user_id = ? AND rp_id = ? ORDER BY created_at')
    .all(userId, rpId) as PasskeyRow[];
}

function parseTransports(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : undefined;
  } catch {
    return undefined;
  }
}
