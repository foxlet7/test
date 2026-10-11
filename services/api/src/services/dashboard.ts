import { addDays, formatDate, periodRange, weekStart, daysBetween } from '@gdc/shared';
import type { Db } from '../db';
import { totalsFor } from './ledger';

export interface Achievement { id: 'first_log' | 'seven_active_days' | 'first_milestone' | 'thirty_logs' | 'kind_week'; earned: boolean }

export function computeAchievements(logs: { local_date: string; type: string }[]): Achievement[] {
  const days = new Set(logs.map((l) => l.local_date));
  const byWeek = new Map<string, Set<string>>();
  for (const l of logs) {
    const w = weekStart(l.local_date);
    if (!byWeek.has(w)) byWeek.set(w, new Set());
    byWeek.get(w)!.add(l.local_date);
  }
  const fullWeek = [...byWeek.values()].some((s) => s.size >= 7);
  return [
    { id: 'first_log', earned: logs.length >= 1 },
    { id: 'seven_active_days', earned: days.size >= 7 },
    { id: 'first_milestone', earned: logs.some((l) => l.type === 'milestone') },
    { id: 'thirty_logs', earned: logs.length >= 30 },
    { id: 'kind_week', earned: fullWeek },
  ];
}

export async function buildDashboard(db: Db, userId: string, todayUtc: string) {
  const week = periodRange('weekly', todayUtc);
  const month = periodRange('monthly', todayUtc);
  const [w, m, l, cats, logsAll, recent, prof] = await Promise.all([
    totalsFor(db, userId, week.from, week.to),
    totalsFor(db, userId, month.from, month.to),
    totalsFor(db, userId, null, null),
    db.query<{ category: string; e: number; v: number }>(
      'select category, sum(eligible_points)::int e, sum(verified_points)::int v from ledger_entries where user_id = $1 group by category order by category', [userId]),
    db.query<{ local_date: string; type: string }>(
      `select l.local_date, d.type from activity_logs l join activity_definitions d on d.id = l.activity_id
        where l.user_id = $1 and l.status <> 'rejected'`, [userId]),
    db.query(
      `select l.id, l.activity_id, l.local_date, l.status, l.created_at, v.title_en, v.title_ar
         from activity_logs l join activity_versions v on v.id = l.activity_version_id
        where l.user_id = $1 order by l.created_at desc limit 20`, [userId]),
    db.query<{ weekly_goal: number }>('select weekly_goal from profiles where user_id = $1', [userId]),
  ]);
  const from30 = addDays(todayUtc, -29);
  const active30 = new Set(logsAll.rows.filter((r) => daysBetween(from30, r.local_date) >= 0).map((r) => r.local_date)).size;
  const loggedThisWeek = logsAll.rows.filter((r) => r.local_date >= week.from! && r.local_date <= week.to!).length;
  return {
    today: todayUtc,
    totals: { week: w, month: m, lifetime: l },
    categories: cats.rows.map((c) => ({ category: c.category, eligible: c.e, verified: c.v })),
    activeDays30: active30,
    weeklyGoal: { target: prof.rows[0]?.weekly_goal ?? 5, logged: loggedThisWeek },
    achievements: computeAchievements(logsAll.rows),
    recent: recent.rows,
    // No streaks, no penalties: missing a day never reduces anything.
    note: 'points_are_game_mechanics',
  };
}

export { formatDate };
