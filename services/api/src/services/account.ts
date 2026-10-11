import type { Db } from '../db';
import { sha256 } from '../auth';
import type { BlobStore } from './evidenceStore';
import { audit } from './audit';

/**
 * Full erasure: evidence blobs, notes, logs, ledger, consents, memberships, tokens and profile.
 * Only a one-way hash of the id is retained to prove the request was honored.
 * Pending appeals do not block deletion — the user's request wins. Backups age out within 30 days (see PRIVACY.md).
 */
export async function deleteAccount(db: Db, store: BlobStore, userId: string, via: 'app' | 'web', now: Date): Promise<void> {
  const keys = (await db.query<{ storage_key: string }>(
    'select storage_key from evidence_objects where user_id = $1 and storage_key is not null', [userId])).rows.map((r) => r.storage_key);
  const ref = sha256(userId);
  await db.tx(async (t) => {
    await t.query("select set_config('app.purge_user', 'on', true)");
    await t.query('insert into deletion_requests(user_ref, via, requested_at) values ($1,$2,$3::timestamptz)', [ref, via, now.toISOString()]);
    await t.query('delete from users where id = $1', [userId]);
    await t.query("update deletion_requests set completed_at = now() where user_ref = $1 and completed_at is null", [ref]);
    await audit(t, null, 'account.deleted', ref, { via });
  });
  for (const k of keys) await store.delete(k);
}

export async function exportAccount(db: Db, userId: string) {
  const q = async (sql: string) => (await db.query(sql, [userId])).rows;
  const u = await db.query('select id, email, created_at from users where id = $1', [userId]);
  return {
    exportedAt: new Date().toISOString(),
    account: u.rows[0],
    profile: (await q('select pseudonym, ui_language, tradition, weekly_goal, adult_confirmed_at from profiles where user_id = $1'))[0],
    consents: await q('select type, version, granted_at, revoked_at from consents where user_id = $1 order by id'),
    leaderboardMemberships: await q('select board, joined_at from leaderboard_memberships where user_id = $1'),
    activityLogs: await q('select id, activity_id, local_date, tz, note, milestone_key, status, created_at, verified_at from activity_logs where user_id = $1 order by created_at'),
    ledger: await q('select id, log_id, kind, eligible_points, verified_points, effective_date, reason, created_at from ledger_entries where user_id = $1 order by id'),
    verificationSubmissions: await q('select id, log_id, task_id, status, decided_at, created_at from verification_submissions where user_id = $1'),
    evidence: await q('select id, kind, bytes, retention_expires_at, deleted_at from evidence_objects where user_id = $1'),
    appeals: await q('select id, submission_id, status, created_at from appeals where user_id = $1'),
  };
}
