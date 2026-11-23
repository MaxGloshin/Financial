import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerDataRoutes } from './routes/data.ts';
import { registerAssistantRoutes } from './routes/assistant.ts';
import { registerDevRoutes } from './routes/dev.ts';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function createApp(options: { config: Config; db: Db }): Promise<FastifyInstance> {
  const { config, db } = options;
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    bodyLimit: 1024 * 1024,
    trustProxy: config.appEnv === 'production',
    requestIdHeader: 'x-request-id',
  });

  await app.register(cookie);

  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0];
    if (MUTATING.has(request.method) && url.startsWith('/api')) {
      const origin = request.headers.origin;
      const exempt = url.startsWith('/api/dev/') || url.startsWith('/api/ingest/');
      if (origin && origin !== config.appOrigin) {
        return reply.code(403).send({ error: { code: 'ORIGIN_REJECTED', message: 'Запрос с чужого origin' } });
      }
      if (!origin && !exempt) {
        return reply.code(403).send({ error: { code: 'ORIGIN_REQUIRED', message: 'Не указан Origin' } });
      }
    }
    return undefined;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const csp = config.appEnv === 'production'
      ? [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self'",
          "connect-src 'self'",
          "manifest-src 'self'",
          "worker-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'none'",
          "form-action 'self'",
          "object-src 'none'",
          'upgrade-insecure-requests',
        ].join('; ')
      : [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self' ws: wss:",
          "frame-ancestors 'none'",
          "base-uri 'none'",
          "object-src 'none'",
        ].join('; ');

    reply.header('Content-Security-Policy', csp);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    if (config.appEnv === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
    return payload;
  });

  app.get('/api/health', async () => {
    const row = db.prepare('SELECT 1 AS ok').get();
    const counts = {
      users: Number((db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count),
      transactions: Number(
        (db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number }).count,
      ),
    };
    return {
      ok: row?.ok === 1,
      version: '0.2.0',
      uptimeSeconds: Math.round(process.uptime()),
      env: config.appEnv,
      demoMode: config.demoMode,
      counts,
    };
  });

  registerAuthRoutes(app, db, config);
  registerDataRoutes(app, db, config);
  registerAssistantRoutes(app, db, config);
  registerDevRoutes(app, db, config);

  const staticDir = config.staticDir ? path.resolve(config.staticDir) : null;
  const indexHtml = staticDir ? path.join(staticDir, 'index.html') : null;
  if (staticDir && indexHtml && fs.existsSync(indexHtml)) {
    await app.register(fastifyStatic, { root: staticDir, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Не найдено' } });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Не найдено' } });
      }
      return reply
        .code(404)
        .send({ error: { code: 'NOT_FOUND', message: 'UI не собран. Запустите npm run dev.' } });
    });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      return reply.code(400).send({
        error: {
          code: 'VALIDATION',
          message: first?.message ?? 'Некорректные данные',
          details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
      });
    }

    const message = String(error.message ?? '');
    if (error.name === 'MoneyError') {
      return reply.code(400).send({ error: { code: 'MONEY', message } });
    }
    if (message.includes('UNIQUE constraint failed')) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Такая запись уже существует' } });
    }
    if (/[А-Яа-яЁё]/.test(message) && !message.includes('SQLITE')) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message } });
    }

    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Внутренняя ошибка' } });
  });

  return app;
}
