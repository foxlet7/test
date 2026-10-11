import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config';
import { makeAuthHook } from './auth';
import type { Ctx } from './context';
import type { Db } from './db';
import { AppError } from './errors';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { staffReviewRoutes } from './routes/staff';
import { userRoutes } from './routes/user';
import { MockProvider, NullProvider, type AssessmentProvider } from './services/assessment';
import { makeStore, type BlobStore } from './services/evidenceStore';

export interface BuildOpts {
  cfg: Config;
  db: Db;
  store?: BlobStore;
  provider?: AssessmentProvider;
  now?: () => Date;
  logger?: boolean;
}

export async function buildApp(opts: BuildOpts): Promise<FastifyInstance> {
  const { cfg, db } = opts;
  const ctx: Ctx = {
    cfg, db,
    store: opts.store ?? makeStore(cfg),
    provider: opts.provider ?? (cfg.assessmentProvider === 'mock' ? new MockProvider() : new NullProvider()),
    now: opts.now ?? (() => new Date()),
  };

  const app = Fastify({
    logger: opts.logger ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] } : false,
    bodyLimit: 1_048_576,
    trustProxy: true,
  });

  await app.register(cors, { origin: cfg.corsOrigins.length ? cfg.corsOrigins : false });
  if (cfg.rateLimit) await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: cfg.evidenceMaxBytes, files: 1, fields: 5 } });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    if (err.statusCode === 429) return reply.code(429).send({ error: { code: 'rate_limited' } });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(400).send({ error: { code: 'invalid_size' } });
    if (err.validation || (err.statusCode && err.statusCode < 500)) return reply.code(err.statusCode ?? 400).send({ error: { code: 'bad_request' } });
    req.log.error({ err: { message: err.message, stack: err.stack } }, 'unhandled');
    return reply.code(500).send({ error: { code: 'internal' } }); // never leak internals
  });

  app.get('/health', async () => ({ ok: true }));
  authRoutes(app, ctx);

  const authHook = makeAuthHook(cfg.jwtSecret, db);
  await app.register(async (authed) => {
    authed.addHook('preHandler', async (req, reply) => {
      if (req.routeOptions.url === '/review/audio/:token') return; // carries its own short-lived signed token
      await authHook(req, reply);
    });
    meRoutes(authed, ctx);
    userRoutes(authed, ctx);
    staffReviewRoutes(authed, ctx);
    adminRoutes(authed, ctx);
  });

  app.addHook('onClose', async () => {});
  return app;
}
