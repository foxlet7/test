import type { RepeatPolicy, ScoringRuleConfig } from './types';

/** Pure, deterministic scoring helpers. No I/O; the API supplies counts from the database. */

const DAY_MS = 86_400_000;

export function parseDate(d: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Invalid date: ${d}`);
  const dt = new Date(`${d}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== d) throw new Error(`Invalid date: ${d}`);
  return dt;
}

export function formatDate(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return formatDate(new Date(parseDate(d).getTime() + n * DAY_MS));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY_MS);
}

/** Monday 00:00 UTC week start (documented policy in SCORING_SPEC.md). */
export function weekStart(d: string): string {
  const dt = parseDate(d);
  const dow = (dt.getUTCDay() + 6) % 7; // Monday=0
  return addDays(d, -dow);
}

export function monthStart(d: string): string {
  return `${d.slice(0, 7)}-01`;
}

export function monthEnd(d: string): string {
  const dt = parseDate(monthStart(d));
  const next = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1));
  return formatDate(new Date(next.getTime() - DAY_MS));
}

export interface DateRange {
  from: string | null; // inclusive; null = unbounded
  to: string | null; // inclusive
}

export function periodRange(period: 'weekly' | 'monthly' | 'lifetime', todayUtc: string): DateRange {
  if (period === 'lifetime') return { from: null, to: null };
  if (period === 'weekly') {
    const from = weekStart(todayUtc);
    return { from, to: addDays(from, 6) };
  }
  return { from: monthStart(todayUtc), to: monthEnd(todayUtc) };
}

/** Next period boundary instant (UTC ISO) so the UI can show the cutoff clearly. */
export function periodCutoff(period: 'weekly' | 'monthly' | 'lifetime', todayUtc: string): string | null {
  const r = periodRange(period, todayUtc);
  return r.to ? `${addDays(r.to, 1)}T00:00:00.000Z` : null;
}

export interface LogDateCheck {
  ok: boolean;
  reason?: 'future' | 'too_old';
}

/**
 * A user's local date may be at most one day ahead of UTC today (time zones up to UTC+14)
 * and no more than `maxBackdateDays` before UTC today. This blocks backdating farms.
 */
export function validateLogDate(localDate: string, todayUtc: string, cfg: Pick<ScoringRuleConfig, 'maxBackdateDays'>): LogDateCheck {
  const diff = daysBetween(todayUtc, localDate);
  if (diff > 1) return { ok: false, reason: 'future' };
  if (diff < -cfg.maxBackdateDays) return { ok: false, reason: 'too_old' };
  return { ok: true };
}

export interface RepeatContext {
  countOnDate: number;
  countInWeek: number;
  milestoneExists: boolean;
  milestoneKey?: string | null;
}

export type RepeatDecision = { ok: true } | { ok: false; reason: 'daily_limit' | 'weekly_limit' | 'milestone_done' | 'milestone_key_required' };

export function checkRepeatPolicy(policy: RepeatPolicy, ctx: RepeatContext): RepeatDecision {
  switch (policy.kind) {
    case 'per_day':
      return ctx.countOnDate < policy.max ? { ok: true } : { ok: false, reason: 'daily_limit' };
    case 'per_week':
      return ctx.countInWeek < policy.max ? { ok: true } : { ok: false, reason: 'weekly_limit' };
    case 'per_milestone':
      if (!ctx.milestoneKey) return { ok: false, reason: 'milestone_key_required' };
      return ctx.milestoneExists ? { ok: false, reason: 'milestone_done' } : { ok: true };
  }
}

/**
 * Effective ranking date of a verification entry.
 * Within the window: the original activity date (no historical manipulation by delaying).
 * After the window: the verification date (documented policy).
 */
export function verifiedEffectiveDate(activityDate: string, verifiedOnUtc: string, cfg: Pick<ScoringRuleConfig, 'lateVerificationWindowDays'>): string {
  return daysBetween(activityDate, verifiedOnUtc) <= cfg.lateVerificationWindowDays ? activityDate : verifiedOnUtc;
}

export interface LedgerRow {
  eligiblePoints: number;
  verifiedPoints: number;
  effectiveDate: string;
  createdAt: string;
}

/** Reference implementation used by tests to cross-check the SQL leaderboard. */
export function sumLedger(rows: LedgerRow[], range: DateRange): { eligible: number; verified: number; reachedAt: string | null } {
  let eligible = 0;
  let verified = 0;
  let reachedAt: string | null = null;
  for (const r of rows) {
    if (range.from && r.effectiveDate < range.from) continue;
    if (range.to && r.effectiveDate > range.to) continue;
    eligible += r.eligiblePoints;
    verified += r.verifiedPoints;
    if (!reachedAt || r.createdAt > reachedAt) reachedAt = r.createdAt;
  }
  return { eligible, verified, reachedAt };
}
