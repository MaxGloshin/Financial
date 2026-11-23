import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.ts';
import type { Db } from '../db.ts';
import { withTransaction } from '../db.ts';
import {
  authFromRequest,
  clearSessionCookie,
  consumeRecoveryCode,
  createSession,
  generateRecoveryCodes,
  getOnlyUserId,
  RateLimiter,
  remainingRecoveryCodes,
  revokeSession,
  saveRecoveryCodes,
  setSessionCookie,
  timingSafeEqualString,
  touchSession,
  unlockSession,
  userAgentHash,
  userCount,
  type AuthContext,
} from '../lib/auth.ts';
import { addMinutes, newId, nowIso } from '../lib/ids.ts';
import { audit } from '../lib/audit.ts';
import { getSettings } from '../services/settings.ts';
import { seedUserData } from '../seed.ts';
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  listPasskeys,
  savePasskey,
  verifyAuthentication,
  verifyRegistration,
} from '../lib/webauthn.ts';

const registerOptionsSchema = z
  .object({
    setupToken: z.string().min(1).max(200).optional(),
    label: z.string().max(80).optional(),
  })
  .strict();

const verifyRegistrationSchema = z
  .object({
    challengeId: z.string().min(1),
    response: z.record(z.string(), z.unknown()),
    label: z.string().max(80).optional(),
  })
  .strict();

const challengeSchema = z.object({ challengeId: z.string().min(1) }).strict();

const verifyAuthenticationSchema = z
  .object({
    challengeId: z.string().min(1),
    response: z.record(z.string(), z.unknown()),
  })
  .strict();

const recoverySchema = z.object({ code: z.string().min(8).max(64) }).strict();

export function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Db,
  config: Config,
): AuthContext | null {
  const auth = authFromRequest(request, db, config);
  if (!auth) {
    fail(reply, 401, 'UNAUTHORIZED', 'Требуется вход');
    return null;
  }
  touchSession(db, auth.session);
  return auth;
}

export function registerAuthRoutes(app: FastifyInstance, db: Db, config: Config): void {
  const loginLimiter = new RateLimiter(10 * 60_000, 20);
  const verifyLimiter = new RateLimiter(10 * 60_000, 10);
  const recoveryLimiter = new RateLimiter(60 * 60_000, 20);

  const limit = (
    request: FastifyRequest,
    reply: FastifyReply,
    limiter: RateLimiter,
    key: string,
  ): boolean => {
    if (!config.rateLimitEnabled) return false;
    const result = limiter.check(`${request.ip}:${key}`);
    if (!result.allowed) {
      reply
        .code(429)
        .header('retry-after', String(result.retryAfterSeconds))
        .send({ error: { code: 'RATE_LIMITED', message: 'Слишком много попыток. Попробуйте позже.' } });
      return true;
    }
    return false;
  };

  app.get('/api/setup/status', async () => ({
    needsSetup: userCount(db) === 0,
    demoAvailable: config.demoMode,
    rpId: config.rpId,
    origin: config.appOrigin,
  }));

  app.post('/api/auth/register/options', async (request, reply) => {
    if (limit(request, reply, loginLimiter, 'register-options')) return;
    const body = registerOptionsSchema.parse(request.body ?? {});
    const users = userCount(db);

    if (users === 0) {
      if (!config.setupToken) {
        return fail(reply, 500, 'SETUP_NOT_CONFIGURED', 'Setup-токен не настроен');
      }
      if (!body.setupToken || !timingSafeEqualString(body.setupToken, config.setupToken)) {
        return fail(reply, 401, 'SETUP_TOKEN_INVALID', 'Неверный setup-токен');
      }
      const userId = newId();
      const { challengeId, options } = await buildRegistrationOptions(db, config, userId);
      return { mode: 'setup', challengeId, options };
    }

    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    if (body.setupToken) {
      return fail(reply, 409, 'ALREADY_SETUP', 'Приложение уже настроено');
    }
    const { challengeId, options } = await buildRegistrationOptions(db, config, auth.userId);
    return { mode: 'add', challengeId, options };
  });

  app.post('/api/auth/register/verify', async (request, reply) => {
    const body = verifyRegistrationSchema.parse(request.body ?? {});
    const result = await verifyRegistration(
      db,
      config,
      body.challengeId,
      body.response as never,
    ).catch(() => null);
    if (!result) return fail(reply, 400, 'REGISTRATION_FAILED', 'Не удалось проверить ключ доступа');

    const isFirstUser = userCount(db) === 0;
    if (!isFirstUser) {
      const auth = requireAuth(request, reply, db, config);
      if (!auth) return;
      if (auth.userId !== result.userId) {
        return fail(reply, 403, 'FORBIDDEN', 'Ключ относится к другому пользователю');
      }
      try {
        savePasskey(db, result.userId, config, result.credential, body.label ?? 'Дополнительный ключ');
      } catch {
        return fail(reply, 409, 'PASSKEY_EXISTS', 'Этот ключ уже зарегистрирован');
      }
      audit(db, {
        userId: result.userId,
        action: 'passkey.add',
        entity: 'passkey',
        entityId: result.credential.id.slice(0, 16),
      });
      return { ok: true, mode: 'add' };
    }

    if (userCount(db) !== 0) {
      return fail(reply, 409, 'ALREADY_SETUP', 'Приложение уже настроено');
    }

    let recoveryCodes: string[] = [];
    withTransaction(db, () => {
      db.prepare('INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)').run(
        result.userId,
        'Владелец',
        nowIso(),
      );
      savePasskey(db, result.userId, config, result.credential, body.label ?? 'Основной ключ');
      seedUserData(db, result.userId, getSettings(db, result.userId).lockTimeoutMinutes);
      recoveryCodes = generateRecoveryCodes(10);
      saveRecoveryCodes(db, result.userId, recoveryCodes);
      audit(db, {
        userId: result.userId,
        action: 'user.setup',
        entity: 'user',
        entityId: result.userId,
      });
    });

    const session = createSession(db, config, result.userId, 'Первое устройство', userAgentHash(request));
    setSessionCookie(reply, config, session.token, session.expiresAt);
    return { ok: true, mode: 'setup', recoveryCodes };
  });

  app.post('/api/auth/login/options', async (request, reply) => {
    if (limit(request, reply, loginLimiter, 'login-options')) return;
    const userId = getOnlyUserId(db);
    if (!userId) return fail(reply, 409, 'NOT_SETUP', 'Сначала настройте приложение');

    const { challengeId, options, rpMismatch } = await buildAuthenticationOptions(
      db,
      config,
      userId,
      'login',
    );
    if (rpMismatch) {
      return fail(
        reply,
        409,
        'RP_MISMATCH',
        'Этот ключ создан для другого адреса. Войдите по коду восстановления и добавьте новый.',
      );
    }
    return { challengeId, options };
  });

  app.post('/api/auth/login/verify', async (request, reply) => {
    if (limit(request, reply, verifyLimiter, 'login-verify')) return;
    const body = verifyAuthenticationSchema.parse(request.body ?? {});
    const result = await verifyAuthentication(
      db,
      config,
      body.challengeId,
      body.response as never,
      'login',
    ).catch(() => null);
    if (!result) return fail(reply, 401, 'LOGIN_FAILED', 'Не удалось войти');

    const session = createSession(
      db,
      config,
      result.userId,
      deviceLabel(request),
      userAgentHash(request),
    );
    setSessionCookie(reply, config, session.token, session.expiresAt);
    audit(db, { userId: result.userId, action: 'auth.login', entity: 'session', entityId: null });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const auth = authFromRequest(request, db, config);
    if (auth) {
      revokeSession(db, auth.session.id_hash);
      audit(db, { userId: auth.userId, action: 'auth.logout', entity: 'session', entityId: null });
    }
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const settings = getSettings(db, auth.userId);
    const passkeys = listPasskeys(db, auth.userId, config.rpId).map((passkey) => ({
      id: passkey.id,
      label: passkey.label,
      rpId: passkey.rp_id,
      createdAt: passkey.created_at,
      lastUsedAt: passkey.last_used_at,
    }));
    const sessions = db
      .prepare(
        `SELECT id_hash, device_label, created_at, last_seen_at, expires_at, unlocked_until
         FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
         ORDER BY last_seen_at DESC`,
      )
      .all(auth.userId, nowIso()) as Array<{
      id_hash: string;
      device_label: string | null;
      created_at: string;
      last_seen_at: string;
      expires_at: string;
      unlocked_until: string | null;
    }>;

    return {
      user: { id: auth.userId, displayName: 'Владелец' },
      passkeys,
      sessions: sessions.map((session) => ({
        id: session.id_hash,
        label: session.device_label,
        createdAt: session.created_at,
        lastSeenAt: session.last_seen_at,
        expiresAt: session.expires_at,
        current: session.id_hash === auth.session.id_hash,
      })),
      recoveryRemaining: remainingRecoveryCodes(db, auth.userId),
      settings,
      session: {
        unlockedUntil: auth.session.unlocked_until,
        lockTimeoutMinutes: settings.lockTimeoutMinutes,
      },
      rpId: config.rpId,
      demoMode: config.demoMode,
    };
  });

  app.post('/api/auth/unlock/options', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const { challengeId, options, rpMismatch } = await buildAuthenticationOptions(
      db,
      config,
      auth.userId,
      'unlock',
    );
    if (rpMismatch) return fail(reply, 409, 'RP_MISMATCH', 'Нет ключа для этого адреса');
    return { challengeId, options };
  });

  app.post('/api/auth/unlock/verify', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    if (limit(request, reply, verifyLimiter, 'unlock')) return;
    const body = verifyAuthenticationSchema.parse(request.body ?? {});
    const result = await verifyAuthentication(
      db,
      config,
      body.challengeId,
      body.response as never,
      'unlock',
    ).catch(() => null);
    if (!result || result.userId !== auth.userId) {
      return fail(reply, 401, 'UNLOCK_FAILED', 'Не удалось разблокировать');
    }
    const minutes = getSettings(db, auth.userId).lockTimeoutMinutes || config.lockTimeoutMinutes;
    const unlockedUntil = unlockSession(db, auth.session.id_hash, minutes);
    return { ok: true, unlockedUntil };
  });

  app.post('/api/auth/recovery', async (request, reply) => {
    if (limit(request, reply, recoveryLimiter, 'recovery')) return;
    const body = recoverySchema.parse(request.body ?? {});
    const userId = getOnlyUserId(db);
    if (!userId) return fail(reply, 409, 'NOT_SETUP', 'Сначала настройте приложение');

    const result = consumeRecoveryCode(db, userId, body.code);
    if (!result.ok) {
      audit(db, { userId, action: 'auth.recovery.failed', entity: 'session', entityId: null });
      return fail(reply, 401, 'RECOVERY_FAILED', 'Код не подошёл или уже использован');
    }

    const session = createSession(
      db,
      config,
      userId,
      deviceLabel(request) + ' (по коду)',
      userAgentHash(request),
    );
    setSessionCookie(reply, config, session.token, session.expiresAt);
    audit(db, { userId, action: 'auth.recovery', entity: 'session', entityId: null });
    return { ok: true, remaining: result.remaining };
  });

  app.get('/api/auth/recovery-codes', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    return { remaining: remainingRecoveryCodes(db, auth.userId) };
  });

  app.post('/api/auth/recovery-codes/regenerate', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const codes = generateRecoveryCodes(10);
    withTransaction(db, () => {
      db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(auth.userId);
      saveRecoveryCodes(db, auth.userId, codes);
      audit(db, {
        userId: auth.userId,
        action: 'recovery.regenerate',
        entity: 'recovery_codes',
        entityId: null,
      });
    });
    return { ok: true, codes };
  });

  app.post('/api/auth/passkeys/options', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const { challengeId, options } = await buildRegistrationOptions(db, config, auth.userId);
    return { challengeId, options };
  });

  app.post('/api/auth/passkeys/verify', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const body = verifyRegistrationSchema.parse(request.body ?? {});
    const result = await verifyRegistration(
      db,
      config,
      body.challengeId,
      body.response as never,
    ).catch(() => null);
    if (!result || result.userId !== auth.userId) {
      return fail(reply, 400, 'REGISTRATION_FAILED', 'Не удалось добавить ключ');
    }
    try {
      savePasskey(db, auth.userId, config, result.credential, body.label ?? 'Дополнительный ключ');
    } catch {
      return fail(reply, 409, 'PASSKEY_EXISTS', 'Этот ключ уже зарегистрирован');
    }
    audit(db, {
      userId: auth.userId,
      action: 'passkey.add',
      entity: 'passkey',
      entityId: result.credential.id.slice(0, 16),
    });
    return { ok: true };
  });

  app.delete('/api/auth/passkeys/:id', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const { id } = request.params as { id: string };
    const passkeys = listPasskeys(db, auth.userId, config.rpId);
    if (passkeys.length <= 1) {
      return fail(reply, 409, 'LAST_PASSKEY', 'Нельзя удалить последний ключ доступа');
    }
    const target = passkeys.find((passkey) => passkey.id === id);
    if (!target) return fail(reply, 404, 'NOT_FOUND', 'Ключ не найден');
    db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(id, auth.userId);
    audit(db, {
      userId: auth.userId,
      action: 'passkey.delete',
      entity: 'passkey',
      entityId: id,
    });
    return { ok: true };
  });

  app.delete('/api/auth/sessions/:id', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const { id } = request.params as { id: string };
    const row = db
      .prepare('SELECT id_hash FROM sessions WHERE id_hash = ? AND user_id = ?')
      .get(id, auth.userId) as { id_hash: string } | undefined;
    if (!row) return fail(reply, 404, 'NOT_FOUND', 'Сессия не найдена');
    revokeSession(db, row.id_hash);
    if (row.id_hash === auth.session.id_hash) clearSessionCookie(reply, config);
    audit(db, {
      userId: auth.userId,
      action: 'session.revoke',
      entity: 'session',
      entityId: row.id_hash.slice(0, 12),
    });
    return { ok: true };
  });
}

function deviceLabel(request: FastifyRequest): string {
  const ua = String(request.headers['user-agent'] ?? '');
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Android/i.test(ua)) return 'Android';
  return 'Браузер';
}
