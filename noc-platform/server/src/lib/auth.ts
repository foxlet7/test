import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role, User } from '@prisma/client';
import { db } from './db';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const COOKIE = 'noc_session';
const SESSION_DAYS = 14;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const want = Buffer.from(k, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), want.length);
  return timingSafeEqual(got, want);
}

export async function startSession(userId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.session.create({ data: { id: sha256(token), userId, expiresAt } });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', expires: expiresAt,
    secure: process.env.COOKIE_SECURE === '1',
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: sha256(token) } });
  jar.delete(COOKIE);
}

export type SessionUser = Pick<User, 'id' | 'tenantId' | 'email' | 'name' | 'role'>;

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({
    where: { id: sha256(token) },
    include: { user: { select: { id: true, tenantId: true, email: true, name: true, role: true } } },
  });
  if (!s || s.expiresAt < new Date()) return null;
  return s.user;
}

const LEVEL: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 };

// Pages: send to /login (or /setup on a fresh install). Mutations: throw.
export async function requireUser(min: Role = 'VIEWER'): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) {
    if ((await db.user.count()) === 0) redirect('/setup');
    redirect('/login');
  }
  if (LEVEL[u.role] < LEVEL[min]) throw new Error('Not allowed for role ' + u.role);
  return u;
}

export const can = (u: SessionUser, min: Role) => LEVEL[u.role] >= LEVEL[min];

// Probes authenticate with "Authorization: Bearer <token>".
export async function probeFromRequest(req: Request) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) return null;
  return db.probe.findUnique({ where: { tokenHash: sha256(token) } });
}

// Login throttling: 5 failed attempts per email and 20 per source address per 15 minutes.
// In memory, so it resets on restart and is per server instance; enough to stop password guessing
// against a single install. A shared store is needed once the server runs as several replicas.
const WINDOW_MS = 15 * 60e3;
const fails = new Map<string, number[]>();
function recent(key: string) {
  const now = Date.now();
  const list = (fails.get(key) || []).filter((t) => now - t < WINDOW_MS);
  fails.set(key, list);
  return list;
}
export function loginBlocked(email: string, ip: string): boolean {
  return recent('e:' + email).length >= 5 || recent('i:' + ip).length >= 20;
}
export function loginFailed(email: string, ip: string) {
  recent('e:' + email).push(Date.now());
  recent('i:' + ip).push(Date.now());
  if (fails.size > 10000) fails.clear(); // bound memory under a spray attack
}
export function loginSucceeded(email: string) { fails.delete('e:' + email); }
