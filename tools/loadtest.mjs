// Minimal load test (no dependencies). Usage: API=http://localhost:8080 INVITE=LOAD-INVITE USERS=50 ROUNDS=20 node tools/loadtest.mjs
// Each virtual user registers, then repeatedly reads the dashboard/catalogue/leaderboard and logs deeds.
// Results depend heavily on the database and hardware; run it against a staging stack that mirrors production.
const API = process.env.API ?? 'http://localhost:8080';
const INVITE = process.env.INVITE ?? 'LOAD-INVITE';
const USERS = Number(process.env.USERS ?? 50);
const ROUNDS = Number(process.env.ROUNDS ?? 20);
const run = Date.now().toString(36);
const lat = { register: [], read: [], write: [] };
let errors = 0;

async function call(bucket, method, path, token, body) {
  const t0 = performance.now();
  const r = await fetch(API + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  lat[bucket].push(performance.now() - t0);
  const text = await r.text();
  if (r.status >= 500 || (r.status >= 400 && r.status !== 409)) { errors++; if (errors < 5) console.error(method, path, r.status, text.slice(0, 120)); }
  try { return JSON.parse(text); } catch { return null; }
}

const acts = ['islam.quran.read_session', 'islam.worship.dhikr', 'islam.charity.sadaqa', 'islam.character.help_neighbor'];
const today = new Date().toISOString().slice(0, 10);
async function user(i) {
  const reg = await call('register', 'POST', '/auth/register', null, { email: `lt_${run}_${i}@example.com`, password: 'correct-horse-battery', inviteCode: INVITE, adultConfirmed: true, pseudonym: `lt_${run}_${i}`, tradition: 'islam' });
  const t = reg?.accessToken;
  if (!t) return;
  await call('write', 'POST', '/leaderboards/A/membership', t, { consent: true });
  for (let r = 0; r < ROUNDS; r++) {
    await call('read', 'GET', '/dashboard', t);
    await call('read', 'GET', '/catalogue', t);
    await call('read', 'GET', '/leaderboards/A?period=weekly', t);
    await call('write', 'POST', '/logs', t, { activityId: acts[r % acts.length], localDate: today, tz: 'UTC', idempotencyKey: `lt-${run}-${i}-${r}` });
  }
}
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))].toFixed(1) : 'n/a');
const t0 = performance.now();
await Promise.all(Array.from({ length: USERS }, (_, i) => user(i)));
const secs = (performance.now() - t0) / 1000;
const total = Object.values(lat).reduce((n, a) => n + a.length, 0);
console.log(`users=${USERS} rounds=${ROUNDS} requests=${total} time=${secs.toFixed(1)}s rps=${(total / secs).toFixed(0)} errors(5xx/4xx!=409)=${errors}`);
for (const [k, a] of Object.entries(lat)) console.log(`${k.padEnd(8)} n=${String(a.length).padEnd(6)} p50=${pct(a, 50)}ms p95=${pct(a, 95)}ms p99=${pct(a, 99)}ms`);
process.exit(errors ? 1 : 0);
