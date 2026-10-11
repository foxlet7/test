import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import type { Config } from './config';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const DATE_OID = 1082;
const INT8_OID = 20;
const NUMERIC_OID = 1700;

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'migrations');
}

function wrapPglite(pgl: PGlite): Db {
  const make = (q: { query: PGlite['query'] }): Omit<Db, 'tx' | 'close' | 'exec'> => ({
    async query(sql, params) {
      const r = await q.query<any>(sql, params as any[]);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  const db: Db = {
    ...make(pgl),
    exec: async (sql) => {
      await pgl.exec(sql);
    },
    tx: (fn) =>
      pgl.transaction(async (t) => {
        const inner: Db = {
          ...make(t as any),
          exec: async (sql) => {
            await (t as any).exec(sql);
          },
          tx: (f) => f(inner), // nested => same transaction
          close: async () => {},
        };
        return fn(inner);
      }),
    close: () => pgl.close(),
  };
  return db;
}

function wrapPool(pool: pg.Pool): Db {
  const fromClient = (c: pg.PoolClient): Db => {
    const inner: Db = {
      async query(sql, params) {
        const r = await c.query(sql, params as any[]);
        return { rows: r.rows, rowCount: r.rowCount ?? 0 };
      },
      exec: async (sql) => {
        await c.query(sql);
      },
      tx: (f) => f(inner),
      close: async () => {},
    };
    return inner;
  };
  return {
    async query(sql, params) {
      const r = await pool.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    exec: async (sql) => {
      await pool.query(sql);
    },
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('begin');
        const out = await fn(fromClient(c));
        await c.query('commit');
        return out;
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function openDb(cfg: Pick<Config, 'databaseUrl' | 'pgliteDir' | 'env'>): Promise<Db> {
  let db: Db;
  if (cfg.databaseUrl) {
    pg.types.setTypeParser(DATE_OID, (v: string) => v);
    pg.types.setTypeParser(INT8_OID, (v: string) => Number(v));
    pg.types.setTypeParser(NUMERIC_OID, (v: string) => Number(v));
    db = wrapPool(new pg.Pool({ connectionString: cfg.databaseUrl, max: 10 }));
  } else {
    if (cfg.env === 'production') throw new Error('Embedded database is not allowed in production');
    const pgl = new PGlite({
      ...(cfg.pgliteDir ? { dataDir: cfg.pgliteDir } : {}),
      parsers: { [DATE_OID]: (v: string) => v, [INT8_OID]: (v: string) => Number(v), [NUMERIC_OID]: (v: string) => Number(v) },
    });
    await pgl.waitReady;
    db = wrapPglite(pgl);
  }
  await migrate(db);
  return db;
}

export async function migrate(db: Db): Promise<void> {
  await db.exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = migrationsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    await db.tx(async (t) => {
      await t.exec(readFileSync(join(dir, f), 'utf8'));
      await t.query('insert into schema_migrations(name) values ($1)', [f]);
    });
  }
}
