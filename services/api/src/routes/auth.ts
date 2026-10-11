import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LANGUAGES, TRADITIONS, type Role } from '@gdc/shared';
import { hashPassword, newToken, sha256, signAccess, verifyPassword } from '../auth';
import { Ctx, parse, pseudonymSchema } from '../context';
import { badRequest, conflict, unauthorized } from '../errors';
import { audit } from '../services/audit';
import { deleteAccount } from '../services/account';

const REFRESH_DAYS = 30;
const CONSENT_VERSION = 'v1';

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, cfg } = ctx;
  const strict = { config: { rateLimit: cfg.rateLimit ? { max: 10, timeWindow: '1 minute' } : false } };

  async function issue(userId: string) {
    const roles = (await db.query<{ role: Role }>('select role from user_roles where user_id = $1', [userId])).rows.map((r) => r.role);
    const refresh = newToken();
    await db.query('insert into refresh_tokens(user_id, token_hash, expires_at) values ($1,$2,$3::timestamptz)',
      [userId, sha256(refresh), new Date(ctx.now().getTime() + REFRESH_DAYS * 86_400_000).toISOString()]);
    return { accessToken: signAccess(cfg.jwtSecret, { id: userId, roles }), refreshToken: refresh, roles };
  }

  const registerSchema = z.object({
    email: z.string().email().max(254),
    password: z.string().min(10).max(200),
    inviteCode: z.string().min(1).max(64),
    adultConfirmed: z.literal(true),
    pseudonym: pseudonymSchema,
    uiLanguage: z.enum(LANGUAGES).default('en'),
    tradition: z.enum(TRADITIONS).nullable().optional(),
  });

  app.post('/auth/register', strict, async (req, reply) => {
    const b = parse(registerSchema, req.body);
    const email = b.email.toLowerCase();
    const hash = await hashPassword(b.password);
    const userId = await db.tx(async (t) => {
      const inv = await t.query(
        'update invites set uses = uses + 1 where code = $1 and active and uses < max_uses returning code', [b.inviteCode]);
      if (!inv.rows[0]) throw badRequest('invite_invalid');
      if ((await t.query('select 1 from users where lower(email) = $1', [email])).rows.length) throw conflict('email_taken');
      if ((await t.query('select 1 from profiles where lower(pseudonym) = lower($1)', [b.pseudonym])).rows.length) throw conflict('pseudonym_taken');
      const u = await t.query<{ id: string }>('insert into users(email, password_hash, invite_code) values ($1,$2,$3) returning id', [email, hash, b.inviteCode]);
      const id = u.rows[0]!.id;
      await t.query('insert into profiles(user_id, pseudonym, ui_language, tradition, adult_confirmed_at) values ($1,$2,$3,$4,$5::timestamptz)',
        [id, b.pseudonym, b.uiLanguage, b.tradition ?? null, ctx.now().toISOString()]);
      await t.query("insert into consents(user_id, type, version) values ($1,'account',$2)", [id, CONSENT_VERSION]);
      return id;
    });
    reply.code(201);
    return { userId: userId, ...(await issue(userId)) };
  });

  app.post('/auth/login', strict, async (req) => {
    const b = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
    const u = await db.query<{ id: string; password_hash: string; status: string }>('select id, password_hash, status from users where lower(email) = $1', [b.email.toLowerCase()]);
    const row = u.rows[0];
    // Always run a hash to keep timing similar for unknown emails.
    const ok = await verifyPassword(b.password, row?.password_hash ?? 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    if (!row || !ok || row.status !== 'active') throw unauthorized('invalid_credentials');
    await db.query('update users set last_seen_at = now() where id = $1', [row.id]);
    return { userId: row.id, ...(await issue(row.id)) };
  });

  app.post('/auth/refresh', strict, async (req) => {
    const b = parse(z.object({ refreshToken: z.string().min(10).max(200) }), req.body);
    const h = sha256(b.refreshToken);
    const out = await db.tx(async (t) => {
      const r = await t.query<{ id: string; user_id: string }>(
        'select id, user_id from refresh_tokens where token_hash = $1 and revoked_at is null and expires_at > $2::timestamptz for update', [h, ctx.now().toISOString()]);
      if (!r.rows[0]) throw unauthorized('invalid_refresh');
      await t.query('update refresh_tokens set revoked_at = now() where id = $1', [r.rows[0].id]); // rotation
      return r.rows[0].user_id;
    });
    const st = await db.query<{ status: string }>('select status from users where id = $1', [out]);
    if (st.rows[0]?.status !== 'active') throw unauthorized('account_unavailable');
    return { userId: out, ...(await issue(out)) };
  });

  app.post('/auth/logout', async (req) => {
    const b = parse(z.object({ refreshToken: z.string().min(10).max(200) }), req.body);
    await db.query('update refresh_tokens set revoked_at = now() where token_hash = $1', [sha256(b.refreshToken)]);
    return { ok: true };
  });

  // Account recovery. Always answers the same way to avoid account enumeration.
  app.post('/auth/recover/request', strict, async (req) => {
    const b = parse(z.object({ email: z.string().email() }), req.body);
    const u = await db.query<{ id: string }>('select id from users where lower(email) = $1', [b.email.toLowerCase()]);
    let token: string | undefined;
    if (u.rows[0]) {
      token = newToken();
      await db.query('insert into password_resets(token_hash, user_id, expires_at) values ($1,$2,$3::timestamptz)',
        [sha256(token), u.rows[0].id, new Date(ctx.now().getTime() + 3_600_000).toISOString()]);
      // Production: deliver `token` by email through the mail provider. Never return it.
    }
    return cfg.exposeResetTokens && token ? { ok: true, devToken: token } : { ok: true };
  });

  app.post('/auth/recover/confirm', strict, async (req) => {
    const b = parse(z.object({ token: z.string().min(10), password: z.string().min(10).max(200) }), req.body);
    const hash = await hashPassword(b.password);
    await db.tx(async (t) => {
      const r = await t.query<{ user_id: string }>(
        'update password_resets set used_at = now() where token_hash = $1 and used_at is null and expires_at > $2::timestamptz returning user_id', [sha256(b.token), ctx.now().toISOString()]);
      if (!r.rows[0]) throw badRequest('invalid_token');
      await t.query('update users set password_hash = $2 where id = $1', [r.rows[0].user_id, hash]);
      await t.query('update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [r.rows[0].user_id]);
      await audit(t, null, 'auth.password_reset', sha256(r.rows[0].user_id));
    });
    return { ok: true };
  });

  // Web-based deletion request (required by Google Play in addition to the in-app flow).
  app.post('/public/deletion-request', strict, async (req) => {
    const b = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
    const u = await db.query<{ id: string; password_hash: string }>('select id, password_hash from users where lower(email) = $1', [b.email.toLowerCase()]);
    if (!u.rows[0] || !(await verifyPassword(b.password, u.rows[0].password_hash))) throw unauthorized('invalid_credentials');
    await deleteAccount(db, ctx.store, u.rows[0].id, 'web', ctx.now());
    return { ok: true };
  });
}
