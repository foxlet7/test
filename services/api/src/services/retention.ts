import type { Db } from '../db';
import type { BlobStore } from './evidenceStore';

/** Deletes expired evidence blobs. Keeps only the hash (duplicate/replay detection) and the decision record. */
export async function runRetention(db: Db, store: BlobStore, now: Date): Promise<number> {
  const due = await db.query<{ id: string; storage_key: string }>(
    'select id, storage_key from evidence_objects where deleted_at is null and storage_key is not null and retention_expires_at <= $1::timestamptz',
    [now.toISOString()],
  );
  let n = 0;
  for (const e of due.rows) {
    await store.delete(e.storage_key);
    await db.query('update evidence_objects set storage_key = null, deleted_at = $2::timestamptz where id = $1', [e.id, now.toISOString()]);
    n++;
  }
  await db.query('insert into retention_runs(deleted_count) values ($1)', [n]);
  return n;
}
