import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CONSENT_TYPES, LANGUAGES, TRADITIONS } from '@gdc/shared';
import { Ctx, parse, pseudonymSchema } from '../context';
import { conflict } from '../errors';
import { deleteAccount, exportAccount } from '../services/account';

export function meRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.get('/me', async (req) => {
    const id = req.user!.id;
    const p = await db.query('select pseudonym, ui_language, tradition, weekly_goal from profiles where user_id = $1', [id]);
    const c = await db.query('select type, version, granted_at from consents where user_id = $1 and revoked_at is null', [id]);
    const m = await db.query('select board from leaderboard_memberships where user_id = $1', [id]);
    return { id, roles: req.user!.roles, profile: p.rows[0], consents: c.rows, memberships: m.rows.map((r: any) => r.board) };
  });

  app.patch('/me/profile', async (req) => {
    const id = req.user!.id;
    const b = parse(z.object({
      pseudonym: pseudonymSchema.optional(),
      uiLanguage: z.enum(LANGUAGES).optional(),
      tradition: z.enum(TRADITIONS).nullable().optional(),
      weeklyGoal: z.number().int().min(1).max(100).optional(),
    }), req.body);
    await db.tx(async (t) => {
      if (b.pseudonym) {
        const dup = await t.query('select 1 from profiles where lower(pseudonym) = lower($1) and user_id <> $2', [b.pseudonym, id]);
        if (dup.rows.length) throw conflict('pseudonym_taken');
        await t.query('update profiles set pseudonym = $2 where user_id = $1', [id, b.pseudonym]);
      }
      if (b.uiLanguage) await t.query('update profiles set ui_language = $2 where user_id = $1', [id, b.uiLanguage]);
      if (b.weeklyGoal) await t.query('update profiles set weekly_goal = $2 where user_id = $1', [id, b.weeklyGoal]);
      if (b.tradition !== undefined) {
        const cur = await t.query<{ tradition: string | null }>('select tradition from profiles where user_id = $1', [id]);
        if (cur.rows[0]!.tradition !== b.tradition) {
          // Rankings are per tradition: leaving the tradition leaves its rankings (prompt removal).
          await t.query('delete from leaderboard_memberships where user_id = $1', [id]);
          await t.query("update consents set revoked_at = now() where user_id = $1 and type in ('leaderboard_A','leaderboard_B') and revoked_at is null", [id]);
          await t.query('update profiles set tradition = $2 where user_id = $1', [id, b.tradition]);
        }
      }
    });
    return { ok: true };
  });

  app.get('/me/consents', async (req) => {
    const r = await db.query('select type, version, granted_at, revoked_at from consents where user_id = $1 order by id', [req.user!.id]);
    return { consents: r.rows };
  });

  app.post('/me/consents', async (req) => {
    const id = req.user!.id;
    const b = parse(z.object({ type: z.enum(CONSENT_TYPES), granted: z.boolean() }), req.body);
    if (b.type === 'account' && !b.granted) throw conflict('use_account_deletion');
    await db.tx(async (t) => {
      if (b.granted) {
        await t.query("insert into consents(user_id, type, version) values ($1,$2,'v1') on conflict (user_id, type) where revoked_at is null do nothing", [id, b.type]);
      } else {
        await t.query('update consents set revoked_at = now() where user_id = $1 and type = $2 and revoked_at is null', [id, b.type]);
        if (b.type === 'leaderboard_A') await t.query("delete from leaderboard_memberships where user_id = $1 and board = 'A'", [id]);
        if (b.type === 'leaderboard_B') await t.query("delete from leaderboard_memberships where user_id = $1 and board = 'B'", [id]);
      }
    });
    return { ok: true };
  });

  app.get('/me/export', async (req) => exportAccount(db, req.user!.id));

  /** Delete stored recordings/receipts now. Blocked while a submission is awaiting review. */
  app.delete('/me/evidence', async (req) => {
    const id = req.user!.id;
    const pending = await db.query("select 1 from verification_submissions where user_id = $1 and status in ('pending_review','under_investigation')", [id]);
    if (pending.rows.length) throw conflict('pending_review');
    const ev = await db.query<{ id: string; storage_key: string }>('select id, storage_key from evidence_objects where user_id = $1 and storage_key is not null', [id]);
    for (const e of ev.rows) {
      await ctx.store.delete(e.storage_key);
      await db.query('update evidence_objects set storage_key = null, deleted_at = now() where id = $1', [e.id]);
    }
    return { deleted: ev.rows.length };
  });

  app.delete('/me', async (req) => {
    parse(z.object({ confirm: z.literal(true) }), req.body);
    await deleteAccount(db, ctx.store, req.user!.id, 'app', ctx.now());
    return { ok: true };
  });
}
