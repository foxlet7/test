import { periodCutoff, periodRange, type Board, type Period, type Tradition } from '@gdc/shared';
import type { Db } from '../db';

export interface BoardRow { rank: number; pseudonym: string; points: number }
export interface BoardResult {
  board: Board; period: Period; tradition: Tradition;
  periodStart: string | null; periodEnd: string | null; cutoff: string | null;
  rows: BoardRow[]; me: { rank: number; points: number } | null;
}

/**
 * Ranking rule (published): points in the period, then the earliest time the total was reached,
 * then a stable hash of the account id. The query reads only the minimal public projection view
 * and never returns account ids.
 */
export async function getLeaderboard(db: Db, board: Board, period: Period, tradition: Tradition, todayUtc: string, meId: string | null, limit = 50): Promise<BoardResult> {
  const range = periodRange(period, todayUtc);
  const col = board === 'A' ? 'eligible_points' : 'verified_points';
  const base = `
    with scored as (
      select user_id, pseudonym, sum(${col})::int pts, max(created_at) reached
        from v_public_scores
       where board = $1 and tradition = $2
         and ($3::date is null or effective_date >= $3::date)
         and ($4::date is null or effective_date <= $4::date)
       group by user_id, pseudonym
      having sum(${col}) > 0
    ), ranked as (
      select *, row_number() over (order by pts desc, reached asc, md5(user_id::text) asc)::int rk from scored
    )`;
  const params = [board, tradition, range.from, range.to];
  const top = await db.query<{ rk: number; pseudonym: string; pts: number }>(`${base} select rk, pseudonym, pts from ranked order by rk limit ${Math.min(limit, 200)}`, params);
  let me: BoardResult['me'] = null;
  if (meId) {
    const m = await db.query<{ rk: number; pts: number }>(`${base} select rk, pts from ranked where user_id = $5`, [...params, meId]);
    if (m.rows[0]) me = { rank: m.rows[0].rk, points: m.rows[0].pts };
  }
  return {
    board, period, tradition,
    periodStart: range.from, periodEnd: range.to, cutoff: periodCutoff(period, todayUtc),
    rows: top.rows.map((r) => ({ rank: r.rk, pseudonym: r.pseudonym, points: r.pts })),
    me,
  };
}
