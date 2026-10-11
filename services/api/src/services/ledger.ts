import { DEFAULT_SCORING_RULE, verifiedEffectiveDate, type ScoringRuleConfig } from '@gdc/shared';
import type { Db } from '../db';

export interface ScoringRule {
  version: number;
  config: ScoringRuleConfig;
}

export async function currentRule(db: Db, todayUtc: string): Promise<ScoringRule> {
  const r = await db.query<{ version: number; config: ScoringRuleConfig }>(
    'select version, config from scoring_rule_versions where effective_from <= $1::date order by version desc limit 1',
    [todayUtc],
  );
  if (!r.rows[0]) throw new Error('No scoring rule configured; run bootstrap');
  return { version: r.rows[0].version, config: { ...DEFAULT_SCORING_RULE, ...r.rows[0].config } };
}

interface LogRow {
  id: string;
  user_id: string;
  activity_id: string;
  activity_version_id: number;
  rule_version: number;
  local_date: string;
}

export async function netForLog(db: Db, logId: string): Promise<{ eligible: number; verified: number }> {
  const r = await db.query<{ e: number; v: number }>(
    'select coalesce(sum(eligible_points),0)::int e, coalesce(sum(verified_points),0)::int v from ledger_entries where log_id = $1',
    [logId],
  );
  return { eligible: r.rows[0]!.e, verified: r.rows[0]!.v };
}

/**
 * Verification NEVER adds points: the verified entry carries exactly the points already awarded
 * to the log, so Leaderboard B (verified) is always a subset of Leaderboard A (eligible).
 */
export async function recordVerification(db: Db, log: LogRow, verifiedOnUtc: string, cfg: ScoringRuleConfig, actor: string | null): Promise<boolean> {
  const net = await netForLog(db, log.id);
  const toVerify = net.eligible - net.verified;
  if (toVerify <= 0) return false;
  const eff = verifiedEffectiveDate(log.local_date, verifiedOnUtc, cfg);
  const meta = await db.query<{ tradition: string; category: string }>('select tradition, category from activity_definitions where id = $1', [log.activity_id]);
  const res = await db.query(
    `insert into ledger_entries(user_id, log_id, kind, eligible_points, verified_points, rule_version, activity_version_id, activity_id, tradition, category, effective_date, reason, actor, idempotency_key)
     values ($1,$2,'verification',0,$3,$4,$5,$6,$7,$8,$9::date,'verified',$10,$11) on conflict (idempotency_key) do nothing`,
    [log.user_id, log.id, toVerify, log.rule_version, log.activity_version_id, log.activity_id, meta.rows[0]!.tradition, meta.rows[0]!.category, eff, actor, `verify:${log.id}:${net.verified}`],
  );
  return res.rowCount > 0;
}

/** Mirror each date bucket of the log's entries with negated values (history is preserved, never edited). */
export async function reverseLog(db: Db, log: LogRow, reason: string, actor: string | null): Promise<void> {
  const buckets = await db.query<{ d: string; e: number; v: number }>(
    `select effective_date d, sum(eligible_points)::int e, sum(verified_points)::int v
       from ledger_entries where log_id = $1 group by effective_date having sum(eligible_points) <> 0 or sum(verified_points) <> 0`,
    [log.id],
  );
  const meta = await db.query<{ tradition: string; category: string }>('select tradition, category from activity_definitions where id = $1', [log.activity_id]);
  for (const b of buckets.rows) {
    await db.query(
      `insert into ledger_entries(user_id, log_id, kind, eligible_points, verified_points, rule_version, activity_version_id, activity_id, tradition, category, effective_date, reason, actor)
       values ($1,$2,'reversal',$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12)`,
      [log.user_id, log.id, -b.e, -b.v, log.rule_version, log.activity_version_id, log.activity_id, meta.rows[0]!.tradition, meta.rows[0]!.category, b.d, reason, actor],
    );
  }
}

/** Undo reversals (appeal overturned). Each reversal is restored at most once. */
export async function restoreLog(db: Db, log: LogRow, reason: string, actor: string | null): Promise<void> {
  const revs = await db.query<{ id: number; e: number; v: number; d: string }>(
    `select id, eligible_points e, verified_points v, effective_date d from ledger_entries r
      where log_id = $1 and kind = 'reversal'
        and not exists (select 1 from ledger_entries x where x.idempotency_key = 'restore:' || r.id)`,
    [log.id],
  );
  const meta = await db.query<{ tradition: string; category: string }>('select tradition, category from activity_definitions where id = $1', [log.activity_id]);
  for (const r of revs.rows) {
    await db.query(
      `insert into ledger_entries(user_id, log_id, kind, eligible_points, verified_points, rule_version, activity_version_id, activity_id, tradition, category, effective_date, reason, actor, idempotency_key)
       values ($1,$2,'adjustment',$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,$13)`,
      [log.user_id, log.id, -r.e, -r.v, log.rule_version, log.activity_version_id, log.activity_id, meta.rows[0]!.tradition, meta.rows[0]!.category, r.d, reason, actor, `restore:${r.id}`],
    );
  }
}

export interface Totals { eligible: number; verified: number }

export async function totalsFor(db: Db, userId: string, from: string | null, to: string | null): Promise<Totals> {
  const r = await db.query<{ e: number; v: number }>(
    `select coalesce(sum(eligible_points),0)::int e, coalesce(sum(verified_points),0)::int v from ledger_entries
      where user_id = $1 and ($2::date is null or effective_date >= $2::date) and ($3::date is null or effective_date <= $3::date)`,
    [userId, from, to],
  );
  return { eligible: r.rows[0]!.e, verified: r.rows[0]!.v };
}

/** Consistency check used by tests and the admin ledger inspector. */
export async function ledgerInvariants(db: Db): Promise<{ negativeLogs: number; verifiedExceedsEligible: number }> {
  const neg = await db.query<{ n: number }>(
    'select count(*)::int n from (select log_id from ledger_entries where log_id is not null group by log_id having sum(eligible_points) < 0 or sum(verified_points) < 0) x',
  );
  const ve = await db.query<{ n: number }>(
    'select count(*)::int n from (select log_id from ledger_entries where log_id is not null group by log_id having sum(verified_points) > sum(eligible_points)) x',
  );
  return { negativeLogs: neg.rows[0]!.n, verifiedExceedsEligible: ve.rows[0]!.n };
}
