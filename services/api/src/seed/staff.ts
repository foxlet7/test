import type { Role } from '@gdc/shared';
import { hashPassword } from '../auth';
import type { Db } from '../db';

export async function createStaff(db: Db, email: string, password: string, pseudonym: string, roles: Role[]): Promise<string> {
  const existing = await db.query<{ id: string }>('select id from users where lower(email) = lower($1)', [email]);
  let id = existing.rows[0]?.id;
  if (!id) {
    const u = await db.query<{ id: string }>('insert into users(email, password_hash) values ($1,$2) returning id', [email.toLowerCase(), await hashPassword(password)]);
    id = u.rows[0]!.id;
    await db.query('insert into profiles(user_id, pseudonym, adult_confirmed_at) values ($1,$2,now())', [id, pseudonym]);
    await db.query("insert into consents(user_id, type, version) values ($1,'account','v1')", [id]);
  }
  await db.query('delete from user_roles where user_id = $1', [id]);
  for (const r of roles) await db.query('insert into user_roles(user_id, role) values ($1,$2)', [id, r]);
  return id;
}
