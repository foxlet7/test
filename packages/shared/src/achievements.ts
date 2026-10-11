import { weekStart } from './scoring';

export type AchievementId = 'first_log' | 'seven_active_days' | 'first_milestone' | 'thirty_logs' | 'kind_week';
export interface Achievement { id: AchievementId; earned: boolean }

export function computeAchievements(logs: { local_date: string; type: string }[]): Achievement[] {
  const days = new Set(logs.map((l) => l.local_date));
  const byWeek = new Map<string, Set<string>>();
  for (const l of logs) {
    const w = weekStart(l.local_date);
    if (!byWeek.has(w)) byWeek.set(w, new Set());
    byWeek.get(w)!.add(l.local_date);
  }
  return [
    { id: 'first_log', earned: logs.length >= 1 },
    { id: 'seven_active_days', earned: days.size >= 7 },
    { id: 'first_milestone', earned: logs.some((l) => l.type === 'milestone') },
    { id: 'thirty_logs', earned: logs.length >= 30 },
    { id: 'kind_week', earned: [...byWeek.values()].some((s) => s.size >= 7) },
  ];
}
