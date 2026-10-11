import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TRADITIONS, type Role, type Tradition } from '@gdc/shared';
import { requireRoles } from '../auth';
import { Ctx, parse } from '../context';
import { forbidden, notFound, unauthorized } from '../errors';
import { audit } from '../services/audit';
import { applyDecision } from '../services/verification';

const TRADITION_ROLE: Record<Tradition, Role> = { islam: 'islamic_reviewer', christianity: 'christian_reviewer' };
const AUDIO_URL_TTL_MS = 5 * 60_000;

/** A verification reviewer may only assess tasks of a tradition they are a qualified reviewer for. */
export function reviewerTraditions(roles: Role[]): Tradition[] {
  if (roles.includes('super_admin')) return [...TRADITIONS];
  if (!roles.includes('verification_reviewer')) return [];
  return TRADITIONS.filter((t) => roles.includes(TRADITION_ROLE[t]));
}
export const canApproveContent = (roles: Role[], tradition: Tradition) =>
  roles.includes('super_admin') || roles.includes(TRADITION_ROLE[tradition]);

export function staffReviewRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, cfg } = ctx;
  const deps = { cfg, db, store: ctx.store, provider: ctx.provider };
  const guard = requireRoles('verification_reviewer');

  const sign = (payload: string) => createHmac('sha256', cfg.jwtSecret).update(payload).digest('base64url');

  // Reviewers see the task, rubric and recording only — never identity, rank or unrelated records.
  app.get('/review/tasks', { preHandler: guard }, async (req) => {
    const traditions = reviewerTraditions(req.user!.roles);
    if (!traditions.length) return { tasks: [] };
    const r = await db.query(
      `select t.id, t.kind, t.created_at, s.risk_flags, s.ai_result,
              st.id scripture_task_id, st.title_en, st.title_ar, st.tradition, st.passage_ref, st.reference_edition, st.permitted_variations, st.rubric
         from review_tasks t
         join verification_submissions s on s.id = t.submission_id
         join scripture_tasks st on st.id = s.task_id
        where t.status = 'open' and st.tradition = any($1::text[])
          and (t.excluded_reviewer is null or t.excluded_reviewer <> $2)
        order by t.created_at limit 100`, [traditions, req.user!.id]);
    return { tasks: r.rows };
  });

  async function loadTask(taskId: number, roles: Role[]) {
    const r = await db.query<{ id: number; submission_id: string; evidence_id: string | null; tradition: Tradition; status: string; excluded_reviewer: string | null }>(
      `select t.id, t.submission_id, s.evidence_id, st.tradition, t.status, t.excluded_reviewer
         from review_tasks t join verification_submissions s on s.id = t.submission_id join scripture_tasks st on st.id = s.task_id where t.id = $1`, [taskId]);
    const t = r.rows[0];
    if (!t) throw notFound('task_not_found');
    if (!reviewerTraditions(roles).includes(t.tradition)) throw forbidden('not_qualified');
    return t;
  }

  app.post('/review/tasks/:id/audio-url', { preHandler: guard }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const t = await loadTask(id, req.user!.roles);
    if (t.excluded_reviewer === req.user!.id || t.status !== 'open') throw forbidden('reviewer_conflict');
    const payload = Buffer.from(JSON.stringify({ t: id, r: req.user!.id, e: ctx.now().getTime() + AUDIO_URL_TTL_MS })).toString('base64url');
    await audit(db, req.user!.id, 'evidence.url_issued', String(id));
    return { url: `/review/audio/${payload}.${sign(payload)}`, expiresInSeconds: AUDIO_URL_TTL_MS / 1000 };
  });

  app.get('/review/audio/:token', async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) throw unauthorized('invalid_token');
    const a = Buffer.from(sig), b = Buffer.from(sign(payload));
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw unauthorized('invalid_token');
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { t: number; r: string; e: number };
    if (p.e < ctx.now().getTime()) throw unauthorized('expired_token');
    const row = await db.query<{ storage_key: string | null; mime: string | null; status: string }>(
      `select e.storage_key, e.mime, t.status from review_tasks t join verification_submissions s on s.id = t.submission_id
         join evidence_objects e on e.id = s.evidence_id where t.id = $1`, [p.t]);
    const e = row.rows[0];
    if (!e || !e.storage_key || e.status === 'done') throw notFound('evidence_unavailable');
    await audit(db, p.r, 'evidence.accessed', String(p.t));
    const audio = await ctx.store.get(e.storage_key);
    reply.header('Content-Type', e.mime ?? 'application/octet-stream').header('Cache-Control', 'no-store');
    return reply.send(audio);
  });

  app.post('/review/tasks/:id/decision', { preHandler: guard }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const b = parse(z.object({
      decision: z.enum(['verified', 'unable_to_verify', 'rejected', 'under_investigation']),
      rubric: z.record(z.string(), z.unknown()).default({}),
      notes: z.string().max(2000).nullable().optional(),
    }), req.body);
    const t = await loadTask(id, req.user!.roles);
    await applyDecision(deps, t.submission_id, req.user!.id, b.decision, b.rubric, b.notes ?? null, ctx.now());
    return { ok: true };
  });
}
