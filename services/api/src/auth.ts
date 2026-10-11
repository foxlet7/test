import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@gdc/shared';
import { forbidden, unauthorized } from './errors';
import type { Db } from './db';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 16384;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !salt || !hash) return false;
  const key = await scrypt(pw, Buffer.from(salt, 'base64'), 32, { N: Number(n), r: 8, p: 1 });
  const expected = Buffer.from(hash, 'base64');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url');

export interface AuthUser {
  id: string;
  roles: Role[];
}

export function signAccess(secret: string, user: AuthUser): string {
  return jwt.sign({ roles: user.roles }, secret, { subject: user.id, expiresIn: '15m', algorithm: 'HS256' });
}

export function verifyAccess(secret: string, token: string): AuthUser {
  try {
    const p = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    return { id: String(p.sub), roles: (p.roles as Role[]) ?? [] };
  } catch {
    throw unauthorized('invalid_token');
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Roles and account status are re-read from the database on every request, so suspensions and role changes apply immediately. */
export function makeAuthHook(secret: string, db: Db) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw unauthorized();
    const claims = verifyAccess(secret, h.slice(7));
    const u = await db.query<{ status: string }>('select status from users where id = $1', [claims.id]);
    if (u.rows[0]?.status !== 'active') throw unauthorized('account_unavailable');
    const roles = await db.query<{ role: Role }>('select role from user_roles where user_id = $1', [claims.id]);
    req.user = { id: claims.id, roles: roles.rows.map((r) => r.role) };
  };
}

export function requireRoles(...allowed: Role[]) {
  return async (req: FastifyRequest) => {
    const u = req.user;
    if (!u) throw unauthorized();
    if (u.roles.includes('super_admin')) return;
    if (!u.roles.some((r) => allowed.includes(r))) throw forbidden('insufficient_role');
  };
}

export const STAFF_ROLES: Role[] = [
  'super_admin', 'content_admin', 'islamic_reviewer', 'christian_reviewer',
  'translation_reviewer', 'verification_reviewer', 'moderator', 'auditor',
];
