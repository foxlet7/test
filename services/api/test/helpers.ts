import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import type { Role } from '@gdc/shared';
import { buildApp } from '../src/app';
import { bootstrap } from '../src/bootstrap';
import { loadConfig, type Config } from '../src/config';
import { openDb, type Db } from '../src/db';
import { MockProvider, type AssessmentProvider } from '../src/services/assessment';
import { MemoryStore } from '../src/services/evidenceStore';
import { seedCatalogue } from '../src/seed/catalogue';
import { createStaff } from '../src/seed/staff';

export interface Harness {
  app: FastifyInstance;
  db: Db;
  store: MemoryStore;
  clock: { now: Date };
  cfg: Config;
  req(method: string, url: string, opts?: { token?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: any; raw: Buffer }>;
  register(n: string, tradition?: 'islam' | 'christianity' | null): Promise<{ token: string; id: string; refresh: string }>;
  login(email: string, pw?: string): Promise<string>;
  staff(name: string, roles: Role[]): Promise<{ token: string; id: string }>;
  approveAll(): Promise<{ imam: string; pastor: string }>;
  close(): Promise<void>;
}

export const PW = 'correct-horse-battery';

export async function harness(opts: { provider?: AssessmentProvider; cfg?: Partial<Config> } = {}): Promise<Harness> {
  const cfg = loadConfig({ env: 'test', rateLimit: false, evidenceBackend: 'memory', ...opts.cfg });
  // Set TEST_PG_ADMIN_URL to run the whole suite against a real PostgreSQL server (one throwaway database per harness).
  let dbName: string | null = null;
  let databaseUrl: string | null = null;
  const adminUrl = process.env.TEST_PG_ADMIN_URL;
  if (adminUrl) {
    dbName = `gdc_t_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    await admin.end();
    const u = new URL(adminUrl);
    u.pathname = `/${dbName}`;
    databaseUrl = u.toString();
  }
  const db = await openDb({ databaseUrl, pgliteDir: null, env: 'test' });
  await bootstrap(db);
  await seedCatalogue(db);
  await db.query("insert into invites(code, max_uses) values ('TESTINVITE', 1000)");
  const store = new MemoryStore();
  const clock = { now: new Date('2026-10-11T12:00:00Z') };
  const app = await buildApp({ cfg, db, store, provider: opts.provider ?? new MockProvider(), now: () => new Date(clock.now) });
  await app.ready();

  const h: Harness = {
    app, db, store, clock, cfg,
    async req(method, url, o = {}) {
      const headers: Record<string, string> = { ...(o.headers ?? {}) };
      if (o.token) headers.authorization = `Bearer ${o.token}`;
      const r = await app.inject({ method: method as any, url, headers, payload: o.body as any });
      let body: any = null;
      try { body = r.body ? JSON.parse(r.body) : null; } catch { body = r.body; }
      return { status: r.statusCode, body, raw: r.rawPayload };
    },
    async register(n, tradition = 'islam') {
      const r = await h.req('POST', '/auth/register', { body: { email: `${n}@example.com`, password: PW, inviteCode: 'TESTINVITE', adultConfirmed: true, pseudonym: n, tradition } });
      if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`);
      return { token: r.body.accessToken, id: r.body.userId, refresh: r.body.refreshToken };
    },
    async login(email, pw = PW) {
      const r = await h.req('POST', '/auth/login', { body: { email, password: pw } });
      if (r.status !== 200) throw new Error(`login failed ${r.status}`);
      return r.body.accessToken;
    },
    async staff(name, roles) {
      const id = await createStaff(db, `${name}@staff.local`, PW, name, roles);
      return { id, token: await h.login(`${name}@staff.local`) };
    },
    async approveAll() {
      const imam = await createStaff(db, 'seed.imam@staff.local', PW, 'seed_imam', ['islamic_reviewer', 'verification_reviewer']);
      const pastor = await createStaff(db, 'seed.pastor@staff.local', PW, 'seed_pastor', ['christian_reviewer', 'verification_reviewer']);
      await db.query("update activity_versions set status='approved', translation_status='reviewed', approved_by=$1, approved_at=now() where status='draft'", [imam]);
      await db.query(
        `insert into scripture_tasks(id, activity_id, tradition, title_en, title_ar, passage_ref, reference_edition, rubric, status, approved_by, approved_at)
         values ('t-islam','islam.quran.memorize_milestone','islam','Task','مهمة','ref','ed','[{"criterion":"x","required":true}]','approved',$1,now()),
                ('t-christ','christianity.bible.memorize_milestone','christianity','Task','مهمة','ref','ed','[{"criterion":"x","required":true}]','approved',$2,now())`, [imam, pastor]);
      return { imam, pastor };
    },
    async close() {
      await app.close();
      await db.close();
      if (dbName && adminUrl) {
        const admin = new pg.Client({ connectionString: adminUrl });
        await admin.connect();
        await admin.query(`drop database if exists ${dbName} with (force)`);
        await admin.end();
      }
    },
  };
  return h;
}

export const today = (h: Harness) => h.clock.now.toISOString().slice(0, 10);
let seq = 0;
export const key = () => `idem-${Date.now()}-${++seq}`;
