import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { harness, key, today, PW, type Harness } from './helpers';
import { runRetention } from '../src/services/retention';

let h: Harness;
let imam: { token: string; id: string };
let pastor: { token: string; id: string };
let imam2: { token: string; id: string };
beforeAll(async () => {
  h = await harness();
  await h.approveAll();
  imam = await h.staff('rev_imam', ['islamic_reviewer', 'verification_reviewer']);
  imam2 = await h.staff('rev_imam2', ['islamic_reviewer', 'verification_reviewer']);
  pastor = await h.staff('rev_pastor', ['christian_reviewer', 'verification_reviewer']);
});
afterAll(async () => { await h.close(); });

const log = (token: string, activityId: string, extra: Record<string, unknown> = {}) =>
  h.req('POST', '/logs', { token, body: { activityId, localDate: today(h), tz: 'UTC', idempotencyKey: key(), ...extra } });

async function upload(token: string, logId: string, audio: Buffer, mime = 'audio/mp4') {
  const boundary = '----t' + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="logId"\r\n\r\n${logId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.m4a"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const r = await h.app.inject({ method: 'POST', url: '/verification/submissions', headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([head, audio, tail]) });
  return { status: r.statusCode, body: JSON.parse(r.body) };
}
const audio = (first = 0x00, n = 64) => { const b = Buffer.alloc(n, Math.floor(Math.random() * 255)); b[0] = first; b[1] = Math.floor(Math.random() * 255); b[2] = Math.floor(Math.random() * 255); return b; };

async function setup(name: string, tradition: 'islam' | 'christianity' = 'islam', consent = true) {
  const u = await h.register(name, tradition);
  if (consent) await h.req('POST', '/me/consents', { token: u.token, body: { type: 'evidence', granted: true } });
  const act = tradition === 'islam' ? 'islam.quran.memorize_milestone' : 'christianity.bible.memorize_milestone';
  const l = await log(u.token, act, { milestoneKey: `m-${name}` });
  return { ...u, logId: l.body.logId as string };
}
const queue = async (t: string) => (await h.req('GET', '/review/tasks', { token: t })).body.tasks as any[];
const totals = async (token: string) => (await h.req('GET', '/dashboard', { token })).body.totals.lifetime;

describe('recitation submission', () => {
  it('requires evidence consent; rejects bad media and sizes', async () => {
    const u = await setup('v_noconsent', 'islam', false);
    expect((await upload(u.token, u.logId, audio())).body.error.code).toBe('consent_required');
    await h.req('POST', '/me/consents', { token: u.token, body: { type: 'evidence', granted: true } });
    expect((await upload(u.token, u.logId, audio(), 'application/pdf')).body.error.code).toBe('unsupported_media');
    expect((await upload(u.token, u.logId, Buffer.alloc(0))).status).toBe(400);
  });
  it('rejects verification for activities without an approved task and for other users’ logs', async () => {
    const u = await h.register('v_wrongact', 'islam');
    await h.req('POST', '/me/consents', { token: u.token, body: { type: 'evidence', granted: true } });
    const l = await log(u.token, 'islam.worship.dhikr');
    expect((await upload(u.token, l.body.logId, audio())).body.error.code).toBe('verification_unavailable');
    const owner = await setup('v_owner');
    const thief = await h.register('v_thief', 'islam');
    await h.req('POST', '/me/consents', { token: thief.token, body: { type: 'evidence', granted: true } });
    expect((await upload(thief.token, owner.logId, audio())).status).toBe(404);
  });
  it('stores evidence encrypted-at-rest wrapper, routes to review, and blocks same-user replay', async () => {
    const u = await setup('v_flow');
    const a = audio();
    const s = await upload(u.token, u.logId, a);
    expect(s.status).toBe(201);
    expect((await h.db.query('select status from activity_logs where id=$1', [u.logId])).rows[0].status).toBe('pending_review');
    const own = await upload(u.token, u.logId, a);
    expect(own.status).toBe(409); // log no longer submittable / duplicate
  });
  it('flags cross-user duplicate audio for the reviewer instead of silently awarding', async () => {
    const a = audio();
    const u1 = await setup('v_dup1'); await upload(u1.token, u1.logId, a);
    const u2 = await setup('v_dup2'); await upload(u2.token, u2.logId, a);
    const sub = (await h.db.query("select risk_flags from verification_submissions where user_id=$1", [u2.id])).rows[0];
    expect(sub.risk_flags).toContain('duplicate_audio');
  });
});

describe('reviewer workflow', () => {
  it('reviewers see tasks for their own tradition only, with no identity data', async () => {
    const m = await setup('v_rv_m', 'islam'); await upload(m.token, m.logId, audio());
    const c = await setup('v_rv_c', 'christianity'); await upload(c.token, c.logId, audio());
    const iq = await queue(imam.token);
    const pq = await queue(pastor.token);
    expect(iq.every((t) => t.tradition === 'islam')).toBe(true);
    expect(pq.every((t) => t.tradition === 'christianity')).toBe(true);
    const sample = JSON.stringify(iq[0]);
    expect(sample).not.toMatch(/user_id|email|pseudonym|v_rv_m/);
    const plain = await h.staff('plain_rev', ['verification_reviewer']);
    expect(await queue(plain.token)).toHaveLength(0);
    const normal = await h.register('v_normie');
    expect((await h.req('GET', '/review/tasks', { token: normal.token })).status).toBe(403);
  });
  it('verified decision: marks log verified, adds NO points, and moves it to the verified board', async () => {
    const u = await setup('v_ok');
    await h.req('POST', '/leaderboards/A/membership', { token: u.token, body: { consent: true } });
    await h.req('POST', '/leaderboards/B/membership', { token: u.token, body: { consent: true } });
    await upload(u.token, u.logId, audio());
    expect(await totals(u.token)).toEqual({ eligible: 15, verified: 0 });
    const task = (await queue(imam.token)).find(async () => true)!;
    const mine = (await h.db.query("select t.id from review_tasks t join verification_submissions s on s.id=t.submission_id where s.user_id=$1", [u.id])).rows[0].id;
    void task;
    const res = await h.req('POST', `/review/tasks/${mine}/decision`, { token: imam.token, body: { decision: 'verified', rubric: { words_match: true }, notes: 'clear' } });
    expect(res.status).toBe(200);
    expect(await totals(u.token)).toEqual({ eligible: 15, verified: 15 });
    expect((await h.req('GET', '/leaderboards/B?period=weekly', { token: u.token })).body.me.points).toBe(15);
    expect((await h.req('GET', '/leaderboards/A?period=weekly', { token: u.token })).body.me.points).toBe(15);
    const again = await h.req('POST', `/review/tasks/${mine}/decision`, { token: imam.token, body: { decision: 'verified' } });
    expect(again.status).toBe(409);
    // evidence retention is now short and scheduled
    const ev = (await h.db.query('select retention_expires_at from evidence_objects where user_id=$1', [u.id])).rows[0];
    expect(new Date(ev.retention_expires_at).getTime() - h.clock.now.getTime()).toBeLessThan(15 * 86_400_000);
  });
  it('a reviewer cannot decide tasks of another tradition', async () => {
    const c = await setup('v_cross', 'christianity'); await upload(c.token, c.logId, audio());
    const tid = (await h.db.query("select t.id from review_tasks t join verification_submissions s on s.id=t.submission_id where s.user_id=$1", [c.id])).rows[0].id;
    expect((await h.req('POST', `/review/tasks/${tid}/decision`, { token: imam.token, body: { decision: 'verified' } })).status).toBe(403);
  });
  it('unable_to_verify keeps points; rejected reverses them transparently; neither is called dishonesty', async () => {
    const u1 = await setup('v_unable'); await upload(u1.token, u1.logId, audio());
    const t1 = (await h.db.query("select t.id from review_tasks t join verification_submissions s on s.id=t.submission_id where s.user_id=$1", [u1.id])).rows[0].id;
    await h.req('POST', `/review/tasks/${t1}/decision`, { token: imam.token, body: { decision: 'unable_to_verify', notes: 'noisy' } });
    expect(await totals(u1.token)).toEqual({ eligible: 15, verified: 0 });
    // user can retry with a new recording
    expect((await upload(u1.token, u1.logId, audio())).status).toBe(201);

    const u2 = await setup('v_reject'); await upload(u2.token, u2.logId, audio());
    const t2 = (await h.db.query("select t.id from review_tasks t join verification_submissions s on s.id=t.submission_id where s.user_id=$1", [u2.id])).rows[0].id;
    await h.req('POST', `/review/tasks/${t2}/decision`, { token: imam.token, body: { decision: 'rejected', notes: 'wrong passage' } });
    expect(await totals(u2.token)).toEqual({ eligible: 0, verified: 0 });
    const entries = (await h.db.query('select kind, eligible_points from ledger_entries where user_id=$1 order by id', [u2.id])).rows;
    expect(entries.map((e: any) => e.kind)).toEqual(['award', 'reversal']); // history preserved, never rewritten
  });
});

describe('appeals', () => {
  it('overturned appeal restores points and verifies; the original reviewer is excluded', async () => {
    const u = await setup('v_appeal'); await upload(u.token, u.logId, audio());
    const sid = (await h.db.query('select id from verification_submissions where user_id=$1', [u.id])).rows[0].id;
    const tid = (await h.db.query('select id from review_tasks where submission_id=$1', [sid])).rows[0].id;
    await h.req('POST', `/review/tasks/${tid}/decision`, { token: imam.token, body: { decision: 'rejected', notes: 'x' } });
    expect(await totals(u.token)).toEqual({ eligible: 0, verified: 0 });
    const ap = await h.req('POST', `/verification/submissions/${sid}/appeal`, { token: u.token, body: { message: 'please recheck' } });
    expect(ap.status).toBe(200);
    expect((await h.req('POST', `/verification/submissions/${sid}/appeal`, { token: u.token, body: {} })).status).toBe(409);
    expect((await queue(imam.token)).some((t) => t.kind === 'appeal')).toBe(false); // original reviewer excluded
    const appealTask = (await queue(imam2.token)).find((t) => t.kind === 'appeal');
    expect(appealTask).toBeTruthy();
    expect((await h.req('POST', `/review/tasks/${appealTask.id}/decision`, { token: imam.token, body: { decision: 'verified' } })).status).toBe(403);
    expect((await h.req('POST', `/review/tasks/${appealTask.id}/decision`, { token: imam2.token, body: { decision: 'verified' } })).status).toBe(200);
    expect(await totals(u.token)).toEqual({ eligible: 15, verified: 15 });
    expect((await h.db.query('select status from appeals where submission_id=$1', [sid])).rows[0].status).toBe('overturned');
    const inv = await h.req('GET', '/admin/ledger-check', { token: (await h.staff('aud_v', ['auditor'])).token });
    expect(inv.body.ok).toBe(true);
  });
  it('appeal window closes and appeals need a decided, non-verified submission', async () => {
    const u = await setup('v_late'); await upload(u.token, u.logId, audio());
    const sid = (await h.db.query('select id from verification_submissions where user_id=$1', [u.id])).rows[0].id;
    expect((await h.req('POST', `/verification/submissions/${sid}/appeal`, { token: u.token, body: {} })).status).toBe(409); // still pending
    const tid = (await h.db.query('select id from review_tasks where submission_id=$1', [sid])).rows[0].id;
    await h.req('POST', `/review/tasks/${tid}/decision`, { token: imam.token, body: { decision: 'unable_to_verify' } });
    h.clock.now = new Date('2026-11-05T12:00:00Z');
    expect((await h.req('POST', `/verification/submissions/${sid}/appeal`, { token: u.token, body: {} })).body.error.code).toBe('appeal_window_closed');
    h.clock.now = new Date('2026-10-11T12:00:00Z');
  });
  it('another user cannot appeal someone else’s submission', async () => {
    const u = await setup('v_own2'); await upload(u.token, u.logId, audio());
    const sid = (await h.db.query('select id from verification_submissions where user_id=$1', [u.id])).rows[0].id;
    const other = await h.register('v_other2');
    expect((await h.req('POST', `/verification/submissions/${sid}/appeal`, { token: other.token, body: {} })).status).toBe(404);
  });
});

describe('evidence access and retention', () => {
  it('audio URLs are signed, short-lived, audited, and stop working after the decision', async () => {
    const u = await setup('v_audio'); const a = audio(0x00, 128); await upload(u.token, u.logId, a);
    const tid = (await h.db.query("select t.id from review_tasks t join verification_submissions s on s.id=t.submission_id where s.user_id=$1", [u.id])).rows[0].id;
    expect((await h.req('POST', `/review/tasks/${tid}/audio-url`, { token: pastor.token })).status).toBe(403);
    const url = (await h.req('POST', `/review/tasks/${tid}/audio-url`, { token: imam.token })).body.url as string;
    const ok = await h.req('GET', url);
    expect(ok.status).toBe(200);
    expect(ok.raw.equals(a)).toBe(true);
    expect((await h.req('GET', url + 'x')).status).toBe(401);
    expect((await h.db.query("select 1 from audit_logs where action='evidence.accessed'")).rows.length).toBeGreaterThan(0);
    h.clock.now = new Date('2026-10-11T12:06:00Z');
    expect((await h.req('GET', url)).status).toBe(401); // expired
    h.clock.now = new Date('2026-10-11T12:00:00Z');
    await h.req('POST', `/review/tasks/${tid}/decision`, { token: imam.token, body: { decision: 'verified' } });
    expect((await h.req('GET', url)).status).toBe(404);
  });
  it('stored blobs are ciphertext, never raw audio', async () => {
    const mem = new (await import('../src/services/evidenceStore')).MemoryStore();
    const { EncryptedStore } = await import('../src/services/evidenceStore');
    const es = new EncryptedStore(mem, Buffer.alloc(32, 7));
    const plain = Buffer.from('recitation-bytes-recitation-bytes');
    await es.put('k', plain);
    expect(mem.data.get('k')!.includes(plain)).toBe(false);
    expect((await es.get('k')).equals(plain)).toBe(true);
    mem.data.set('k', Buffer.concat([mem.data.get('k')!.subarray(0, 30), Buffer.from('tamper'), mem.data.get('k')!.subarray(36)]));
    await expect(es.get('k')).rejects.toThrow();
  });
  it('retention job deletes expired blobs and keeps only the hash and the decision', async () => {
    const u = await setup('v_ret'); await upload(u.token, u.logId, audio());
    const tid = (await h.db.query("select t.id from review_tasks t join verification_submissions s on s.id=t.submission_id where s.user_id=$1", [u.id])).rows[0].id;
    await h.req('POST', `/review/tasks/${tid}/decision`, { token: imam.token, body: { decision: 'verified' } });
    const before = h.store.data.size;
    expect(await runRetention(h.db, h.store, new Date('2026-10-11T12:00:00Z'))).toBe(0);
    const n = await runRetention(h.db, h.store, new Date('2026-10-30T12:00:00Z'));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(h.store.data.size).toBeLessThan(before);
    const ev = (await h.db.query('select storage_key, sha256, deleted_at from evidence_objects where user_id=$1', [u.id])).rows[0];
    expect(ev.storage_key).toBeNull();
    expect(ev.sha256).toHaveLength(64);
    expect(ev.deleted_at).toBeTruthy();
    expect((await h.db.query('select 1 from review_decisions')).rows.length).toBeGreaterThan(0);
  });
  it('account deletion removes stored blobs', async () => {
    const u = await setup('v_delacct'); await upload(u.token, u.logId, audio());
    const before = h.store.data.size;
    await h.req('DELETE', '/me', { token: u.token, body: { confirm: true } });
    expect(h.store.data.size).toBe(before - 1);
  });
  it('user can delete their own evidence unless a review is pending', async () => {
    const u = await setup('v_deleve'); await upload(u.token, u.logId, audio());
    expect((await h.req('DELETE', '/me/evidence', { token: u.token })).status).toBe(409);
    const tid = (await h.db.query("select t.id from review_tasks t join verification_submissions s on s.id=t.submission_id where s.user_id=$1", [u.id])).rows[0].id;
    await h.req('POST', `/review/tasks/${tid}/decision`, { token: imam.token, body: { decision: 'verified' } });
    const r = await h.req('DELETE', '/me/evidence', { token: u.token });
    expect(r.body.deleted).toBe(1);
  });
});

describe('AI pre-check (feature-flagged)', () => {
  it('is OFF by default: no AI result is computed', async () => {
    const u = await setup('ai_off', 'islam'); await h.req('POST', '/me/consents', { token: u.token, body: { type: 'ai_processing', granted: true } });
    await upload(u.token, u.logId, audio(0x01));
    expect((await h.db.query('select ai_result from verification_submissions where user_id=$1', [u.id])).rows[0].ai_result).toBeNull();
  });
  it('when ON it is advisory only: a match still waits for a human; review/abstain never reject', async () => {
    const adm = await h.staff('flag_admin', ['super_admin']);
    await h.req('PUT', '/admin/flags/ai_precheck', { token: adm.token, body: { enabled: true } });
    const u = await setup('ai_on'); await h.req('POST', '/me/consents', { token: u.token, body: { type: 'ai_processing', granted: true } });
    await upload(u.token, u.logId, audio(0x01));
    const row = (await h.db.query('select status, ai_result from verification_submissions where user_id=$1', [u.id])).rows[0];
    expect(row.ai_result.result).toBe('match');
    expect(row.status).toBe('pending_review');
    const u2 = await setup('ai_unsure'); await h.req('POST', '/me/consents', { token: u2.token, body: { type: 'ai_processing', granted: true } });
    await upload(u2.token, u2.logId, audio(0x02));
    expect((await h.db.query('select status from verification_submissions where user_id=$1', [u2.id])).rows[0].status).toBe('pending_review');
    expect(await totals(u2.token)).toEqual({ eligible: 15, verified: 0 });
  });
  it('without ai_processing consent the provider is never called', async () => {
    const u = await setup('ai_noconsent'); await upload(u.token, u.logId, audio(0x01));
    expect((await h.db.query('select ai_result from verification_submissions where user_id=$1', [u.id])).rows[0].ai_result).toBeNull();
  });
  it('auto-verify needs its own flag, high confidence, and no risk flags', async () => {
    const adm = await h.staff('flag_admin2', ['super_admin']);
    await h.req('PUT', '/admin/flags/ai_auto_verify', { token: adm.token, body: { enabled: true } });
    const u = await setup('ai_auto'); await h.req('POST', '/me/consents', { token: u.token, body: { type: 'ai_processing', granted: true } });
    await upload(u.token, u.logId, audio(0x01));
    expect((await h.db.query('select status from verification_submissions where user_id=$1', [u.id])).rows[0].status).toBe('verified');
    expect(await totals(u.token)).toEqual({ eligible: 15, verified: 15 });
    // duplicate-audio risk flag forces human review even for a "match"
    const dup = audio(0x01);
    const a = await setup('ai_auto_d1'); await h.req('POST', '/me/consents', { token: a.token, body: { type: 'ai_processing', granted: true } }); await upload(a.token, a.logId, dup);
    const b = await setup('ai_auto_d2'); await h.req('POST', '/me/consents', { token: b.token, body: { type: 'ai_processing', granted: true } }); await upload(b.token, b.logId, dup);
    expect((await h.db.query('select status from verification_submissions where user_id=$1', [b.id])).rows[0].status).toBe('pending_review');
    void PW;
  });
});
