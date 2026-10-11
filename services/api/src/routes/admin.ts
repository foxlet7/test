import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CATEGORIES, CONTENT_STATUSES, DEFAULT_SCORING_RULE, OBLIGATION_CLASSES, ROLES, TRADITIONS, VERIFICATION_CLASSES, formatDate, periodRange, sumLedger, type Role, type Tradition,
} from '@gdc/shared';
import { requireRoles, STAFF_ROLES } from '../auth';
import { Ctx, dateStr, parse } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { audit } from '../services/audit';
import { ledgerInvariants } from '../services/ledger';
import { runRetention } from '../services/retention';
import { getLeaderboard } from '../services/leaderboard';
import { canApproveContent } from './staff';

const repeatSchema = z.union([
  z.object({ kind: z.literal('per_day'), max: z.number().int().min(1).max(20) }),
  z.object({ kind: z.literal('per_week'), max: z.number().int().min(1).max(50) }),
  z.object({ kind: z.literal('per_milestone') }),
]);
const refSchema = z.array(z.object({ label: z.string().max(200), source: z.string().max(300), verified: z.boolean().default(false) })).max(20);
const versionFields = z.object({
  basePoints: z.number().int().min(0).max(100),
  repeatPolicy: repeatSchema,
  titleEn: z.string().min(1).max(200), titleAr: z.string().min(1).max(200),
  descriptionEn: z.string().min(1).max(2000), descriptionAr: z.string().min(1).max(2000),
  notesEn: z.string().max(2000).nullable().optional(), notesAr: z.string().max(2000).nullable().optional(),
  religiousReferences: refSchema.default([]),
});

export function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, cfg } = ctx;
  const anyStaff = requireRoles(...STAFF_ROLES);
  const contentAdmin = requireRoles('content_admin');
  const superAdmin = requireRoles('super_admin');
  const audits = requireRoles('auditor', 'moderator');

  // ---- Content -------------------------------------------------------------------
  app.get('/admin/content', { preHandler: anyStaff }, async () => {
    const r = await db.query(
      `select d.id activity_id, d.tradition, d.category, d.type, d.obligation_class, d.verification_class,
              v.id version_id, v.version, v.status, v.base_points, v.repeat_policy, v.title_en, v.title_ar, v.description_en, v.description_ar,
              v.notes_en, v.notes_ar, v.religious_references, v.translation_status, v.authored_by, v.approved_by, v.approved_at
         from activity_definitions d join activity_versions v on v.activity_id = d.id order by d.tradition, d.id, v.version desc`);
    return { versions: r.rows };
  });

  app.post('/admin/content', { preHandler: contentAdmin }, async (req, reply) => {
    const b = parse(versionFields.extend({
      id: z.string().regex(/^[a-z0-9_.]{3,80}$/),
      tradition: z.enum(TRADITIONS), category: z.enum(CATEGORIES),
      type: z.enum(['recurring', 'milestone', 'event', 'measurable']),
      obligationClass: z.enum(OBLIGATION_CLASSES), verificationClass: z.enum(VERIFICATION_CLASSES).default('A'),
    }), req.body);
    await db.tx(async (t) => {
      await t.query('insert into activity_definitions(id, tradition, category, type, obligation_class, verification_class) values ($1,$2,$3,$4,$5,$6)',
        [b.id, b.tradition, b.category, b.type, b.obligationClass, b.verificationClass]);
      await t.query(
        `insert into activity_versions(activity_id, version, base_points, repeat_policy, title_en, title_ar, description_en, description_ar, notes_en, notes_ar, religious_references, authored_by)
         values ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [b.id, b.basePoints, JSON.stringify(b.repeatPolicy), b.titleEn, b.titleAr, b.descriptionEn, b.descriptionAr, b.notesEn ?? null, b.notesAr ?? null, JSON.stringify(b.religiousReferences), req.user!.id]);
      await audit(t, req.user!.id, 'content.created', b.id);
    }).catch((e) => { if (String(e.message).includes('duplicate key')) throw conflict('activity_exists'); throw e; });
    reply.code(201);
    return { ok: true };
  });

  app.post('/admin/content/:activityId/versions', { preHandler: contentAdmin }, async (req, reply) => {
    const { activityId } = req.params as { activityId: string };
    const b = parse(versionFields, req.body);
    const mx = await db.query<{ m: number | null }>('select max(version)::int m from activity_versions where activity_id = $1', [activityId]);
    if (mx.rows[0]!.m == null) throw notFound('activity_not_found');
    const open = await db.query("select 1 from activity_versions where activity_id = $1 and status in ('draft','in_review')", [activityId]);
    if (open.rows.length) throw conflict('open_version_exists');
    await db.query(
      `insert into activity_versions(activity_id, version, base_points, repeat_policy, title_en, title_ar, description_en, description_ar, notes_en, notes_ar, religious_references, authored_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [activityId, mx.rows[0]!.m! + 1, b.basePoints, JSON.stringify(b.repeatPolicy), b.titleEn, b.titleAr, b.descriptionEn, b.descriptionAr, b.notesEn ?? null, b.notesAr ?? null, JSON.stringify(b.religiousReferences), req.user!.id]);
    await audit(db, req.user!.id, 'content.version_created', activityId);
    reply.code(201);
    return { ok: true };
  });

  app.patch('/admin/content/versions/:id', { preHandler: contentAdmin }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const b = parse(versionFields, req.body);
    const r = await db.query(
      `update activity_versions set base_points=$2, repeat_policy=$3, title_en=$4, title_ar=$5, description_en=$6, description_ar=$7, notes_en=$8, notes_ar=$9,
              religious_references=$10, translation_status='machine_draft'
        where id = $1 and status = 'draft'`,
      [id, b.basePoints, JSON.stringify(b.repeatPolicy), b.titleEn, b.titleAr, b.descriptionEn, b.descriptionAr, b.notesEn ?? null, b.notesAr ?? null, JSON.stringify(b.religiousReferences)]);
    if (!r.rowCount) throw conflict('not_editable');
    await audit(db, req.user!.id, 'content.edited', String(id));
    return { ok: true };
  });

  app.post('/admin/content/versions/:id/submit', { preHandler: contentAdmin }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const r = await db.query("update activity_versions set status='in_review' where id = $1 and status in ('draft')", [id]);
    if (!r.rowCount) throw conflict('not_submittable');
    await audit(db, req.user!.id, 'content.submitted', String(id));
    return { ok: true };
  });

  app.post('/admin/content/versions/:id/translation-review', { preHandler: requireRoles('translation_reviewer') }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const r = await db.query("update activity_versions set translation_status='reviewed' where id = $1 and status in ('draft','in_review')", [id]);
    if (!r.rowCount) throw conflict('not_reviewable');
    await db.query("insert into review_records(activity_version_id, reviewer_id, reviewer_role, decision, notes) values ($1,$2,'translation_reviewer','approve','translation reviewed')", [id, req.user!.id]);
    await audit(db, req.user!.id, 'content.translation_reviewed', String(id));
    return { ok: true };
  });

  app.post('/admin/content/versions/:id/review', { preHandler: requireRoles('islamic_reviewer', 'christian_reviewer') }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const b = parse(z.object({ decision: z.enum(['approve', 'request_changes', 'comment']), notes: z.string().max(2000).nullable().optional() }), req.body);
    await db.tx(async (t) => {
      const v = await t.query<{ activity_id: string; status: string; authored_by: string | null; translation_status: string; tradition: Tradition }>(
        `select v.activity_id, v.status, v.authored_by, v.translation_status, d.tradition from activity_versions v join activity_definitions d on d.id = v.activity_id where v.id = $1 for update of v`, [id]);
      const row = v.rows[0];
      if (!row) throw notFound('version_not_found');
      if (!canApproveContent(req.user!.roles, row.tradition)) throw forbidden('not_qualified');
      const role = req.user!.roles.includes('super_admin') ? 'super_admin' : (row.tradition === 'islam' ? 'islamic_reviewer' : 'christian_reviewer');
      await t.query('insert into review_records(activity_version_id, reviewer_id, reviewer_role, decision, notes) values ($1,$2,$3,$4,$5)', [id, req.user!.id, role, b.decision, b.notes ?? null]);
      if (b.decision === 'approve') {
        if (row.status !== 'in_review') throw conflict('not_in_review');
        if (row.authored_by === req.user!.id) throw forbidden('author_cannot_approve');
        if (row.translation_status !== 'reviewed') throw conflict('translation_not_reviewed');
        await t.query("update activity_versions set status='retired' where activity_id = $1 and status='approved'", [row.activity_id]);
        await t.query("update activity_versions set status='approved', approved_by=$2, approved_at=now() where id = $1", [id, req.user!.id]);
      } else if (b.decision === 'request_changes' && row.status === 'in_review') {
        await t.query("update activity_versions set status='draft' where id = $1", [id]);
      }
      await audit(t, req.user!.id, `content.review.${b.decision}`, String(id));
    });
    return { ok: true };
  });

  app.get('/admin/content/versions/:id/reviews', { preHandler: anyStaff }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    return { reviews: (await db.query('select reviewer_role, decision, notes, created_at from review_records where activity_version_id = $1 order by id', [id])).rows };
  });

  // ---- Scripture tasks --------------------------------------------------------------
  const taskFields = z.object({
    titleEn: z.string().min(1).max(200), titleAr: z.string().min(1).max(200),
    passageRef: z.string().max(200).nullable().optional(), referenceEdition: z.string().max(300).nullable().optional(),
    permittedVariations: z.string().max(2000).nullable().optional(),
    rubric: z.array(z.object({ criterion: z.string().max(300), required: z.boolean().default(true) })).max(20).default([]),
  });
  app.get('/admin/scripture-tasks', { preHandler: anyStaff }, async () => ({ tasks: (await db.query('select * from scripture_tasks order by tradition, id')).rows }));
  app.put('/admin/scripture-tasks/:id', { preHandler: contentAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const b = parse(taskFields.extend({ activityId: z.string() }), req.body);
    const act = await db.query<{ tradition: string }>('select tradition from activity_definitions where id = $1', [b.activityId]);
    if (!act.rows[0]) throw notFound('activity_not_found');
    await db.query(
      `insert into scripture_tasks(id, activity_id, tradition, title_en, title_ar, passage_ref, reference_edition, permitted_variations, rubric)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (id) do update set title_en=$4, title_ar=$5, passage_ref=$6, reference_edition=$7, permitted_variations=$8, rubric=$9, status='draft', approved_by=null, approved_at=null`,
      [id, b.activityId, act.rows[0].tradition, b.titleEn, b.titleAr, b.passageRef ?? null, b.referenceEdition ?? null, b.permittedVariations ?? null, JSON.stringify(b.rubric)]);
    await audit(db, req.user!.id, 'scripture_task.saved', id);
    return { ok: true };
  });
  app.post('/admin/scripture-tasks/:id/approve', { preHandler: requireRoles('islamic_reviewer', 'christian_reviewer') }, async (req) => {
    const { id } = req.params as { id: string };
    const t = await db.query<{ tradition: Tradition; passage_ref: string | null; reference_edition: string | null; rubric: unknown[] }>('select tradition, passage_ref, reference_edition, rubric from scripture_tasks where id = $1', [id]);
    const row = t.rows[0];
    if (!row) throw notFound('task_not_found');
    if (!canApproveContent(req.user!.roles, row.tradition)) throw forbidden('not_qualified');
    if (!row.passage_ref || !row.reference_edition || !row.rubric.length) throw badRequest('task_incomplete');
    await db.query("update scripture_tasks set status='approved', approved_by=$2, approved_at=now() where id = $1", [id, req.user!.id]);
    await audit(db, req.user!.id, 'scripture_task.approved', id);
    return { ok: true };
  });

  // ---- Scoring rules ------------------------------------------------------------------
  app.get('/admin/scoring-rules', { preHandler: anyStaff }, async () => ({ rules: (await db.query('select version, config, effective_from, note, created_at from scoring_rule_versions order by version desc')).rows }));
  app.post('/admin/scoring-rules', { preHandler: contentAdmin }, async (req, reply) => {
    const b = parse(z.object({
      lateVerificationWindowDays: z.number().int().min(0).max(90),
      maxBackdateDays: z.number().int().min(0).max(7),
      adjustmentApprovalThreshold: z.number().int().min(1).max(1000),
      effectiveFrom: dateStr, note: z.string().max(500).optional(),
    }), req.body);
    if (b.effectiveFrom < formatDate(ctx.now())) throw badRequest('effective_in_past'); // history is never rewritten
    const mx = await db.query<{ m: number }>('select coalesce(max(version),0)::int m from scoring_rule_versions');
    const version = mx.rows[0]!.m + 1;
    const { effectiveFrom, note, ...config } = b;
    await db.query('insert into scoring_rule_versions(version, config, effective_from, note, created_by) values ($1,$2,$3::date,$4,$5)', [version, JSON.stringify(config), effectiveFrom, note ?? null, req.user!.id]);
    await audit(db, req.user!.id, 'scoring_rule.created', String(version), config);
    reply.code(201);
    return { version };
  });

  // ---- Users / ledger -------------------------------------------------------------------
  app.get('/admin/users', { preHandler: audits }, async (req) => {
    const q = parse(z.object({ pseudonym: z.string().min(1).max(50) }), req.query);
    const r = await db.query(
      `select u.id, p.pseudonym, p.tradition, u.status, u.created_at from users u join profiles p on p.user_id = u.id
        where lower(p.pseudonym) like lower($1) || '%' order by p.pseudonym limit 25`, [q.pseudonym]);
    return { users: r.rows };
  });
  app.get('/admin/users/:id/ledger', { preHandler: audits }, async (req) => {
    const { id } = req.params as { id: string };
    await audit(db, req.user!.id, 'ledger.inspected', id);
    const r = await db.query('select id, log_id, kind, eligible_points, verified_points, rule_version, effective_date, reason, actor, created_at from ledger_entries where user_id = $1 order by id', [id]);
    return { entries: r.rows };
  });
  app.post('/admin/users/:id/status', { preHandler: requireRoles('moderator') }, async (req) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ status: z.enum(['active', 'suspended']) }), req.body);
    await db.query('update users set status = $2 where id = $1', [id, b.status]);
    if (b.status === 'suspended') await db.query('update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [id]);
    await audit(db, req.user!.id, `user.${b.status}`, id);
    return { ok: true };
  });
  app.put('/admin/users/:id/roles', { preHandler: superAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ roles: z.array(z.enum(ROLES)).max(8) }), req.body);
    await db.tx(async (t) => {
      await t.query('delete from user_roles where user_id = $1', [id]);
      for (const r of b.roles) await t.query('insert into user_roles(user_id, role) values ($1,$2)', [id, r]);
      await audit(t, req.user!.id, 'roles.set', id, { roles: b.roles });
    });
    return { ok: true };
  });

  async function applyAdjustment(adj: { user_id: string; log_id: string | null; eligible_points: number; verified_points: number; effective_date: string; reason: string }, actor: string) {
    await db.tx(async (t) => {
      const tot = await t.query<{ e: number; v: number }>('select coalesce(sum(eligible_points),0)::int e, coalesce(sum(verified_points),0)::int v from ledger_entries where user_id = $1', [adj.user_id]);
      const e = tot.rows[0]!.e + adj.eligible_points, v = tot.rows[0]!.v + adj.verified_points;
      if (e < 0 || v < 0 || v > e) throw badRequest('adjustment_breaks_invariants');
      await t.query(
        `insert into ledger_entries(user_id, log_id, kind, eligible_points, verified_points, effective_date, reason, actor) values ($1,$2,'adjustment',$3,$4,$5::date,$6,$7)`,
        [adj.user_id, adj.log_id, adj.eligible_points, adj.verified_points, adj.effective_date, adj.reason, actor]);
    });
  }

  app.post('/admin/adjustments', { preHandler: requireRoles('moderator') }, async (req, reply) => {
    const b = parse(z.object({
      userId: z.string().uuid(), logId: z.string().uuid().nullable().optional(),
      eligiblePoints: z.number().int().min(-1000).max(1000), verifiedPoints: z.number().int().min(-1000).max(1000),
      effectiveDate: dateStr, reason: z.string().min(5).max(500),
    }), req.body);
    const ruleRow = await db.query<{ config: typeof DEFAULT_SCORING_RULE }>('select config from scoring_rule_versions order by version desc limit 1');
    const threshold = ruleRow.rows[0]?.config.adjustmentApprovalThreshold ?? DEFAULT_SCORING_RULE.adjustmentApprovalThreshold;
    const big = Math.max(Math.abs(b.eligiblePoints), Math.abs(b.verifiedPoints)) >= threshold;
    const row = { user_id: b.userId, log_id: b.logId ?? null, eligible_points: b.eligiblePoints, verified_points: b.verifiedPoints, effective_date: b.effectiveDate, reason: b.reason };
    reply.code(201);
    if (!big) {
      await applyAdjustment(row, req.user!.id);
      await audit(db, req.user!.id, 'adjustment.applied', b.userId, { e: b.eligiblePoints, v: b.verifiedPoints, reason: b.reason });
      return { status: 'applied' };
    }
    const r = await db.query<{ id: number }>(
      `insert into adjustment_requests(user_id, log_id, eligible_points, verified_points, effective_date, reason, requested_by) values ($1,$2,$3,$4,$5::date,$6,$7) returning id`,
      [b.userId, b.logId ?? null, b.eligiblePoints, b.verifiedPoints, b.effectiveDate, b.reason, req.user!.id]);
    await audit(db, req.user!.id, 'adjustment.requested', b.userId, { id: r.rows[0]!.id });
    return { status: 'pending_approval', id: r.rows[0]!.id };
  });
  app.get('/admin/adjustments', { preHandler: audits }, async () => ({ requests: (await db.query("select id, user_id, eligible_points, verified_points, effective_date, reason, requested_by, status, created_at from adjustment_requests order by id desc limit 100")).rows }));
  app.post('/admin/adjustments/:id/decision', { preHandler: requireRoles('moderator') }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const b = parse(z.object({ approve: z.boolean() }), req.body);
    const r = await db.query<any>("select * from adjustment_requests where id = $1 and status = 'pending'", [id]);
    const row = r.rows[0];
    if (!row) throw notFound('request_not_found');
    if (row.requested_by === req.user!.id) throw forbidden('second_approver_required');
    if (b.approve) await applyAdjustment(row, req.user!.id);
    await db.query('update adjustment_requests set status = $2, approved_by = $3, decided_at = now() where id = $1', [id, b.approve ? 'approved' : 'rejected', req.user!.id]);
    await audit(db, req.user!.id, `adjustment.${b.approve ? 'approved' : 'rejected'}`, String(id));
    return { ok: true };
  });

  /** Recompute check: SQL leaderboard totals must equal an independent in-memory recomputation. */
  app.get('/admin/ledger-check', { preHandler: audits }, async () => {
    const inv = await ledgerInvariants(db);
    const today = formatDate(ctx.now());
    const mismatches: string[] = [];
    for (const tradition of TRADITIONS) for (const board of ['A', 'B'] as const) for (const period of ['weekly', 'monthly', 'lifetime'] as const) {
      const lb = await getLeaderboard(db, board, period, tradition, today, null, 200);
      for (const row of lb.rows) {
        const rows = (await db.query<any>(
          `select l.eligible_points, l.verified_points, l.effective_date, l.created_at from ledger_entries l join profiles p on p.user_id = l.user_id where lower(p.pseudonym) = lower($1)`, [row.pseudonym])).rows;
        const s = sumLedger(rows.map((x: any) => ({ eligiblePoints: x.eligible_points, verifiedPoints: x.verified_points, effectiveDate: x.effective_date, createdAt: new Date(x.created_at).toISOString() })), periodRange(period, today));
        if ((board === 'A' ? s.eligible : s.verified) !== row.points) mismatches.push(`${tradition}/${board}/${period}/${row.pseudonym}`);
      }
    }
    return { ...inv, mismatches, ok: inv.negativeLogs === 0 && inv.verifiedExceedsEligible === 0 && mismatches.length === 0 };
  });

  // ---- Reports, flags, invites, audit, retention, pilot -------------------------------------
  app.get('/admin/reports', { preHandler: requireRoles('moderator', 'translation_reviewer', 'content_admin') }, async () => ({ reports: (await db.query("select id, kind, target, message, status, created_at from reports order by status, id desc limit 200")).rows }));
  app.post('/admin/reports/:id/close', { preHandler: requireRoles('moderator', 'translation_reviewer', 'content_admin') }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    await db.query("update reports set status='closed', handled_by=$2 where id = $1", [id, req.user!.id]);
    await audit(db, req.user!.id, 'report.closed', String(id));
    return { ok: true };
  });

  app.get('/admin/flags', { preHandler: anyStaff }, async () => ({ flags: (await db.query('select key, enabled, description, updated_at from feature_flags order by key')).rows }));
  app.put('/admin/flags/:key', { preHandler: superAdmin }, async (req) => {
    const { key } = req.params as { key: string };
    const b = parse(z.object({ enabled: z.boolean() }), req.body);
    const r = await db.query('update feature_flags set enabled = $2, updated_at = now() where key = $1', [key, b.enabled]);
    if (!r.rowCount) throw notFound('flag_not_found');
    await audit(db, req.user!.id, 'flag.set', key, { enabled: b.enabled });
    return { ok: true };
  });

  app.get('/admin/invites', { preHandler: superAdmin }, async () => ({ invites: (await db.query('select code, max_uses, uses, active, stage, note from invites order by created_at desc')).rows }));
  app.post('/admin/invites', { preHandler: superAdmin }, async (req, reply) => {
    const b = parse(z.object({ code: z.string().min(6).max(64), maxUses: z.number().int().min(1).max(1000).default(1), stage: z.number().int().min(1).max(3).default(1), note: z.string().max(200).optional() }), req.body);
    await db.query('insert into invites(code, max_uses, stage, note) values ($1,$2,$3,$4)', [b.code, b.maxUses, b.stage, b.note ?? null]);
    await audit(db, req.user!.id, 'invite.created', null, { stage: b.stage, maxUses: b.maxUses });
    reply.code(201);
    return { ok: true };
  });
  app.post('/admin/invites/:code/deactivate', { preHandler: superAdmin }, async (req) => {
    await db.query('update invites set active = false where code = $1', [(req.params as { code: string }).code]);
    await audit(db, req.user!.id, 'invite.deactivated');
    return { ok: true };
  });

  app.get('/admin/audit', { preHandler: requireRoles('auditor') }, async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    return { entries: (await db.query('select id, actor_id, action, target, meta, created_at from audit_logs order by id desc limit $1', [q.limit])).rows };
  });

  app.get('/admin/retention', { preHandler: anyStaff }, async () => {
    const runs = await db.query('select id, ran_at, deleted_count from retention_runs order by id desc limit 20');
    const due = await db.query("select count(*)::int n from evidence_objects where deleted_at is null and storage_key is not null and retention_expires_at <= now()");
    const live = await db.query("select count(*)::int n from evidence_objects where deleted_at is null and storage_key is not null");
    return { runs: runs.rows, overdue: due.rows[0].n, stored: live.rows[0].n };
  });
  app.post('/admin/retention/run', { preHandler: superAdmin }, async (req) => {
    const n = await runRetention(db, ctx.store, ctx.now());
    await audit(db, req.user!.id, 'retention.run', null, { deleted: n });
    return { deleted: n };
  });

  app.get('/admin/review-queue', { preHandler: requireRoles('moderator', 'verification_reviewer') }, async () => {
    const r = await db.query("select kind, count(*)::int n, min(created_at) oldest from review_tasks where status = 'open' group by kind");
    return { open: r.rows };
  });

  app.get('/admin/pilot/checklist', { preHandler: anyStaff }, async () => ({ items: (await db.query('select key, title, done, note, updated_at from pilot_checklist order by key')).rows }));
  app.put('/admin/pilot/checklist/:key', { preHandler: superAdmin }, async (req) => {
    const { key } = req.params as { key: string };
    const b = parse(z.object({ done: z.boolean(), note: z.string().max(1000).nullable().optional() }), req.body);
    const r = await db.query('update pilot_checklist set done = $2, note = $3, updated_by = $4, updated_at = now() where key = $1', [key, b.done, b.note ?? null, req.user!.id]);
    if (!r.rowCount) throw notFound('item_not_found');
    await audit(db, req.user!.id, 'pilot.checklist', key, { done: b.done });
    return { ok: true };
  });

  /** Privacy-safe aggregate metrics: counts only, never content. */
  app.get('/admin/pilot/metrics', { preHandler: anyStaff }, async () => {
    const one = async (sql: string) => (await db.query<any>(sql)).rows[0];
    const users = await one('select count(*)::int n from users');
    const wau = await one("select count(distinct user_id)::int n from activity_logs where created_at > now() - interval '7 days'");
    const mau = await one("select count(distinct user_id)::int n from activity_logs where created_at > now() - interval '30 days'");
    const retention: Record<string, { cohort: number; returned: number }> = {};
    for (const d of [1, 7, 30]) {
      const r = await one(`select count(*)::int cohort, count(*) filter (where exists (select 1 from activity_logs l where l.user_id = u.id and l.created_at >= u.created_at + interval '${d} days'))::int returned
                             from users u where u.created_at <= now() - interval '${d} days'`);
      retention[`d${d}`] = r;
    }
    const turnaround = await one("select coalesce(avg(extract(epoch from (done_at - created_at))),0)::int secs, count(*)::int n from review_tasks where status = 'done'");
    const submissions = await one("select count(*)::int total, count(*) filter (where status = 'verified')::int verified, count(*) filter (where status = 'unable_to_verify')::int unable, count(*) filter (where status = 'rejected')::int rejected from verification_submissions");
    const appeals = await one("select count(*)::int total, count(*) filter (where status = 'overturned')::int overturned from appeals");
    const ai = await one("select count(*) filter (where ai_result is not null)::int assessed, count(*) filter (where ai_result->>'result' = 'match' and status = 'verified')::int agree, count(*) filter (where ai_result->>'result' = 'match' and status in ('rejected','unable_to_verify'))::int overrides from verification_submissions");
    const deletion = await one('select count(*)::int total, count(*) filter (where completed_at is not null)::int completed from deletion_requests');
    const evidence = await one("select count(*) filter (where storage_key is not null)::int stored, count(*) filter (where deleted_at is not null)::int deleted from evidence_objects");
    const open = await one("select count(*)::int n from review_tasks where status = 'open'");
    return { users: users.n, weeklyActive: wau.n, monthlyActive: mau.n, retention, reviewTurnaroundSeconds: turnaround.secs, reviewsCompleted: turnaround.n, openReviewTasks: open.n, submissions, appeals, ai, deletion, evidence };
  });

  void cfg; void CONTENT_STATUSES; void (null as unknown as Role);
}
