import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { harness, key, today, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h.close(); });

const newActivity = (id: string, over: Record<string, unknown> = {}) => ({
  id, tradition: 'islam', category: 'character', type: 'recurring', obligationClass: 'general_good_deed', verificationClass: 'A',
  basePoints: 5, repeatPolicy: { kind: 'per_day', max: 1 }, titleEn: 'Smile', titleAr: 'ابتسامة', descriptionEn: 'Smile at someone', descriptionAr: 'ابتسم لشخص',
  religiousReferences: [{ label: 'x', source: 'y', verified: false }], ...over,
});

describe('content governance', () => {
  it('requires translation review, tradition-qualified reviewer, and a different approver than the author', async () => {
    const ca = await h.staff('gov_content', ['content_admin']);
    const tr = await h.staff('gov_trans', ['translation_reviewer']);
    const imam = await h.staff('gov_imam', ['islamic_reviewer']);
    const pastor = await h.staff('gov_pastor', ['christian_reviewer']);
    const dual = await h.staff('gov_dual', ['content_admin', 'islamic_reviewer']);
    const user = await h.register('gov_user', 'islam');

    expect((await h.req('POST', '/admin/content', { token: user.token, body: newActivity('islam.gov.smile') })).status).toBe(403);
    expect((await h.req('POST', '/admin/content', { token: ca.token, body: newActivity('islam.gov.smile') })).status).toBe(201);
    expect((await h.req('POST', '/admin/content', { token: ca.token, body: newActivity('islam.gov.smile') })).status).toBe(409);
    const vid = (await h.db.query("select id from activity_versions where activity_id='islam.gov.smile'")).rows[0].id;

    // drafts are invisible to users
    expect((await h.req('GET', '/catalogue', { token: user.token })).body.items.find((i: any) => i.id === 'islam.gov.smile')).toBeUndefined();
    expect((await h.req('POST', `/admin/content/versions/${vid}/review`, { token: imam.token, body: { decision: 'approve' } })).body.error.code).toBe('not_in_review');
    await h.req('POST', `/admin/content/versions/${vid}/submit`, { token: ca.token });
    expect((await h.req('POST', `/admin/content/versions/${vid}/review`, { token: imam.token, body: { decision: 'approve' } })).body.error.code).toBe('translation_not_reviewed');
    expect((await h.req('POST', `/admin/content/versions/${vid}/translation-review`, { token: ca.token })).status).toBe(403);
    expect((await h.req('POST', `/admin/content/versions/${vid}/translation-review`, { token: tr.token })).status).toBe(200);
    expect((await h.req('POST', `/admin/content/versions/${vid}/review`, { token: pastor.token, body: { decision: 'approve' } })).status).toBe(403); // wrong tradition
    // author who is also a qualified reviewer cannot approve their own work
    const own = await h.req('POST', '/admin/content', { token: dual.token, body: newActivity('islam.gov.own') });
    expect(own.status).toBe(201);
    const ownVid = (await h.db.query("select id from activity_versions where activity_id='islam.gov.own'")).rows[0].id;
    await h.req('POST', `/admin/content/versions/${ownVid}/submit`, { token: dual.token });
    await h.req('POST', `/admin/content/versions/${ownVid}/translation-review`, { token: tr.token });
    expect((await h.req('POST', `/admin/content/versions/${ownVid}/review`, { token: dual.token, body: { decision: 'approve' } })).body.error.code).toBe('author_cannot_approve');

    expect((await h.req('POST', `/admin/content/versions/${vid}/review`, { token: imam.token, body: { decision: 'approve', notes: 'ok' } })).status).toBe(200);
    expect((await h.req('GET', '/catalogue', { token: user.token })).body.items.find((i: any) => i.id === 'islam.gov.smile')).toBeTruthy();
    expect((await h.req('GET', `/admin/content/versions/${vid}/reviews`, { token: ca.token })).body.reviews.length).toBeGreaterThanOrEqual(2);

    // approved versions are immutable via the API too; changes need a new version that retires the old on approval
    expect((await h.req('PATCH', `/admin/content/versions/${vid}`, { token: ca.token, body: newActivity('x', { basePoints: 50 }) })).status).toBe(409);
    expect((await h.req('POST', '/admin/content/islam.gov.smile/versions', { token: ca.token, body: newActivity('x', { basePoints: 8 }) })).status).toBe(201);
    const v2 = (await h.db.query("select id from activity_versions where activity_id='islam.gov.smile' and version=2")).rows[0].id;
    await h.req('POST', `/admin/content/versions/${v2}/submit`, { token: ca.token });
    await h.req('POST', `/admin/content/versions/${v2}/translation-review`, { token: tr.token });
    // user logs under v1 first, to prove history keeps its version
    const l = await h.req('POST', '/logs', { token: user.token, body: { activityId: 'islam.gov.smile', localDate: today(h), tz: 'UTC', idempotencyKey: key() } });
    expect(l.body.pointsAwarded).toBe(5);
    await h.req('POST', `/admin/content/versions/${v2}/review`, { token: imam.token, body: { decision: 'approve' } });
    expect((await h.db.query("select status from activity_versions where id=$1", [vid])).rows[0].status).toBe('retired');
    const hist = (await h.db.query('select activity_version_id from ledger_entries where log_id=$1', [l.body.logId])).rows[0];
    expect(hist.activity_version_id).toBe(vid); // old award remains tied to v1
  });
  it('request_changes sends a version back to draft', async () => {
    const ca = await h.staff('gov_content2', ['content_admin']);
    const imam = await h.staff('gov_imam2', ['islamic_reviewer']);
    await h.req('POST', '/admin/content', { token: ca.token, body: newActivity('islam.gov.chg') });
    const vid = (await h.db.query("select id from activity_versions where activity_id='islam.gov.chg'")).rows[0].id;
    await h.req('POST', `/admin/content/versions/${vid}/submit`, { token: ca.token });
    await h.req('POST', `/admin/content/versions/${vid}/review`, { token: imam.token, body: { decision: 'request_changes', notes: 'cite a source' } });
    expect((await h.db.query('select status from activity_versions where id=$1', [vid])).rows[0].status).toBe('draft');
  });
  it('scripture tasks need complete content and a qualified approver', async () => {
    const ca = await h.staff('gov_content3', ['content_admin']);
    const imam = await h.staff('gov_imam3', ['islamic_reviewer']);
    const pastor = await h.staff('gov_pastor3', ['christian_reviewer']);
    const base = { activityId: 'islam.quran.memorize_milestone', titleEn: 'T', titleAr: 'م', rubric: [] };
    await h.req('PUT', '/admin/scripture-tasks/gov-task', { token: ca.token, body: base });
    expect((await h.req('POST', '/admin/scripture-tasks/gov-task/approve', { token: imam.token })).body.error.code).toBe('task_incomplete');
    await h.req('PUT', '/admin/scripture-tasks/gov-task', { token: ca.token, body: { ...base, passageRef: 'P', referenceEdition: 'E', rubric: [{ criterion: 'c', required: true }] } });
    expect((await h.req('POST', '/admin/scripture-tasks/gov-task/approve', { token: pastor.token })).status).toBe(403);
    expect((await h.req('POST', '/admin/scripture-tasks/gov-task/approve', { token: imam.token })).status).toBe(200);
    // editing an approved task sends it back to draft (re-approval required)
    await h.req('PUT', '/admin/scripture-tasks/gov-task', { token: ca.token, body: { ...base, passageRef: 'P2', referenceEdition: 'E', rubric: [{ criterion: 'c', required: true }] } });
    expect((await h.db.query("select status from scripture_tasks where id='gov-task'")).rows[0].status).toBe('draft');
  });
});

describe('scoring rules are versioned, never rewritten', () => {
  it('rejects retroactive rules; new logs record the new version while old ones keep theirs', async () => {
    await h.approveAll();
    const ca = await h.staff('rule_admin', ['content_admin']);
    const u = await h.register('rule_u', 'islam');
    const l1 = await h.req('POST', '/logs', { token: u.token, body: { activityId: 'islam.worship.dhikr', localDate: today(h), tz: 'UTC', idempotencyKey: key() } });
    const body = { lateVerificationWindowDays: 7, maxBackdateDays: 1, adjustmentApprovalThreshold: 20 };
    expect((await h.req('POST', '/admin/scoring-rules', { token: ca.token, body: { ...body, effectiveFrom: '2026-01-01' } })).body.error.code).toBe('effective_in_past');
    expect((await h.req('POST', '/admin/scoring-rules', { token: ca.token, body: { ...body, effectiveFrom: today(h) } })).body.version).toBe(2);
    const l2 = await h.req('POST', '/logs', { token: u.token, body: { activityId: 'islam.worship.dhikr', localDate: today(h), tz: 'UTC', idempotencyKey: key() } });
    const rv = (id: string) => h.db.query('select rule_version v from ledger_entries where log_id=$1', [id]).then((r) => r.rows[0].v);
    expect(await rv(l1.body.logId)).toBe(1);
    expect(await rv(l2.body.logId)).toBe(2);
    // the stricter backdate setting now applies
    expect((await h.req('POST', '/logs', { token: u.token, body: { activityId: 'islam.worship.dhikr', localDate: '2026-10-09', tz: 'UTC', idempotencyKey: key() } })).body.error.code).toBe('too_old');
  });
});

describe('manual adjustments need a second approver when large', () => {
  it('applies small ones, queues large ones, blocks self-approval and broken invariants', async () => {
    await h.approveAll().catch(() => {});
    const m1 = await h.staff('adj_m1', ['moderator']);
    const m2 = await h.staff('adj_m2', ['moderator']);
    const u = await h.register('adj_user', 'islam');
    await h.req('POST', '/logs', { token: u.token, body: { activityId: 'islam.worship.dhikr', localDate: today(h), tz: 'UTC', idempotencyKey: key() } });
    const base = { userId: u.id, eligiblePoints: -3, verifiedPoints: 0, effectiveDate: today(h), reason: 'duplicate manual entry' };
    expect((await h.req('POST', '/admin/adjustments', { token: m1.token, body: base })).body.status).toBe('applied');
    expect((await h.req('GET', '/dashboard', { token: u.token })).body.totals.lifetime.eligible).toBe(0);
    expect((await h.req('POST', '/admin/adjustments', { token: m1.token, body: { ...base, eligiblePoints: -1 } })).body.error.code).toBe('adjustment_breaks_invariants');
    const big = await h.req('POST', '/admin/adjustments', { token: m1.token, body: { ...base, eligiblePoints: 25, verifiedPoints: 0, reason: 'restore after dispute' } });
    expect(big.body.status).toBe('pending_approval');
    expect((await h.req('GET', '/dashboard', { token: u.token })).body.totals.lifetime.eligible).toBe(0);
    expect((await h.req('POST', `/admin/adjustments/${big.body.id}/decision`, { token: m1.token, body: { approve: true } })).status).toBe(403);
    expect((await h.req('POST', `/admin/adjustments/${big.body.id}/decision`, { token: m2.token, body: { approve: true } })).status).toBe(200);
    expect((await h.req('GET', '/dashboard', { token: u.token })).body.totals.lifetime.eligible).toBe(25);
    expect((await h.req('POST', '/admin/adjustments', { token: m1.token, body: { ...base, reason: 'x' } })).status).toBe(400); // reason required
    const aud = await h.staff('adj_aud', ['auditor']);
    const entries = (await h.req('GET', `/admin/users/${u.id}/ledger`, { token: aud.token })).body.entries;
    expect(entries.map((e: any) => e.kind)).toEqual(['award', 'adjustment', 'adjustment']);
  });
});

describe('role-based access control', () => {
  const routes: [string, string][] = [
    ['GET', '/admin/content'], ['POST', '/admin/content'], ['GET', '/admin/scoring-rules'], ['POST', '/admin/scoring-rules'],
    ['GET', '/admin/users?pseudonym=a'], ['POST', '/admin/adjustments'], ['GET', '/admin/adjustments'], ['GET', '/admin/ledger-check'],
    ['GET', '/admin/reports'], ['GET', '/admin/flags'], ['PUT', '/admin/flags/ai_precheck'], ['GET', '/admin/invites'], ['POST', '/admin/invites'],
    ['GET', '/admin/audit'], ['GET', '/admin/retention'], ['POST', '/admin/retention/run'], ['GET', '/admin/pilot/metrics'], ['GET', '/admin/pilot/checklist'],
    ['GET', '/review/tasks'], ['GET', '/admin/review-queue'], ['GET', '/admin/scripture-tasks'],
  ];
  it('ordinary users get 403 and anonymous callers get 401 on every staff route', async () => {
    const u = await h.register('rbac_user');
    for (const [m, url] of routes) {
      expect((await h.req(m, url, { token: u.token, body: {} })).status, `${m} ${url} as user`).toBe(403);
      expect((await h.req(m, url, { body: {} })).status, `${m} ${url} anonymous`).toBe(401);
    }
  });
  it('roles are not interchangeable (auditor cannot write; reviewer cannot read audit)', async () => {
    const aud = await h.staff('rbac_aud', ['auditor']);
    const rev = await h.staff('rbac_rev', ['islamic_reviewer', 'verification_reviewer']);
    expect((await h.req('POST', '/admin/adjustments', { token: aud.token, body: {} })).status).toBe(403);
    expect((await h.req('POST', '/admin/content', { token: aud.token, body: {} })).status).toBe(403);
    expect((await h.req('GET', '/admin/audit', { token: rev.token })).status).toBe(403);
    expect((await h.req('GET', '/admin/audit', { token: aud.token })).status).toBe(200);
    expect((await h.req('PUT', '/admin/users/x/roles', { token: aud.token, body: { roles: ['super_admin'] } })).status).toBe(403);
  });
  it('users cannot escalate through profile or role endpoints', async () => {
    const u = await h.register('rbac_esc');
    const r = await h.req('PATCH', '/me/profile', { token: u.token, body: { roles: ['super_admin'], uiLanguage: 'ar' } });
    expect(r.status).toBe(200);
    expect((await h.req('GET', '/me', { token: u.token })).body.roles).toEqual([]);
  });
  it('role changes take effect immediately (roles are read from the database, not the token)', async () => {
    const adm = await h.staff('rbac_super', ['super_admin']);
    const s = await h.staff('rbac_temp', ['auditor']);
    expect((await h.req('GET', '/admin/audit', { token: s.token })).status).toBe(200);
    await h.req('PUT', `/admin/users/${s.id}/roles`, { token: adm.token, body: { roles: [] } });
    expect((await h.req('GET', '/admin/audit', { token: s.token })).status).toBe(403);
  });
});

describe('operations endpoints', () => {
  it('pilot metrics are aggregates only and the checklist is seeded with the 7 criteria', async () => {
    const adm = await h.staff('ops_super', ['super_admin']);
    const m = await h.req('GET', '/admin/pilot/metrics', { token: adm.token });
    expect(m.status).toBe(200);
    expect(m.body.users).toBeGreaterThan(0);
    expect(JSON.stringify(m.body)).not.toMatch(/email|pseudonym|note/);
    const c = await h.req('GET', '/admin/pilot/checklist', { token: adm.token });
    expect(c.body.items).toHaveLength(7);
    expect((await h.req('PUT', `/admin/pilot/checklist/${c.body.items[0].key}`, { token: adm.token, body: { done: true, note: 'tested' } })).status).toBe(200);
  });
  it('invites enforce max uses and can be deactivated', async () => {
    const adm = await h.staff('ops_inv', ['super_admin']);
    await h.req('POST', '/admin/invites', { token: adm.token, body: { code: 'ONLY-ONE-1', maxUses: 1 } });
    const reg = (n: string) => h.req('POST', '/auth/register', { body: { email: `${n}@example.com`, password: 'correct-horse-battery', inviteCode: 'ONLY-ONE-1', adultConfirmed: true, pseudonym: n } });
    expect((await reg('inv_one')).status).toBe(201);
    expect((await reg('inv_two')).body.error.code).toBe('invite_invalid');
    await h.req('POST', '/admin/invites', { token: adm.token, body: { code: 'DEACT-ME-1', maxUses: 5 } });
    await h.req('POST', '/admin/invites/DEACT-ME-1/deactivate', { token: adm.token });
    const r = await h.req('POST', '/auth/register', { body: { email: 'inv_three@example.com', password: 'correct-horse-battery', inviteCode: 'DEACT-ME-1', adultConfirmed: true, pseudonym: 'inv_three' } });
    expect(r.body.error.code).toBe('invite_invalid');
  });
  it('audit log records staff actions but no private content', async () => {
    const aud = await h.staff('ops_aud', ['auditor']);
    const r = await h.req('GET', '/admin/audit?limit=500', { token: aud.token });
    expect(r.body.entries.length).toBeGreaterThan(5);
    expect(JSON.stringify(r.body.entries)).not.toMatch(/secret|password|recitation/i);
  });
});

describe('product guardrails (static)', () => {
  it('no payment/premium/ad/referral concept can influence points or rank in server code', () => {
    const dir = join(__dirname, '..', 'src');
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : files.push(join(d, e.name))));
    walk(dir);
    for (const f of files.filter((x) => x.endsWith('.ts'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/premium|subscription|referral|advert|stripe|purchase/i);
    }
  });
  it('the scoring path never reads donation amounts', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'services', 'logs.ts'), 'utf8');
    expect(src).not.toMatch(/amount|currency/i);
  });
});
