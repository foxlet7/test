import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { harness, key, today, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => { h = await harness(); await h.approveAll(); });
afterAll(async () => { await h.close(); });

const log = (token: string, activityId: string, extra: Record<string, unknown> = {}, date?: string) =>
  h.req('POST', '/logs', { token, body: { activityId, localDate: date ?? today(h), tz: 'UTC', idempotencyKey: key(), ...extra } });
const join = (token: string, board: 'A' | 'B') => h.req('POST', `/leaderboards/${board}/membership`, { token, body: { consent: true } });
const board = (token: string, b: 'A' | 'B', period = 'weekly') => h.req('GET', `/leaderboards/${b}?period=${period}`, { token });

describe('leaderboards', () => {
  it('are opt-in, per tradition, and expose only pseudonym/score/rank', async () => {
    const a = await h.register('lb_alice', 'islam');
    const b = await h.register('lb_bob', 'islam');
    const c = await h.register('lb_carol', 'christianity');
    await log(a.token, 'islam.quran.read_session');
    await log(b.token, 'islam.worship.dhikr');
    await log(c.token, 'christianity.prayer.personal');
    expect((await board(a.token, 'A')).body.rows).toHaveLength(0); // nobody joined => nobody listed
    await join(a.token, 'A'); await join(c.token, 'A');
    const r = await board(a.token, 'A');
    expect(r.body.rows).toEqual([{ rank: 1, pseudonym: 'lb_alice', points: 5 }]); // carol (christianity) not listed in the Islam board
    expect(r.body.me).toEqual({ rank: 1, points: 5 });
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(a.id);
    expect(text).not.toMatch(/email|note|activity/i);
    const nonMember = await board(b.token, 'A');
    expect(nonMember.body.isMember).toBe(false);
    expect(nonMember.body.me).toBeNull();
  });
  it('leaving removes the public entry promptly; consent is revoked', async () => {
    const u = await h.register('lb_leaver', 'islam');
    await log(u.token, 'islam.quran.read_session');
    await join(u.token, 'A');
    expect((await board(u.token, 'A')).body.rows.some((x: any) => x.pseudonym === 'lb_leaver')).toBe(true);
    await h.req('DELETE', '/leaderboards/A/membership', { token: u.token });
    expect((await board(u.token, 'A')).body.rows.some((x: any) => x.pseudonym === 'lb_leaver')).toBe(false);
    expect((await h.db.query("select 1 from consents where user_id=$1 and type='leaderboard_A' and revoked_at is null", [u.id])).rows).toHaveLength(0);
  });
  it('membership needs explicit consent in the request', async () => {
    const u = await h.register('lb_noconsent', 'islam');
    expect((await h.req('POST', '/leaderboards/A/membership', { token: u.token, body: {} })).status).toBe(400);
    expect((await h.req('POST', '/leaderboards/Z/membership', { token: u.token, body: { consent: true } })).status).toBe(400);
  });
  it('ranks by points, then earliest time reached, then stable hash', async () => {
    const x = await h.register('tie_x', 'christianity');
    const y = await h.register('tie_y', 'christianity');
    const z = await h.register('tie_z', 'christianity');
    await join(x.token, 'A'); await join(y.token, 'A'); await join(z.token, 'A');
    await log(y.token, 'christianity.prayer.personal');
    await log(x.token, 'christianity.prayer.personal');
    await log(z.token, 'christianity.charity.give'); // 5 points
    await log(z.token, 'christianity.prayer.personal'); // total 8
    const rows = (await board(x.token, 'A')).body.rows.map((r: any) => r.pseudonym).filter((n: string) => n.startsWith('tie_'));
    expect(rows).toEqual(['tie_z', 'tie_y', 'tie_x']); // z has more; y reached 3 points earlier than x
  });
  it('verified board counts only verified activities with the SAME base points (no bonus)', async () => {
    const u = await h.register('vb_user', 'islam');
    await join(u.token, 'A'); await join(u.token, 'B');
    const l = await log(u.token, 'islam.quran.memorize_milestone', { milestoneKey: 'surah-x' });
    expect(l.body.pointsAwarded).toBe(15);
    expect((await board(u.token, 'A')).body.me).toEqual({ rank: expect.any(Number), points: 15 });
    expect((await board(u.token, 'B')).body.me).toBeNull(); // self-reported does not count on B
    // verify through the ledger service the same way a reviewer decision does
    const { recordVerification } = await import('../src/services/ledger');
    const row = (await h.db.query('select id, user_id, activity_id, activity_version_id, rule_version, local_date from activity_logs where id = $1', [l.body.logId])).rows[0];
    await recordVerification(h.db, row, today(h), { lateVerificationWindowDays: 14, maxBackdateDays: 2, adjustmentApprovalThreshold: 20 }, null);
    expect((await board(u.token, 'B')).body.me).toEqual({ rank: expect.any(Number), points: 15 });
    expect((await board(u.token, 'A')).body.me!.points).toBe(15); // still 15, never 30
    await recordVerification(h.db, row, today(h), { lateVerificationWindowDays: 14, maxBackdateDays: 2, adjustmentApprovalThreshold: 20 }, null);
    expect((await board(u.token, 'B')).body.me!.points).toBe(15); // idempotent
  });
  it('late verification credits the original period inside the window and the verification date after it', async () => {
    const { recordVerification } = await import('../src/services/ledger');
    const cfg = { lateVerificationWindowDays: 14, maxBackdateDays: 2, adjustmentApprovalThreshold: 20 };
    const u = await h.register('late_user', 'islam');
    const l = await log(u.token, 'islam.quran.memorize_milestone', { milestoneKey: 'late-1' });
    const row = (await h.db.query('select id, user_id, activity_id, activity_version_id, rule_version, local_date from activity_logs where id = $1', [l.body.logId])).rows[0];
    await recordVerification(h.db, row, '2026-10-20', cfg, null); // 9 days later => original date
    const e = (await h.db.query("select effective_date from ledger_entries where log_id = $1 and kind='verification'", [l.body.logId])).rows[0];
    expect(e.effective_date).toBe(today(h));
    const l2 = await log(u.token, 'islam.quran.memorize_milestone', { milestoneKey: 'late-2' });
    const row2 = (await h.db.query('select id, user_id, activity_id, activity_version_id, rule_version, local_date from activity_logs where id = $1', [l2.body.logId])).rows[0];
    await recordVerification(h.db, row2, '2026-11-05', cfg, null); // 25 days later => verification date
    const e2 = (await h.db.query("select effective_date from ledger_entries where log_id = $1 and kind='verification'", [l2.body.logId])).rows[0];
    expect(e2.effective_date).toBe('2026-11-05');
  });
  it('weekly, monthly and lifetime periods split correctly across boundaries', async () => {
    const u = await h.register('period_user', 'islam');
    await join(u.token, 'A');
    // today is Sun 2026-10-11 (week Mon 10-05). Log 2 days back (Fri 10-09, same week), then move the clock.
    await log(u.token, 'islam.quran.read_session', {}, '2026-10-09');
    h.clock.now = new Date('2026-10-12T09:00:00Z'); // next Monday => new week, same month
    expect((await board(u.token, 'A', 'weekly')).body.me).toBeNull();
    expect((await board(u.token, 'A', 'monthly')).body.me!.points).toBeGreaterThanOrEqual(5);
    expect((await board(u.token, 'A', 'lifetime')).body.me!.points).toBeGreaterThanOrEqual(5);
    const w = (await board(u.token, 'A', 'weekly')).body;
    expect(w.periodStart).toBe('2026-10-12');
    expect(w.cutoff).toBe('2026-10-19T00:00:00.000Z');
    h.clock.now = new Date('2026-11-02T09:00:00Z'); // new month
    expect((await board(u.token, 'A', 'monthly')).body.me).toBeNull();
    h.clock.now = new Date('2026-10-11T12:00:00Z');
  });
  it('independent recomputation agrees with the SQL leaderboards', async () => {
    const aud = await h.staff('auditor_lb', ['auditor']);
    const r = await h.req('GET', '/admin/ledger-check', { token: aud.token });
    expect(r.status).toBe(200);
    expect(r.body.mismatches).toEqual([]);
    expect(r.body.ok).toBe(true);
  });
});
