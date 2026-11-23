import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.ts';
import type { Db } from '../db.ts';
import { withTransaction } from '../db.ts';
import { audit } from '../lib/audit.ts';
import {
  createSession,
  generateRecoveryCodes,
  getOnlyUserId,
  saveRecoveryCodes,
  setSessionCookie,
  timingSafeEqualString,
  userAgentHash,
  userCount,
} from '../lib/auth.ts';
import { newId, nowIso } from '../lib/ids.ts';
import { seedUserData } from '../seed.ts';
import { fail } from './auth.ts';

export function registerDevRoutes(app: FastifyInstance, db: Db, config: Config): void {
  if (!config.demoMode) return;

  app.post('/api/dev/bootstrap', async (request, reply) => {
    const body = z.object({ token: z.string().min(1).max(200) }).strict().parse(request.body ?? {});
    if (!config.demoToken || !timingSafeEqualString(body.token, config.demoToken)) {
      return fail(reply, 401, 'DEMO_TOKEN_INVALID', 'Неверный токен демонстрации');
    }

    let userId = getOnlyUserId(db);
    let recoveryCodes: string[] | null = null;

    if (!userId) {
      userId = newId();
      const finalUserId = userId;
      withTransaction(db, () => {
        db.prepare('INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)').run(
          finalUserId,
          'Демо-владелец',
          nowIso(),
        );
        seedUserData(db, finalUserId, config.lockTimeoutMinutes);
        recoveryCodes = generateRecoveryCodes(10);
        saveRecoveryCodes(db, finalUserId, recoveryCodes);
        audit(db, {
          userId: finalUserId,
          actor: 'demo',
          action: 'user.demo_setup',
          entity: 'user',
          entityId: finalUserId,
        });
      });
    }

    if (userCount(db) === 0) {
      return fail(reply, 500, 'DEMO_SETUP_FAILED', 'Не удалось создать демо-пользователя');
    }

    const session = createSession(
      db,
      config,
      userId,
      'Локальная демонстрация',
      userAgentHash(request),
    );
    setSessionCookie(reply, config, session.token, session.expiresAt);
    audit(db, {
      userId,
      actor: 'demo',
      action: 'auth.demo_login',
      entity: 'session',
      entityId: null,
    });

    return { ok: true, recoveryCodes, demo: true };
  });
}
