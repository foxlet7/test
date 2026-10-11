import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BOARDS, PERIODS, TRADITIONS, formatDate, type Board, type Period, type Tradition } from '@gdc/shared';
import { Ctx, dateStr, parse } from '../context';
import { badRequest, conflict, notFound } from '../errors';
import { createLog } from '../services/logs';
import { buildDashboard } from '../services/dashboard';
import { getLeaderboard } from '../services/leaderboard';
import { applyUserVerificationRoutes } from './verification';

export function userRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  async function profileTradition(userId: string): Promise<Tradition | null> {
    const r = await db.query<{ tradition: Tradition | null }>('select tradition from profiles where user_id = $1', [userId]);
    return r.rows[0]?.tradition ?? null;
  }

  // Catalogue: only APPROVED versions are ever shown to users.
  app.get('/catalogue', async (req) => {
    const q = parse(z.object({
      tradition: z.enum(TRADITIONS).optional(),
      q: z.string().max(100).optional(),
      category: z.string().max(30).optional(),
    }), req.query);
    const tradition = q.tradition ?? (await profileTradition(req.user!.id));
    if (!tradition) return { tradition: null, items: [] };
    const r = await db.query(
      `select d.id, d.tradition, d.category, d.type, d.obligation_class, d.verification_class,
              v.id version_id, v.version, v.base_points, v.repeat_policy, v.title_en, v.title_ar,
              v.description_en, v.description_ar, v.notes_en, v.notes_ar, v.religious_references, v.translation_status,
              exists(select 1 from scripture_tasks s where s.activity_id = d.id and s.status = 'approved') verifiable
         from activity_definitions d
         join lateral (select * from activity_versions x where x.activity_id = d.id and x.status = 'approved' order by x.version desc limit 1) v on true
        where d.tradition = $1
          and ($2::text is null or d.category = $2::text)
          and ($3::text is null or lower(v.title_en) like '%' || lower($3::text) || '%' or v.title_ar like '%' || $3::text || '%')
        order by d.category, v.title_en`,
      [tradition, q.category ?? null, q.q ?? null],
    );
    return { tradition, items: r.rows };
  });

  app.get('/scripture-tasks/:activityId', async (req) => {
    const { activityId } = req.params as { activityId: string };
    const r = await db.query(
      "select id, activity_id, title_en, title_ar, passage_ref, reference_edition, permitted_variations from scripture_tasks where activity_id = $1 and status = 'approved'", [activityId]);
    if (!r.rows[0]) throw notFound('task_not_found');
    return r.rows[0];
  });

  app.post('/reports', async (req) => {
    const b = parse(z.object({
      kind: z.enum(['content_error', 'translation_error', 'abuse', 'other']),
      target: z.string().max(200).optional(),
      message: z.string().max(2000).optional(),
    }), req.body);
    await db.query('insert into reports(user_id, kind, target, message) values ($1,$2,$3,$4)', [req.user!.id, b.kind, b.target ?? null, b.message ?? null]);
    return { ok: true };
  });

  // Logging ---------------------------------------------------------------------
  app.post('/logs', async (req, reply) => {
    const b = parse(z.object({
      activityId: z.string().min(1).max(100),
      localDate: dateStr,
      tz: z.string().max(64).default('UTC'),
      note: z.string().max(2000).nullable().optional(),
      milestoneKey: z.string().min(1).max(100).nullable().optional(),
      idempotencyKey: z.string().min(8).max(100),
    }), req.body);
    const res = await createLog(db, req.user!.id, b, ctx.now());
    reply.code(res.duplicate ? 200 : 201);
    return res;
  });

  app.get('/logs', async (req) => {
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional() }), req.query);
    const r = await db.query(
      `select l.id, l.activity_id, l.local_date, l.status, l.note, l.milestone_key, l.created_at, l.verified_at, v.title_en, v.title_ar,
              (select coalesce(sum(eligible_points),0)::int from ledger_entries e where e.log_id = l.id) points
         from activity_logs l join activity_versions v on v.id = l.activity_version_id
        where l.user_id = $1 and ($2::date is null or l.local_date >= $2::date) and ($3::date is null or l.local_date <= $3::date)
        order by l.local_date desc, l.created_at desc limit 500`, [req.user!.id, q.from ?? null, q.to ?? null]);
    return { logs: r.rows };
  });

  app.patch('/logs/:id/note', async (req) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ note: z.string().max(2000).nullable() }), req.body);
    const r = await db.query('update activity_logs set note = $3 where id = $1 and user_id = $2', [id, req.user!.id, b.note]);
    if (!r.rowCount) throw notFound('log_not_found');
    return { ok: true };
  });

  app.get('/dashboard', async (req) => buildDashboard(db, req.user!.id, formatDate(ctx.now())));

  // Rankings: opt-in per board; the public view exposes pseudonym, score and rank only.
  app.get('/leaderboards/:board', async (req) => {
    const { board } = req.params as { board: string };
    if (!(BOARDS as readonly string[]).includes(board)) throw badRequest('bad_board');
    const q = parse(z.object({ period: z.enum(PERIODS).default('weekly') }), req.query);
    const tradition = await profileTradition(req.user!.id);
    if (!tradition) throw badRequest('tradition_required');
    const res = await getLeaderboard(db, board as Board, q.period as Period, tradition, formatDate(ctx.now()), req.user!.id);
    const member = await db.query('select 1 from leaderboard_memberships where user_id = $1 and board = $2', [req.user!.id, board]);
    return { ...res, isMember: member.rows.length > 0 };
  });

  app.post('/leaderboards/:board/membership', async (req) => {
    const { board } = req.params as { board: string };
    if (!(BOARDS as readonly string[]).includes(board)) throw badRequest('bad_board');
    parse(z.object({ consent: z.literal(true) }), req.body); // explicit, separate consent per board
    const id = req.user!.id;
    if (!(await profileTradition(id))) throw badRequest('tradition_required');
    await db.tx(async (t) => {
      await t.query("insert into consents(user_id, type, version) values ($1,$2,'v1') on conflict (user_id, type) where revoked_at is null do nothing", [id, `leaderboard_${board}`]);
      await t.query('insert into leaderboard_memberships(user_id, board) values ($1,$2) on conflict do nothing', [id, board]);
    });
    return { ok: true };
  });

  app.delete('/leaderboards/:board/membership', async (req) => {
    const { board } = req.params as { board: string };
    if (!(BOARDS as readonly string[]).includes(board)) throw badRequest('bad_board');
    const id = req.user!.id;
    await db.tx(async (t) => {
      await t.query('delete from leaderboard_memberships where user_id = $1 and board = $2', [id, board]);
      await t.query('update consents set revoked_at = now() where user_id = $1 and type = $2 and revoked_at is null', [id, `leaderboard_${board}`]);
    });
    return { ok: true };
  });

  applyUserVerificationRoutes(app, ctx);
  void conflict;
}
