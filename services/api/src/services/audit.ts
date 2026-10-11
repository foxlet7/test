import type { Db } from '../db';

/** Audit entries must never contain recordings, receipts, notes or other private content. */
export async function audit(db: Db, actorId: string | null, action: string, target: string | null = null, meta: Record<string, unknown> = {}): Promise<void> {
  await db.query('insert into audit_logs(actor_id, action, target, meta) values ($1,$2,$3,$4)', [actorId, action, target, JSON.stringify(meta)]);
}

export async function flagEnabled(db: Db, key: string): Promise<boolean> {
  const r = await db.query<{ enabled: boolean }>('select enabled from feature_flags where key = $1', [key]);
  return r.rows[0]?.enabled === true;
}
