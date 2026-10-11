import { randomUUID } from 'node:crypto';
import { addDays, formatDate } from '@gdc/shared';
import type { Config } from '../config';
import type { Db } from '../db';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors';
import { sha256 } from '../auth';
import { audit, flagEnabled } from './audit';
import type { AssessmentProvider } from './assessment';
import type { BlobStore } from './evidenceStore';
import { currentRule, recordVerification, restoreLog, reverseLog } from './ledger';

const ALLOWED_MIME = new Set(['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/aac']);
const MAX_SUBMISSIONS_PER_DAY = 5;
const PENDING_SAFETY_DAYS = 60;

export interface VerificationDeps {
  cfg: Config;
  db: Db;
  store: BlobStore;
  provider: AssessmentProvider;
}

export type Decision = 'verified' | 'unable_to_verify' | 'rejected' | 'under_investigation';

async function hasConsent(db: Db, userId: string, type: string): Promise<boolean> {
  const r = await db.query('select 1 from consents where user_id = $1 and type = $2 and revoked_at is null', [userId, type]);
  return r.rows.length > 0;
}

export async function submitRecitation(deps: VerificationDeps, userId: string, logId: string, audio: Buffer, mime: string, now: Date) {
  const { db, store, cfg } = deps;
  if (!(await hasConsent(db, userId, 'evidence'))) throw forbidden('consent_required');
  if (!ALLOWED_MIME.has(mime)) throw badRequest('unsupported_media');
  if (audio.length === 0 || audio.length > cfg.evidenceMaxBytes) throw badRequest('invalid_size');

  const log = await db.query<{ id: string; status: string; activity_id: string }>(
    'select id, status, activity_id from activity_logs where id = $1 and user_id = $2', [logId, userId]);
  const l = log.rows[0];
  if (!l) throw notFound('log_not_found');
  if (!['self_reported', 'unable_to_verify'].includes(l.status)) throw conflict('not_submittable');

  const task = await db.query<{ id: string; passage_ref: string | null; reference_edition: string | null }>(
    "select id, passage_ref, reference_edition from scripture_tasks where activity_id = $1 and status = 'approved' limit 1", [l.activity_id]);
  if (!task.rows[0]) throw badRequest('verification_unavailable');

  const recent = await db.query<{ n: number }>(
    "select count(*)::int n from verification_submissions where user_id = $1 and created_at > $2::timestamptz - interval '1 day'", [userId, now.toISOString()]);
  if (recent.rows[0]!.n >= MAX_SUBMISSIONS_PER_DAY) throw new AppError(429, 'rate_limited');

  const hash = sha256(audio);
  const own = await db.query('select 1 from evidence_objects where user_id = $1 and sha256 = $2', [userId, hash]);
  if (own.rows.length) throw conflict('duplicate_submission');
  const others = await db.query('select 1 from evidence_objects where user_id <> $1 and sha256 = $2 limit 1', [userId, hash]);
  const riskFlags = others.rows.length ? ['duplicate_audio'] : [];

  const evidenceId = randomUUID();
  const key = `evidence/${userId}/${evidenceId}`;
  await store.put(key, audio);

  const out = await db.tx(async (t) => {
    await t.query(
      `insert into evidence_objects(id, user_id, kind, storage_key, sha256, bytes, mime, retention_expires_at)
       values ($1,$2,'audio',$3,$4,$5,$6,$7::timestamptz)`,
      [evidenceId, userId, key, hash, audio.length, mime, addDaysIso(now, PENDING_SAFETY_DAYS)]);
    const sub = await t.query<{ id: string }>(
      `insert into verification_submissions(log_id, user_id, task_id, evidence_id, risk_flags) values ($1,$2,$3,$4,$5) returning id`,
      [logId, userId, task.rows[0]!.id, evidenceId, JSON.stringify(riskFlags)]);
    await t.query("update activity_logs set status = 'pending_review' where id = $1", [logId]);
    await t.query("insert into review_tasks(submission_id, kind) values ($1,'initial')", [sub.rows[0]!.id]);
    return sub.rows[0]!.id;
  }).catch(async (e) => {
    await store.delete(key).catch(() => {});
    throw e;
  });

  // Optional AI pre-check: advisory only. It can abstain and can never reject.
  let ai: unknown = null;
  if ((await flagEnabled(db, 'ai_precheck')) && (await hasConsent(db, userId, 'ai_processing'))) {
    try {
      const res = await deps.provider.assess({ audio, mime, taskId: task.rows[0]!.id, passageRef: task.rows[0]!.passage_ref, referenceEdition: task.rows[0]!.reference_edition });
      ai = { ...res, provider: deps.provider.name };
      await db.query('update verification_submissions set ai_result = $2 where id = $1', [out, JSON.stringify(ai)]);
      if (res.result === 'match' && res.confidence >= cfg.aiAutoVerifyMinConfidence && riskFlags.length === 0 && (await flagEnabled(db, 'ai_auto_verify'))) {
        await applyDecision(deps, out, null, 'verified', { auto: true }, 'ai auto-verified', now, 'initial');
      }
    } catch {
      // provider failure => silently fall back to human review
    }
  }
  return { submissionId: out };
}

const addDaysIso = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000).toISOString();

/** Core decision logic shared by reviewers and the (flagged, off-by-default) auto-verify path. */
export async function applyDecision(
  deps: VerificationDeps, submissionId: string, reviewerId: string | null, decision: Decision,
  rubric: unknown, notes: string | null, now: Date, expectedKind?: 'initial' | 'appeal',
) {
  const { db, cfg } = deps;
  const today = formatDate(now);
  await db.tx(async (t) => {
    const s = await t.query<{ id: string; log_id: string; user_id: string; status: string; evidence_id: string | null }>(
      'select id, log_id, user_id, status, evidence_id from verification_submissions where id = $1 for update', [submissionId]);
    const sub = s.rows[0];
    if (!sub) throw notFound('submission_not_found');
    if (!['pending_review', 'under_investigation'].includes(sub.status)) throw conflict('already_decided');

    const task = await t.query<{ id: number; kind: 'initial' | 'appeal'; excluded_reviewer: string | null; status: string }>(
      "select id, kind, excluded_reviewer, status from review_tasks where submission_id = $1 and status <> 'done' order by id desc limit 1", [submissionId]);
    const rt = task.rows[0];
    if (!rt) throw conflict('no_open_task');
    if (expectedKind && rt.kind !== expectedKind) throw conflict('task_kind_mismatch');
    if (reviewerId && rt.excluded_reviewer === reviewerId) throw forbidden('reviewer_conflict');

    const prevRejected = (await t.query(
      `select 1 from review_decisions d join review_tasks r on r.id = d.task_id where r.submission_id = $1 and d.decision = 'rejected'`, [submissionId])).rows.length > 0;
    await t.query('insert into review_decisions(task_id, reviewer_id, decision, rubric, notes) values ($1,$2,$3,$4,$5)',
      [rt.id, reviewerId, decision, JSON.stringify(rubric ?? {}), notes]);
    await t.query("update review_tasks set status = 'done', done_at = now(), claimed_by = coalesce(claimed_by, $2) where id = $1", [rt.id, reviewerId]);

    const lg = await t.query<{ id: string; user_id: string; activity_id: string; activity_version_id: number; rule_version: number; local_date: string; status: string }>(
      'select id, user_id, activity_id, activity_version_id, rule_version, local_date, status from activity_logs where id = $1 for update', [sub.log_id]);
    const log = lg.rows[0]!;
    const rule = await currentRule(t, today);

    const retention = addDaysIso(now, cfg.appealWindowDays);

    if (decision === 'verified') {
      if (prevRejected) await restoreLog(t, log, 'appeal overturned', reviewerId);
      await recordVerification(t, log, today, rule.config, reviewerId);
      await t.query("update activity_logs set status = 'verified', verified_at = $2::timestamptz where id = $1", [log.id, now.toISOString()]);
    } else if (decision === 'rejected') {
      await reverseLog(t, log, 'verification rejected', reviewerId);
      await t.query("update activity_logs set status = 'rejected' where id = $1", [log.id]);
    } else if (decision === 'unable_to_verify') {
      // An inconclusive appeal outcome overturns a prior rejection: the benefit of the doubt goes to the user.
      if (prevRejected) await restoreLog(t, log, 'appeal inconclusive; rejection overturned', reviewerId);
      await t.query("update activity_logs set status = 'unable_to_verify' where id = $1", [log.id]);
    } else {
      await t.query("update activity_logs set status = 'under_investigation' where id = $1", [log.id]);
    }

    await t.query('update verification_submissions set status = $2, decided_at = $3::timestamptz where id = $1', [submissionId, decision, now.toISOString()]);
    if (decision === 'under_investigation') {
      await t.query("insert into review_tasks(submission_id, kind, excluded_reviewer) values ($1,$2,$3)", [submissionId, rt.kind, reviewerId]);
    } else {
      if (sub.evidence_id) await t.query('update evidence_objects set retention_expires_at = $2::timestamptz where id = $1 and deleted_at is null', [sub.evidence_id, retention]);
      if (rt.kind === 'appeal') {
        await t.query("update appeals set status = $2, decided_at = now() where submission_id = $1",
          [submissionId, decision === 'verified' || (decision === 'unable_to_verify' && prevRejected) ? 'overturned' : 'upheld']);
      }
    }
    await audit(t, reviewerId, 'verification.decision', submissionId, { decision, kind: rt.kind });
  });
}

export async function fileAppeal(deps: VerificationDeps, userId: string, submissionId: string, message: string | null, now: Date) {
  const { db, cfg } = deps;
  return db.tx(async (t) => {
    const s = await t.query<{ id: string; log_id: string; status: string; decided_at: Date | null; evidence_id: string | null }>(
      'select id, log_id, status, decided_at, evidence_id from verification_submissions where id = $1 and user_id = $2 for update', [submissionId, userId]);
    const sub = s.rows[0];
    if (!sub) throw notFound('submission_not_found');
    if (!['unable_to_verify', 'rejected'].includes(sub.status) || !sub.decided_at) throw conflict('not_appealable');
    if (now.getTime() > new Date(sub.decided_at).getTime() + cfg.appealWindowDays * 86_400_000) throw conflict('appeal_window_closed');
    const existing = await t.query('select 1 from appeals where submission_id = $1', [submissionId]);
    if (existing.rows.length) throw conflict('already_appealed');
    const ev = sub.evidence_id ? await t.query('select deleted_at from evidence_objects where id = $1', [sub.evidence_id]) : { rows: [] as any[] };
    if (!ev.rows[0] || ev.rows[0].deleted_at) throw conflict('evidence_expired');

    const prev = await t.query<{ reviewer_id: string | null }>(
      `select d.reviewer_id from review_decisions d join review_tasks r on r.id = d.task_id where r.submission_id = $1 order by d.id desc limit 1`, [submissionId]);
    await t.query('insert into appeals(submission_id, user_id, message) values ($1,$2,$3)', [submissionId, userId, message]);
    await t.query("update verification_submissions set status = 'pending_review' where id = $1", [submissionId]);
    await t.query("update activity_logs set status = 'pending_review' where id = $1", [sub.log_id]);
    await t.query("insert into review_tasks(submission_id, kind, excluded_reviewer) values ($1,'appeal',$2)", [submissionId, prev.rows[0]?.reviewer_id ?? null]);
    await t.query('update evidence_objects set retention_expires_at = $2::timestamptz where id = $1', [sub.evidence_id, addDaysIso(now, PENDING_SAFETY_DAYS)]);
    return { ok: true };
  });
}
