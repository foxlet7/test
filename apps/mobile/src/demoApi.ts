/**
 * DEMO BACKEND — runs entirely on the phone so the app can be tried without a server.
 * It mirrors the real API's rules (repeat limits, date window, verification adds no points, per-tradition
 * opt-in rankings) using the same shared helpers, but it is a simulation: rankings include fictional
 * participants and the "reviewer" is a timer. Nothing here is used in real deployments.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SEEDS, addDays, checkRepeatPolicy, computeAchievements, daysBetween, periodCutoff, periodRange, validateLogDate, weekStart,
  type Period, type Tradition,
} from '@gdc/shared';
import { ApiError } from './errors';

const KEY = 'gdc_demo_state_v1';
const REVIEW_DELAY_MS = 6000;
type Board = 'A' | 'B';

interface User { id: string; email: string; password: string; pseudonym: string; lang: 'en' | 'ar'; tradition: Tradition | null; weeklyGoal: number; consents: Record<string, boolean>; memberships: Board[] }
interface Log { id: string; userId: string; activityId: string; date: string; status: string; note: string | null; milestoneKey: string | null; idem: string; createdAt: number }
interface Entry { userId: string; logId: string; eligible: number; verified: number; date: string; category: string; createdAt: number }
interface Sub { id: string; userId: string; logId: string; status: string; createdAt: number; decidedAt: number | null; appeal: boolean; wasRejectedFirst: boolean }
interface State { users: User[]; logs: Log[]; ledger: Entry[]; subs: Sub[]; current: string | null; seq: number; evidenceDeleted: string[] }

let state: State | null = null;
const empty = (): State => ({ users: [], logs: [], ledger: [], subs: [], current: null, seq: 1, evidenceDeleted: [] });

async function load(): Promise<State> {
  if (state) return state;
  try { state = JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null') ?? empty(); } catch { state = empty(); }
  return state!;
}
const save = async () => { try { await AsyncStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full/unavailable */ } };
const uid = (s: State, p: string) => `${p}-${Date.now().toString(36)}-${s.seq++}`;
const todayUtc = () => new Date().toISOString().slice(0, 10);
const fail = (status: number, code: string): never => { throw new ApiError(status, code); };

const FAKE: Record<Tradition, [string, number, number][]> = {
  islam: [['demo_amina', 42, 30], ['demo_yusuf', 35, 20], ['demo_maryam', 28, 15], ['demo_hana', 20, 10], ['demo_omar', 12, 0]],
  christianity: [['demo_grace', 40, 25], ['demo_daniel', 33, 15], ['demo_ruth', 27, 15], ['demo_samuel', 18, 0], ['demo_lydia', 10, 0]],
};
const FAKE_NAMES = new Set(Object.values(FAKE).flat().map((f) => f[0]));
const SCALE: Record<Period, number> = { weekly: 1, monthly: 3, lifetime: 9 };

const actDef = (id: string) => SEEDS.find((s) => s.id === id);
const viewItem = (s: (typeof SEEDS)[number]) => ({
  id: s.id, tradition: s.tradition, category: s.category, type: s.type, obligation_class: s.obligation, verification_class: s.vclass,
  version: 1, base_points: s.points, repeat_policy: s.repeat, title_en: s.en[0], title_ar: s.ar[0], description_en: s.en[1], description_ar: s.ar[1],
  notes_en: s.notesEn ?? null, notes_ar: s.notesAr ?? null, religious_references: (s.refs ?? []).map((r) => ({ ...r, verified: false })), translation_status: 'machine_draft',
  verifiable: s.vclass === 'B',
});

function me(s: State): User { const u = s.users.find((x) => x.id === s.current); return u ?? fail(401, 'unauthorized'); }
const sum = (s: State, userId: string, from: string | null, to: string | null) => {
  let eligible = 0, verified = 0;
  for (const e of s.ledger) if (e.userId === userId && (!from || e.date >= from) && (!to || e.date <= to)) { eligible += e.eligible; verified += e.verified; }
  return { eligible, verified };
};

/** The simulated reviewer: decides pending submissions after a short delay. */
function runReviewer(s: State) {
  const now = Date.now();
  for (const sub of s.subs) {
    if (sub.status !== 'pending_review' || now - sub.createdAt < REVIEW_DELAY_MS) continue;
    const log = s.logs.find((l) => l.id === sub.logId)!;
    const firstEver = !s.subs.some((o) => o.userId === sub.userId && o.id !== sub.id && o.decidedAt !== null) && !sub.appeal;
    const decision = firstEver ? 'unable_to_verify' : 'verified'; // first attempt exercises the "unclear → appeal" path
    sub.status = decision; sub.decidedAt = now; log.status = decision;
    if (decision === 'verified') {
      const awarded = s.ledger.filter((e) => e.logId === log.id).reduce((a, e) => a + e.eligible, 0);
      const already = s.ledger.filter((e) => e.logId === log.id).reduce((a, e) => a + e.verified, 0);
      if (awarded - already > 0) {
        // Verification adds NO points: the verified entry carries the points already awarded.
        const verifiedDate = daysBetween(log.date, todayUtc()) <= 14 ? log.date : todayUtc();
        s.ledger.push({ userId: sub.userId, logId: log.id, eligible: 0, verified: awarded - already, date: verifiedDate, category: actDef(log.activityId)!.category, createdAt: now });
      }
    }
  }
}

export async function demoAuth(path: '/auth/login' | '/auth/register', body: any) {
  const s = await load();
  if (path === '/auth/login') {
    const u = s.users.find((x) => x.email === String(body.email).trim().toLowerCase() && x.password === body.password);
    if (!u) return fail(401, 'invalid_credentials');
    s.current = u.id; await save();
    return { accessToken: 'demo', refreshToken: 'demo', userId: u.id };
  }
  if (!body.inviteCode) fail(400, 'invite_invalid');
  if (!body.adultConfirmed || String(body.password).length < 10) fail(400, 'validation_failed');
  const email = String(body.email).trim().toLowerCase();
  if (s.users.some((x) => x.email === email)) fail(409, 'email_taken');
  const nick = String(body.pseudonym).trim();
  if (nick.length < 3 || nick.includes('@') || FAKE_NAMES.has(nick) || s.users.some((x) => x.pseudonym.toLowerCase() === nick.toLowerCase())) fail(409, 'pseudonym_taken');
  const u: User = { id: uid(s, 'u'), email, password: body.password, pseudonym: nick, lang: body.uiLanguage === 'ar' ? 'ar' : 'en', tradition: body.tradition ?? null, weeklyGoal: 5, consents: { account: true }, memberships: [] };
  s.users.push(u); s.current = u.id; await save();
  return { accessToken: 'demo', refreshToken: 'demo', userId: u.id };
}

export async function demoApi(path: string, opts: { method?: string; json?: any; form?: FormData } = {}): Promise<any> {
  const s = await load();
  const method = opts.method ?? (opts.json || opts.form ? 'POST' : 'GET');
  const [pathname, query = ''] = path.split('?');
  const q = new URLSearchParams(query);
  const body = opts.json ?? {};
  let m: RegExpMatchArray | null;

  if (pathname === '/me' && method === 'GET') {
    const u = me(s);
    return { id: u.id, roles: [], profile: { pseudonym: u.pseudonym, ui_language: u.lang, tradition: u.tradition, weekly_goal: u.weeklyGoal }, consents: Object.entries(u.consents).filter(([, v]) => v).map(([type]) => ({ type })), memberships: u.memberships };
  }
  if (pathname === '/me' && method === 'DELETE') {
    const u = me(s);
    s.users = s.users.filter((x) => x.id !== u.id); s.logs = s.logs.filter((l) => l.userId !== u.id); s.ledger = s.ledger.filter((e) => e.userId !== u.id); s.subs = s.subs.filter((x) => x.userId !== u.id);
    s.current = null; await save(); return { ok: true };
  }
  if (pathname === '/me/profile' && method === 'PATCH') {
    const u = me(s);
    if (body.pseudonym) {
      const n = String(body.pseudonym).trim();
      if (FAKE_NAMES.has(n) || s.users.some((x) => x.id !== u.id && x.pseudonym.toLowerCase() === n.toLowerCase())) fail(409, 'pseudonym_taken');
      u.pseudonym = n;
    }
    if (body.uiLanguage) u.lang = body.uiLanguage;
    if (body.weeklyGoal) u.weeklyGoal = body.weeklyGoal;
    if (body.tradition !== undefined && body.tradition !== u.tradition) { u.tradition = body.tradition; u.memberships = []; u.consents.leaderboard_A = false; u.consents.leaderboard_B = false; }
    await save(); return { ok: true };
  }
  if (pathname === '/me/consents' && method === 'GET') {
    const u = me(s);
    return { consents: Object.entries(u.consents).map(([type, on]) => ({ type, version: 'v1', revoked_at: on ? null : 'x' })) };
  }
  if (pathname === '/me/consents' && method === 'POST') {
    const u = me(s);
    u.consents[body.type] = !!body.granted;
    if (!body.granted && body.type === 'leaderboard_A') u.memberships = u.memberships.filter((b) => b !== 'A');
    if (!body.granted && body.type === 'leaderboard_B') u.memberships = u.memberships.filter((b) => b !== 'B');
    await save(); return { ok: true };
  }
  if (pathname === '/me/export') {
    const u = me(s);
    return { demo: true, profile: { pseudonym: u.pseudonym, tradition: u.tradition }, consents: u.consents, activityLogs: s.logs.filter((l) => l.userId === u.id), ledger: s.ledger.filter((e) => e.userId === u.id) };
  }
  if (pathname === '/me/evidence' && method === 'DELETE') {
    const u = me(s);
    if (s.subs.some((x) => x.userId === u.id && x.status === 'pending_review')) fail(409, 'pending_review');
    s.evidenceDeleted.push(u.id); await save(); return { deleted: s.subs.filter((x) => x.userId === u.id).length };
  }

  if (pathname === '/catalogue') {
    const u = me(s);
    const tradition = (q.get('tradition') as Tradition) || u.tradition;
    if (!tradition) return { tradition: null, items: [] };
    const term = (q.get('q') ?? '').toLowerCase(); const cat = q.get('category');
    return { tradition, items: SEEDS.filter((x) => x.tradition === tradition && (!cat || x.category === cat) && (!term || x.en[0].toLowerCase().includes(term) || x.ar[0].includes(term))).map(viewItem) };
  }
  if ((m = pathname.match(/^\/scripture-tasks\/(.+)$/))) {
    const a = actDef(m[1]!);
    if (!a || a.vclass !== 'B') fail(404, 'task_not_found');
    return { id: `demo-${a!.tradition}`, activity_id: a!.id, title_en: 'Demo recitation task', title_ar: 'مهمة تلاوة تجريبية', passage_ref: 'Demo passage (real reviewers set this)', reference_edition: 'Demo edition', permitted_variations: 'Demo mode: nothing you record is uploaded.' };
  }
  if (pathname === '/reports') { me(s); return { ok: true }; }

  if (pathname === '/logs' && method === 'POST') {
    const u = me(s);
    if (!u.tradition) fail(400, 'tradition_required');
    const dup = s.logs.find((l) => l.userId === u.id && l.idem === body.idempotencyKey);
    if (dup) return { logId: dup.id, pointsAwarded: s.ledger.filter((e) => e.logId === dup.id).reduce((a, e) => a + e.eligible, 0), duplicate: true, countsFor: ['A'], status: dup.status };
    const a = actDef(body.activityId);
    if (!a || a.tradition !== u.tradition) fail(404, 'activity_not_found');
    const chk = validateLogDate(body.localDate, todayUtc(), { maxBackdateDays: 2 });
    if (!chk.ok) fail(400, chk.reason!);
    const ws = weekStart(body.localDate);
    const mine = s.logs.filter((l) => l.userId === u.id && l.activityId === a!.id && l.status !== 'rejected');
    const dec = checkRepeatPolicy(a!.repeat, {
      countOnDate: mine.filter((l) => l.date === body.localDate).length,
      countInWeek: mine.filter((l) => l.date >= ws && l.date <= addDays(ws, 6)).length,
      milestoneExists: !!body.milestoneKey && mine.some((l) => l.milestoneKey === body.milestoneKey), milestoneKey: body.milestoneKey,
    });
    if (!dec.ok) fail(409, dec.reason);
    const log: Log = { id: uid(s, 'l'), userId: u.id, activityId: a!.id, date: body.localDate, status: 'self_reported', note: body.note ?? null, milestoneKey: body.milestoneKey ?? null, idem: body.idempotencyKey, createdAt: Date.now() };
    s.logs.push(log);
    s.ledger.push({ userId: u.id, logId: log.id, eligible: a!.points, verified: 0, date: log.date, category: a!.category, createdAt: Date.now() });
    await save();
    return { logId: log.id, pointsAwarded: a!.points, duplicate: false, countsFor: ['A'], status: log.status };
  }

  if (pathname === '/dashboard') {
    const u = me(s);
    const week = periodRange('weekly', todayUtc()), month = periodRange('monthly', todayUtc());
    const logs = s.logs.filter((l) => l.userId === u.id && l.status !== 'rejected');
    const cats = new Map<string, { eligible: number; verified: number }>();
    for (const e of s.ledger.filter((x) => x.userId === u.id)) { const c = cats.get(e.category) ?? { eligible: 0, verified: 0 }; c.eligible += e.eligible; c.verified += e.verified; cats.set(e.category, c); }
    const from30 = addDays(todayUtc(), -29);
    return {
      today: todayUtc(),
      totals: { week: sum(s, u.id, week.from, week.to), month: sum(s, u.id, month.from, month.to), lifetime: sum(s, u.id, null, null) },
      categories: [...cats.entries()].map(([category, v]) => ({ category, ...v })),
      activeDays30: new Set(logs.filter((l) => l.date >= from30).map((l) => l.date)).size,
      weeklyGoal: { target: u.weeklyGoal, logged: logs.filter((l) => l.date >= week.from! && l.date <= week.to!).length },
      achievements: computeAchievements(logs.map((l) => ({ local_date: l.date, type: actDef(l.activityId)!.type }))),
      recent: [...s.logs.filter((l) => l.userId === u.id)].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map((l) => ({ id: l.id, activity_id: l.activityId, local_date: l.date, status: l.status, created_at: l.createdAt, title_en: actDef(l.activityId)!.en[0], title_ar: actDef(l.activityId)!.ar[0] })),
      note: 'points_are_game_mechanics',
    };
  }

  if ((m = pathname.match(/^\/leaderboards\/([AB])$/)) && method === 'GET') {
    const u = me(s); const board = m[1] as Board; const period = (q.get('period') ?? 'weekly') as Period;
    if (!u.tradition) fail(400, 'tradition_required');
    const range = periodRange(period, todayUtc());
    const rows: { pseudonym: string; points: number; mine: boolean }[] = FAKE[u.tradition!].map(([n, a, v]) => ({ pseudonym: n, points: (board === 'A' ? a : v) * SCALE[period], mine: false }));
    const isMember = u.memberships.includes(board);
    if (isMember) { const t = sum(s, u.id, range.from, range.to); rows.push({ pseudonym: u.pseudonym, points: board === 'A' ? t.eligible : t.verified, mine: true }); }
    const ranked = rows.filter((r) => r.points > 0).sort((a, b) => b.points - a.points || a.pseudonym.localeCompare(b.pseudonym)).map((r, i) => ({ ...r, rank: i + 1 }));
    const mine = ranked.find((r) => r.mine);
    return { board, period, tradition: u.tradition, periodStart: range.from, periodEnd: range.to, cutoff: periodCutoff(period, todayUtc()), rows: ranked.slice(0, 50).map(({ rank, pseudonym, points }) => ({ rank, pseudonym, points })), me: mine ? { rank: mine.rank, points: mine.points } : null, isMember };
  }
  if ((m = pathname.match(/^\/leaderboards\/([AB])\/membership$/))) {
    const u = me(s); const board = m[1] as Board;
    if (method === 'POST') { if (!u.tradition) fail(400, 'tradition_required'); u.consents[`leaderboard_${board}`] = true; if (!u.memberships.includes(board)) u.memberships.push(board); }
    else { u.memberships = u.memberships.filter((b) => b !== board); u.consents[`leaderboard_${board}`] = false; }
    await save(); return { ok: true };
  }

  if (pathname === '/verification/submissions' && method === 'POST') {
    const u = me(s);
    if (!u.consents.evidence) fail(403, 'consent_required');
    const parts: [string, unknown][] = (opts.form as any)?._parts ?? [];
    const logId = String(parts.find((p) => p[0] === 'logId')?.[1] ?? '');
    const log = s.logs.find((l) => l.id === logId && l.userId === u.id) ?? fail(404, 'log_not_found');
    if (!['self_reported', 'unable_to_verify'].includes(log!.status)) fail(409, 'not_submittable');
    const sub: Sub = { id: uid(s, 's'), userId: u.id, logId, status: 'pending_review', createdAt: Date.now(), decidedAt: null, appeal: false, wasRejectedFirst: false };
    s.subs.push(sub); log!.status = 'pending_review'; s.evidenceDeleted = s.evidenceDeleted.filter((x) => x !== u.id); await save();
    return { submissionId: sub.id };
  }
  if (pathname === '/verification/submissions' && method === 'GET') {
    const u = me(s); runReviewer(s); await save();
    return { submissions: s.subs.filter((x) => x.userId === u.id).map((x) => ({ id: x.id, log_id: x.logId, task_id: `demo-${u.tradition}`, status: x.status, created_at: x.createdAt, decided_at: x.decidedAt, appeal_status: x.appeal ? (x.status === 'pending_review' ? 'open' : 'overturned') : null, evidence_stored: !s.evidenceDeleted.includes(u.id) })) };
  }
  if ((m = pathname.match(/^\/verification\/submissions\/(.+)\/appeal$/))) {
    const u = me(s);
    const sub = s.subs.find((x) => x.id === m![1] && x.userId === u.id) ?? fail(404, 'submission_not_found');
    if (!['unable_to_verify', 'rejected'].includes(sub!.status) || sub!.appeal) fail(409, 'not_appealable');
    sub!.appeal = true; sub!.status = 'pending_review'; sub!.createdAt = Date.now();
    const log = s.logs.find((l) => l.id === sub!.logId)!; log.status = 'pending_review'; await save();
    return { ok: true };
  }
  return fail(404, 'not_found');
}
