import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Inject } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { AppError } from './errors';
import { AuthedRequest } from './filters';
import { PrismaService } from './prisma.service';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const ROLES_KEY = 'roles';
/** Caller must hold at least one of these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const STAFF_ROLES: Role[] = ['SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];
export const ADMIN_ROLES: Role[] = ['ADMIN', 'SUPER_ADMIN'];
export const COOK_ROLES: Role[] = ['COOK', 'KITCHEN_MANAGER'];

export interface AuthUser {
  id: string;
  roles: Role[];
  sid?: string;
}

export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user as AuthUser;
});

export interface AccessClaims {
  sub: string;
  roles: Role[];
  sid: string;
}

export function signAccess(cfg: AppConfig, claims: AccessClaims): string {
  return jwt.sign(claims, cfg.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: cfg.ACCESS_TTL_SECONDS,
    issuer: 'tablya',
  });
}

/**
 * Global guard: every route requires a valid access token unless @Public().
 * User status is re-read from the DB so suspension/deletion takes effect immediately
 * (not after token expiry).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      if (isPublic) return true;
      throw new AppError('UNAUTHENTICATED', 'Authentication required.');
    }

    let claims: AccessClaims;
    try {
      claims = jwt.verify(token, this.cfg.JWT_ACCESS_SECRET, {
        algorithms: ['HS256'],
        issuer: 'tablya',
      }) as unknown as AccessClaims;
    } catch (e) {
      if (isPublic) return true;
      const expired = (e as Error).name === 'TokenExpiredError';
      throw new AppError(
        expired ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED',
        expired ? 'Session expired.' : 'Invalid token.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, roles: true, status: true },
    });
    if (!user || user.status === 'DELETED') {
      if (isPublic) return true;
      throw new AppError('UNAUTHENTICATED', 'Invalid token.');
    }
    if (user.status === 'SUSPENDED') {
      if (isPublic) return true;
      throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.');
    }
    // The session itself must still be live (logout / revoke-all).
    const session = await this.prisma.refreshToken.findFirst({
      where: {
        familyId: claims.sid,
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!session) {
      if (isPublic) return true;
      throw new AppError('UNAUTHENTICATED', 'Session ended.');
    }
    req.user = { id: user.id, roles: user.roles, sid: claims.sid };
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const roles = (req.user?.roles ?? []) as Role[];
    // SUPER_ADMIN implies ADMIN
    const effective = roles.includes('SUPER_ADMIN') ? [...roles, 'ADMIN' as Role] : roles;
    if (!required.some((r) => effective.includes(r))) {
      throw new AppError('FORBIDDEN', 'You are not allowed to perform this action.');
    }
    return true;
  }
}

export const hasRole = (user: AuthUser, ...roles: Role[]) =>
  user.roles.some((r) => roles.includes(r));
