import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { harness, key, today, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => { h = await harness(); await h.approveAll(); });
afterAll(async () => { await h.close(); });

const log = (token: string, activityId: string, extra: Record<string, unknown> = {}, date?: string) =>
  h.req('POST', '/logs', { token, body: { activityId, localDate: date ?? today(h), tz: 'UTC', idempotencyKey: key(), ...extra } });

describe('auth and registration', () => {
  it('requires invite, adult confirmation and a strong password', async () => {
    const bad = await h.req('POST', '/auth/register', { body: { email: 'a@b.com', password: PWD, inviteCode: 'NOPE', adultConfirmed: true, pseudonym: 'zed_user' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invite_invalid');
    const minor = await h.req('POST', '/auth/register', { body: { email: 'a@b.com', password: PWD, inviteCode: 'TESTINVITE', adultConfirmed: false, pseudonym: 'zed_user' } });
    expect(minor.status).toBe(400);
    const weak = await h.req('POST', '/auth/register', { body: { email: 'a@b.com', password: 'short', inviteCode: 'TESTINVITE', adultConfirmed: true, pseudonym: 'zed_user' } });
    expect(weak.status).toBe(400);
  });
  it('rejects emails/pseudonyms already taken and pseudonyms with @', async () => {
    await h.register('dupe_one');
    const r = await h.req('POST', '/auth/register', { body: { email: 'DUPE_ONE@example.com', password: PWD, inviteCode: 'TESTINVITE', adultConfirmed: true, pseudonym: 'other_name' } });
    expect(r.status).toBe(409);
    const r2 = await h.req('POST', '/auth/register', { body: { email: 'x1@example.com', password: PWD, inviteCode: 'TESTINVITE', adultConfirmed: true, pseudonym: 'Dupe_One' } });
    expect(r2.status).toBe(409);
    const r3 = await h.req('POST', '/auth/register', { body: { email: 'x2@example.com', password: PWD, inviteCode: 'TESTINVITE', adultConfirmed: true, pseudonym: 'me@example' } });
    expect(r3.status).toBe(400);
  });
  it('login failures are generic; refresh rotates tokens', async () => {
    const u = await h.register('login_user');
    const bad = await h.req('POST', '/auth/login', { body: { email: 'login_user@example.com', password: 'wrong-password-1' } });
    expect(bad.status).toBe(401);
    const unknown = await h.req('POST', '/auth/login', { body: { email: 'nobody@example.com', password: 'wrong-password-1' } });
    expect(unknown.body.error.code).toBe(bad.body.error.code);
    const r1 = await h.req('POST', '/auth/refresh', { body: { refreshToken: u.refresh } });
    expect(r1.status).toBe(200);
    const replay = await h.req('POST', '/auth/refresh', { body: { refreshToken: u.refresh } });
    expect(replay.status).toBe(401);
  });
  it('endpoints require authentication; recovery does not enumerate accounts', async () => {
    expect((await h.req('GET', '/dashboard')).status).toBe(401);
    expect((await h.req('GET', '/dashboard', { token: 'garbage' })).status).toBe(401);
    const a = await h.req('POST', '/auth/recover/request', { body: { email: 'login_user@example.com' } });
    const b = await h.req('POST', '/auth/recover/request', { body: { email: 'ghost@example.com' } });
    expect(a.status).toBe(200);
    expect(Object.keys(a.body).filter((k) => k !== 'devToken')).toEqual(Object.keys(b.body));
    const c = await h.req('POST', '/auth/recover/confirm', { body: { token: a.body.devToken, password: 'a-new-long-password' } });
    expect(c.status).toBe(200);
    expect((await h.req('POST', '/auth/login', { body: { email: 'login_user@example.com', password: 'a-new-long-password' } })).status).toBe(200);
    expect((await h.req('POST', '/auth/recover/confirm', { body: { token: a.body.devToken, password: 'another-long-password' } })).status).toBe(400);
  });
});
const PWD = 'correct-horse-battery';

describe('catalogue', () => {
  it('shows only approved versions of the user tradition; drafts stay hidden', async () => {
    const u = await h.register('cat_user', 'islam');
    const r = await h.req('GET', '/catalogue', { token: u.token });
    expect(r.body.items.length).toBeGreaterThan(5);
    expect(r.body.items.every((i: any) => i.tradition === 'islam')).toBe(true);
    await h.db.query("insert into activity_definitions(id, tradition, category, type, obligation_class) values ('islam.test.draft','islam','worship','recurring','voluntary')");
    await h.db.query(`insert into activity_versions(activity_id, version, base_points, repeat_policy, title_en, title_ar, description_en, description_ar) values ('islam.test.draft',1,5,'{"kind":"per_day","max":1}','Hidden','مخفي','d','d')`);
    const r2 = await h.req('GET', '/catalogue', { token: u.token });
    expect(r2.body.items.find((i: any) => i.id === 'islam.test.draft')).toBeUndefined();
  });
});

describe('logging, scoring and repeat rules', () => {
  it('awards base points once and is idempotent', async () => {
    const u = await h.register('log_user');
    const k = key();
    const body = { activityId: 'islam.quran.read_session', localDate: today(h), tz: 'UTC', idempotencyKey: k };
    const a = await h.req('POST', '/logs', { token: u.token, body });
    expect(a.status).toBe(201);
    expect(a.body.pointsAwarded).toBe(5);
    const b = await h.req('POST', '/logs', { token: u.token, body });
    expect(b.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.logId).toBe(a.body.logId);
    const d = await h.req('GET', '/dashboard', { token: u.token });
    expect(d.body.totals.lifetime).toEqual({ eligible: 5, verified: 0 });
  });
  it('enforces per-day limits, not a global cap', async () => {
    const u = await h.register('limit_user');
    expect((await log(u.token, 'islam.character.parents')).status).toBe(201);
    const r = await log(u.token, 'islam.character.parents');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('daily_limit');
    for (let i = 0; i < 3; i++) expect((await log(u.token, 'islam.quran.read_session')).status).toBe(201);
    expect((await log(u.token, 'islam.quran.read_session')).body.error.code).toBe('daily_limit');
  });
  it('enforces weekly limits and milestone-once rules', async () => {
    const u = await h.register('week_user');
    for (let i = 0; i < 3; i++) expect((await log(u.token, 'islam.character.family_ties')).status).toBe(201);
    expect((await log(u.token, 'islam.character.family_ties')).body.error.code).toBe('weekly_limit');
    const noKey = await log(u.token, 'islam.charity.zakat');
    expect(noKey.body.error.code).toBe('milestone_key_required');
    expect((await log(u.token, 'islam.charity.zakat', { milestoneKey: '2026' })).status).toBe(201);
    expect((await log(u.token, 'islam.charity.zakat', { milestoneKey: '2026' })).body.error.code).toBe('milestone_done');
    expect((await log(u.token, 'islam.charity.zakat', { milestoneKey: '2027' })).status).toBe(201);
  });
  it('blocks future and too-old dates (no backdating farms)', async () => {
    const u = await h.register('date_user');
    expect((await log(u.token, 'islam.worship.dhikr', {}, '2026-10-14')).body.error.code).toBe('future');
    expect((await log(u.token, 'islam.worship.dhikr', {}, '2026-10-01')).body.error.code).toBe('too_old');
    expect((await log(u.token, 'islam.worship.dhikr', {}, '2026-10-12')).status).toBe(201); // UTC+14 allowance
    expect((await log(u.token, 'islam.worship.dhikr', {}, '2026-10-09')).status).toBe(201);
  });
  it('users can only log activities of their own tradition; needs a tradition', async () => {
    const u = await h.register('trad_user', 'islam');
    expect((await log(u.token, 'christianity.prayer.personal')).status).toBe(404);
    const n = await h.register('no_trad_user', null);
    expect((await log(n.token, 'islam.worship.dhikr')).body.error.code).toBe('tradition_required');
  });
  it('concurrent duplicate submissions cannot beat the daily limit', async () => {
    const u = await h.register('race_user');
    const rs = await Promise.all(Array.from({ length: 6 }, () => log(u.token, 'islam.character.parents')));
    expect(rs.filter((r) => r.status === 201).length).toBe(1);
  });
  it('donation amounts are not accepted or scored', async () => {
    const u = await h.register('amount_user');
    const a = await log(u.token, 'islam.charity.sadaqa', { amount: 1000000 });
    const b = await log(u.token, 'islam.charity.sadaqa', { amount: 1 });
    expect(a.body.pointsAwarded).toBe(5);
    expect(b.body.pointsAwarded).toBe(5);
  });
  it('private notes stay private and can be removed', async () => {
    const u = await h.register('note_user');
    const l = await log(u.token, 'islam.worship.dhikr', { note: 'secret thought' });
    expect((await h.req('GET', '/logs', { token: u.token })).body.logs[0].note).toBe('secret thought');
    expect((await h.req('PATCH', `/logs/${l.body.logId}/note`, { token: u.token, body: { note: null } })).status).toBe(200);
    expect((await h.req('GET', '/logs', { token: u.token })).body.logs[0].note).toBeNull();
    const other = await h.register('note_other');
    expect((await h.req('PATCH', `/logs/${l.body.logId}/note`, { token: other.token, body: { note: 'x' } })).status).toBe(404);
  });
});

describe('ledger integrity', () => {
  it('is append-only at the database level', async () => {
    const u = await h.register('ledger_user');
    await log(u.token, 'islam.worship.dhikr');
    await expect(h.db.query("update ledger_entries set eligible_points = 999 where user_id = $1", [u.id])).rejects.toThrow(/append-only/);
    await expect(h.db.query("delete from ledger_entries where user_id = $1", [u.id])).rejects.toThrow(/append-only/);
  });
  it('approved content versions are immutable', async () => {
    await expect(h.db.query("update activity_versions set base_points = 99 where activity_id = 'islam.worship.dhikr' and status='approved'")).rejects.toThrow(/immutable/);
  });
  it('rule version is recorded on every award', async () => {
    const u = await h.register('rule_user');
    await log(u.token, 'islam.worship.dhikr');
    const r = await h.db.query('select rule_version from ledger_entries where user_id = $1', [u.id]);
    expect(r.rows[0].rule_version).toBe(1);
  });
});

describe('consents and privacy controls', () => {
  it('export contains the user data; delete erases everything including the ledger', async () => {
    const u = await h.register('erase_user');
    await log(u.token, 'islam.worship.dhikr', { note: 'n' });
    await h.req('POST', '/leaderboards/A/membership', { token: u.token, body: { consent: true } });
    const ex = await h.req('GET', '/me/export', { token: u.token });
    expect(ex.body.activityLogs.length).toBe(1);
    expect(ex.body.ledger.length).toBe(1);
    expect((await h.req('DELETE', '/me', { token: u.token, body: {} })).status).toBe(400);
    expect((await h.req('DELETE', '/me', { token: u.token, body: { confirm: true } })).status).toBe(200);
    for (const t of ['users', 'profiles', 'activity_logs', 'ledger_entries', 'leaderboard_memberships', 'consents']) {
      const col = t === 'users' ? 'id' : 'user_id';
      expect((await h.db.query(`select 1 from ${t} where ${col} = $1`, [u.id])).rows.length).toBe(0);
    }
    expect((await h.req('GET', '/dashboard', { token: u.token })).status).toBe(401);
    expect((await h.db.query("select 1 from deletion_requests where completed_at is not null")).rows.length).toBeGreaterThan(0);
  });
  it('web deletion request works with credentials only', async () => {
    await h.register('web_del');
    expect((await h.req('POST', '/public/deletion-request', { body: { email: 'web_del@example.com', password: 'wrong-password-123' } })).status).toBe(401);
    expect((await h.req('POST', '/public/deletion-request', { body: { email: 'web_del@example.com', password: PWD } })).status).toBe(200);
  });
  it('changing tradition removes rankings membership', async () => {
    const u = await h.register('switch_user');
    await h.req('POST', '/leaderboards/A/membership', { token: u.token, body: { consent: true } });
    await h.req('PATCH', '/me/profile', { token: u.token, body: { tradition: 'christianity' } });
    expect((await h.db.query('select 1 from leaderboard_memberships where user_id = $1', [u.id])).rows.length).toBe(0);
  });
  it('suspension blocks access immediately', async () => {
    const u = await h.register('susp_user');
    const mod = await h.staff('mod_a', ['moderator']);
    expect((await h.req('POST', `/admin/users/${u.id}/status`, { token: mod.token, body: { status: 'suspended' } })).status).toBe(200);
    expect((await h.req('GET', '/dashboard', { token: u.token })).status).toBe(401);
  });
});

describe('dashboard has no guilt mechanics', () => {
  it('reports no streak or penalty fields; missing days change nothing', async () => {
    const u = await h.register('kind_user');
    await log(u.token, 'islam.worship.dhikr');
    const before = (await h.req('GET', '/dashboard', { token: u.token })).body;
    h.clock.now = new Date('2026-10-20T12:00:00Z');
    const after = (await h.req('GET', '/dashboard', { token: u.token })).body;
    h.clock.now = new Date('2026-10-11T12:00:00Z');
    expect(JSON.stringify(Object.keys(before))).not.toMatch(/streak|penalt/i);
    expect(after.totals.lifetime).toEqual(before.totals.lifetime);
  });
});
