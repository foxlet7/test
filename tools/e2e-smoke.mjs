// End-to-end API smoke test for a running server. Usage: API=http://localhost:8080 INVITE=DEMO-INVITE node tools/e2e-smoke.mjs
// Walks the real pilot flow: register -> log -> consent -> record -> review -> verified -> rankings.
const API = process.env.API ?? 'http://localhost:8080';
const INVITE = process.env.INVITE ?? 'DEMO-INVITE';
const PW = process.env.STAFF_PW ?? 'demo-password-123';
const run = Date.now().toString(36);
const j = async (method, path, { token, body, form } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(API + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const t = await r.text();
  let data; try { data = JSON.parse(t); } catch { data = t; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 200)}`);
  return data;
};
const ok = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); console.log('  ✓', m); };

const reg = await j('POST', '/auth/register', { body: { email: `e2e_${run}@example.com`, password: 'correct-horse-battery', inviteCode: INVITE, adultConfirmed: true, pseudonym: `e2e_${run}`, tradition: 'islam', uiLanguage: 'ar' } });
const t = reg.accessToken;
console.log('registered', `e2e_${run}`);
const cat = await j('GET', '/catalogue', { token: t });
ok(cat.items.length > 5, `catalogue has ${cat.items.length} approved Islam activities`);
const today = new Date().toISOString().slice(0, 10);
const l1 = await j('POST', '/logs', { token: t, body: { activityId: 'islam.quran.read_session', localDate: today, tz: 'UTC', idempotencyKey: `k1-${run}` } });
ok(l1.pointsAwarded === 5, 'read session = 5 pts');
const l2 = await j('POST', '/logs', { token: t, body: { activityId: 'islam.quran.memorize_milestone', milestoneKey: `m-${run}`, localDate: today, tz: 'UTC', idempotencyKey: `k2-${run}` } });
ok(l2.pointsAwarded === 15, 'memorization milestone = 15 pts');
await j('POST', '/leaderboards/A/membership', { token: t, body: { consent: true } });
await j('POST', '/leaderboards/B/membership', { token: t, body: { consent: true } });
await j('POST', '/me/consents', { token: t, body: { type: 'evidence', granted: true } });
const form = new FormData();
form.append('logId', l2.logId);
form.append('file', new Blob([Buffer.from('fake-audio-' + run + 'x'.repeat(200))], { type: 'audio/mp4' }), 'r.m4a');
const sub = await j('POST', '/verification/submissions', { token: t, form });
console.log('  submitted recitation', sub.submissionId);

const rev = await j('POST', '/auth/login', { body: { email: 'islam.reviewer@demo.local', password: PW } });
const tasks = (await j('GET', '/review/tasks', { token: rev.accessToken })).tasks;
ok(tasks.length >= 1 && !JSON.stringify(tasks).includes(`e2e_${run}`), 'reviewer sees the task without identity');
const task = tasks[0];
const { url } = await j('POST', `/review/tasks/${task.id}/audio-url`, { token: rev.accessToken, body: undefined });
const audio = await fetch(API + url);
ok(audio.ok && (await audio.arrayBuffer()).byteLength > 100, 'reviewer streams decrypted audio via short-lived signed URL');
await j('POST', `/review/tasks/${task.id}/decision`, { token: rev.accessToken, body: { decision: 'verified', rubric: { words_match: true }, notes: 'e2e' } });

const dash = await j('GET', '/dashboard', { token: t });
ok(dash.totals.lifetime.eligible === 20 && dash.totals.lifetime.verified === 15, `totals: 20 eligible, 15 verified (verification added no points)`);
const A = await j('GET', '/leaderboards/A?period=weekly', { token: t });
const B = await j('GET', '/leaderboards/B?period=weekly', { token: t });
ok(A.me?.points === 20 && B.me?.points === 15, 'board A=20, board B=15');
const aud = await j('POST', '/auth/login', { body: { email: 'auditor@demo.local', password: PW } });
const chk = await j('GET', '/admin/ledger-check', { token: aud.accessToken });
ok(chk.ok, 'ledger invariants + independent recomputation agree');
await j('DELETE', '/me', { token: t, body: { confirm: true } });
ok((await fetch(API + '/dashboard', { headers: { authorization: `Bearer ${t}` } })).status === 401, 'account deleted; token no longer works');
console.log('\nE2E SMOKE PASSED');
