// Turns one probe result into the sensor's new state. Pure: no database, easy to test.

export type Status = 'UNKNOWN' | 'UP' | 'WARNING' | 'DOWN' | 'PAUSED';

export interface Thresholds {
  warnAbove?: number | null;
  downAbove?: number | null;
  warnBelow?: number | null;
  downBelow?: number | null;
  failAfter: number;
}

export interface Current {
  status: Status;
  failCount: number;
}

export interface Result {
  ok: boolean;
  value?: number | null;
  message?: string | null;
  warn?: boolean | null; // probe-side condition: cert expiring, device rebooted, partial packet loss
}

export interface Next {
  status: Status;
  failCount: number;
  message: string | null;
}

const has = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

export function evaluate(t: Thresholds, cur: Current, r: Result): Next {
  if (!r.ok) {
    const failCount = cur.failCount + 1;
    const need = Math.max(1, t.failAfter || 1);
    if (failCount >= need) return { status: 'DOWN', failCount, message: r.message || 'Check failed' };
    // Not confirmed yet: keep the previous state so one lost packet never pages anyone.
    return {
      status: cur.status === 'UNKNOWN' ? 'UNKNOWN' : cur.status,
      failCount,
      message: (r.message || 'Check failed') + ` (${failCount}/${need}, confirming)`,
    };
  }
  const v = r.value;
  if (has(v)) {
    if (has(t.downAbove) && v > t.downAbove) return { status: 'DOWN', failCount: 0, message: `Above down limit ${t.downAbove}` };
    if (has(t.downBelow) && v < t.downBelow) return { status: 'DOWN', failCount: 0, message: `Below down limit ${t.downBelow}` };
  }
  if (r.warn) return { status: 'WARNING', failCount: 0, message: r.message || 'Warning reported by probe' };
  if (has(v)) {
    if (has(t.warnAbove) && v > t.warnAbove) return { status: 'WARNING', failCount: 0, message: `Above warning limit ${t.warnAbove}` };
    if (has(t.warnBelow) && v < t.warnBelow) return { status: 'WARNING', failCount: 0, message: `Below warning limit ${t.warnBelow}` };
  }
  return { status: 'UP', failCount: 0, message: r.message || null };
}

// Worst-first order for sorting and for rolling a group up to one colour.
export const RANK: Record<Status, number> = { DOWN: 0, WARNING: 1, UNKNOWN: 2, UP: 3, PAUSED: 4 };
export function worst(list: Status[]): Status {
  return list.reduce<Status>((w, s) => (RANK[s] < RANK[w] ? s : w), 'PAUSED');
}
