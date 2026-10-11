import { checkRepeatPolicy, formatDate, validateLogDate, weekStart, addDays, type RepeatPolicy } from '@gdc/shared';
import type { Db } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { currentRule } from './ledger';

export interface CreateLogInput {
  activityId: string;
  localDate: string;
  tz: string;
  note?: string | null;
  milestoneKey?: string | null;
  idempotencyKey: string;
}

export interface CreateLogResult {
  logId: string;
  pointsAwarded: number;
  duplicate: boolean;
  countsFor: ('A' | 'B')[];
  status: string;
}

export async function createLog(db: Db, userId: string, input: CreateLogInput, now: Date): Promise<CreateLogResult> {
  const today = formatDate(now);
  return db.tx(async (t) => {
    const prof = await t.query<{ tradition: string | null }>('select tradition from profiles where user_id = $1', [userId]);
    const tradition = prof.rows[0]?.tradition;
    if (!tradition) throw badRequest('tradition_required');

    // Serialize concurrent logs for the same (user, activity) so repeat limits cannot be raced.
    await t.query('select pg_advisory_xact_lock(hashtext($1))', [`${userId}:${input.activityId}`]);

    const dup = await t.query<{ id: string; status: string }>(
      'select id, status from activity_logs where user_id = $1 and idempotency_key = $2',
      [userId, input.idempotencyKey],
    );
    if (dup.rows[0]) {
      const pts = await t.query<{ p: number }>('select coalesce(sum(eligible_points),0)::int p from ledger_entries where log_id = $1 and kind = $2', [dup.rows[0].id, 'award']);
      return { logId: dup.rows[0].id, pointsAwarded: pts.rows[0]!.p, duplicate: true, countsFor: ['A'], status: dup.rows[0].status };
    }

    // Only the latest APPROVED version of an activity in the user's own tradition can be logged.
    const act = await t.query<{
      id: string; tradition: string; category: string; verification_class: string;
      version_id: number; base_points: number; repeat_policy: RepeatPolicy;
    }>(
      `select d.id, d.tradition, d.category, d.verification_class, v.id version_id, v.base_points, v.repeat_policy
         from activity_definitions d
         join activity_versions v on v.activity_id = d.id and v.status = 'approved'
        where d.id = $1 order by v.version desc limit 1`,
      [input.activityId],
    );
    const a = act.rows[0];
    if (!a || a.tradition !== tradition) throw notFound('activity_not_found');

    const rule = await currentRule(t, today);
    const dateCheck = validateLogDate(input.localDate, today, rule.config);
    if (!dateCheck.ok) throw badRequest(dateCheck.reason!);

    const ws = weekStart(input.localDate);
    const counts = await t.query<{ on_date: number; in_week: number; ms: number }>(
      `select count(*) filter (where local_date = $3::date)::int on_date,
              count(*) filter (where local_date between $4::date and $5::date)::int in_week,
              count(*) filter (where $6::text is not null and milestone_key = $6::text)::int ms
         from activity_logs where user_id = $1 and activity_id = $2 and status <> 'rejected'`,
      [userId, a.id, input.localDate, ws, addDays(ws, 6), input.milestoneKey ?? null],
    );
    const c = counts.rows[0]!;
    const decision = checkRepeatPolicy(a.repeat_policy, {
      countOnDate: c.on_date, countInWeek: c.in_week, milestoneExists: c.ms > 0, milestoneKey: input.milestoneKey,
    });
    if (!decision.ok) throw conflict(decision.reason);

    const ins = await t.query<{ id: string }>(
      `insert into activity_logs(user_id, activity_id, activity_version_id, rule_version, local_date, tz, note, milestone_key, idempotency_key)
       values ($1,$2,$3,$4,$5::date,$6,$7,$8,$9) returning id`,
      [userId, a.id, a.version_id, rule.version, input.localDate, input.tz, input.note ?? null, input.milestoneKey ?? null, input.idempotencyKey],
    );
    const logId = ins.rows[0]!.id;
    await t.query(
      `insert into ledger_entries(user_id, log_id, kind, eligible_points, verified_points, rule_version, activity_version_id, activity_id, tradition, category, effective_date, reason, idempotency_key)
       values ($1,$2,'award',$3,0,$4,$5,$6,$7,$8,$9::date,'logged',$10)`,
      [userId, logId, a.base_points, rule.version, a.version_id, a.id, a.tradition, a.category, input.localDate, `award:${logId}`],
    );
    return { logId, pointsAwarded: a.base_points, duplicate: false, countsFor: ['A'], status: 'self_reported' };
  });
}
