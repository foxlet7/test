import { describe, expect, it } from 'vitest';
import {
  addDays, checkRepeatPolicy, daysBetween, dictionaries, en, ar, isRtl, monthEnd, periodRange, sumLedger,
  translate, validateLogDate, verifiedEffectiveDate, weekStart, periodCutoff,
} from './index';

describe('dates and periods', () => {
  it('week starts Monday UTC', () => {
    expect(weekStart('2026-10-11')).toBe('2026-10-05'); // Sunday -> previous Monday
    expect(weekStart('2026-10-05')).toBe('2026-10-05');
    expect(weekStart('2026-10-06')).toBe('2026-10-05');
  });
  it('month boundaries incl. leap year and year end', () => {
    expect(monthEnd('2028-02-10')).toBe('2028-02-29');
    expect(monthEnd('2026-12-31')).toBe('2026-12-31');
    expect(periodRange('monthly', '2026-10-11')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
  it('weekly range spans 7 days; lifetime unbounded', () => {
    expect(periodRange('weekly', '2026-10-11')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(periodRange('lifetime', '2026-10-11')).toEqual({ from: null, to: null });
    expect(periodCutoff('weekly', '2026-10-11')).toBe('2026-10-12T00:00:00.000Z');
    expect(periodCutoff('lifetime', '2026-10-11')).toBeNull();
  });
  it('rejects invalid dates', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow();
    expect(() => addDays('nope', 1)).toThrow();
  });
  it('daysBetween across dst-free UTC', () => {
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
  });
});

describe('log date validation', () => {
  const cfg = { maxBackdateDays: 2 };
  it('allows today, +1 (UTC+14) and 2 days back', () => {
    expect(validateLogDate('2026-10-11', '2026-10-11', cfg).ok).toBe(true);
    expect(validateLogDate('2026-10-12', '2026-10-11', cfg).ok).toBe(true);
    expect(validateLogDate('2026-10-09', '2026-10-11', cfg).ok).toBe(true);
  });
  it('blocks future and too old', () => {
    expect(validateLogDate('2026-10-13', '2026-10-11', cfg)).toEqual({ ok: false, reason: 'future' });
    expect(validateLogDate('2026-10-08', '2026-10-11', cfg)).toEqual({ ok: false, reason: 'too_old' });
  });
});

describe('repeat policies', () => {
  const base = { countOnDate: 0, countInWeek: 0, milestoneExists: false };
  it('per_day', () => {
    expect(checkRepeatPolicy({ kind: 'per_day', max: 1 }, base).ok).toBe(true);
    expect(checkRepeatPolicy({ kind: 'per_day', max: 1 }, { ...base, countOnDate: 1 })).toEqual({ ok: false, reason: 'daily_limit' });
    expect(checkRepeatPolicy({ kind: 'per_day', max: 5 }, { ...base, countOnDate: 4 }).ok).toBe(true);
  });
  it('per_week', () => {
    expect(checkRepeatPolicy({ kind: 'per_week', max: 2 }, { ...base, countInWeek: 2 })).toEqual({ ok: false, reason: 'weekly_limit' });
  });
  it('per_milestone requires a key and only once', () => {
    expect(checkRepeatPolicy({ kind: 'per_milestone' }, base)).toEqual({ ok: false, reason: 'milestone_key_required' });
    expect(checkRepeatPolicy({ kind: 'per_milestone' }, { ...base, milestoneKey: 'x' }).ok).toBe(true);
    expect(checkRepeatPolicy({ kind: 'per_milestone' }, { ...base, milestoneKey: 'x', milestoneExists: true })).toEqual({ ok: false, reason: 'milestone_done' });
  });
});

describe('late verification', () => {
  const cfg = { lateVerificationWindowDays: 14 };
  it('credits original date inside the window', () => {
    expect(verifiedEffectiveDate('2026-10-01', '2026-10-15', cfg)).toBe('2026-10-01');
  });
  it('uses verification date after the window', () => {
    expect(verifiedEffectiveDate('2026-10-01', '2026-10-16', cfg)).toBe('2026-10-16');
  });
});

describe('ledger sums', () => {
  const rows = [
    { eligiblePoints: 15, verifiedPoints: 0, effectiveDate: '2026-10-06', createdAt: '2026-10-06T10:00:00Z' },
    { eligiblePoints: 0, verifiedPoints: 15, effectiveDate: '2026-10-06', createdAt: '2026-10-08T10:00:00Z' },
    { eligiblePoints: 5, verifiedPoints: 0, effectiveDate: '2026-09-30', createdAt: '2026-09-30T10:00:00Z' },
  ];
  it('verified is a subset of eligible; verification adds no bonus', () => {
    const t = sumLedger(rows.slice(0, 2), { from: null, to: null });
    expect(t.eligible).toBe(15);
    expect(t.verified).toBe(15);
  });
  it('respects period filters', () => {
    expect(sumLedger(rows, periodRange('weekly', '2026-10-11')).eligible).toBe(15);
    expect(sumLedger(rows, periodRange('lifetime', '2026-10-11')).eligible).toBe(20);
  });
});

describe('i18n', () => {
  it('ar has exactly the same keys as en', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });
  it('no empty strings; placeholders match', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(ar[k].length).toBeGreaterThan(0);
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      expect(ph(ar[k])).toBe(ph(en[k]));
    }
  });
  it('translates with variables and flags RTL', () => {
    expect(translate('en', 'log.earned', { points: 5 })).toBe('Recorded! +5 points');
    expect(translate('ar', 'log.earned', { points: 5 })).toContain('5');
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);
    expect(Object.keys(dictionaries)).toEqual(['en', 'ar']);
  });
  it('disclaimer never claims to measure faith', () => {
    expect(en['disclaimer.points']).toMatch(/do not measure/i);
  });
});
