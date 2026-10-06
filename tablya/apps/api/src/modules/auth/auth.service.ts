import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { RegisterInput } from '@tablya/shared';
import { AuditService } from '../../common/audit.service';
import { AuthUser, STAFF_ROLES, signAccess } from '../../common/auth';
import { decrypt, encrypt, newTotpSecret, numericCode, randomToken, sha256, verifyTotp } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { AppConfig, CONFIG } from '../../config/config';
import { NotificationsService } from '../notifications/notifications.service';

const ARGON: argon2.Options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  phone: u.phone,
  name: u.name,
  roles: u.roles,
  locale: u.locale,
  emailVerified: !!u.emailVerifiedAt,
  phoneVerified: !!u.phoneVerifiedAt,
  totpEnabled: u.totpEnabled,
});

@Injectable()
export class AuthService {
  // Pre-computed so that unknown-email logins cost the same as wrong-password ones.
  private dummyHash: Promise<string> = argon2.hash('dummy-password-for-timing', ARGON);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  async register(input: RegisterInput, meta: ClientMeta) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: input.email }, ...(input.phone ? [{ phone: input.phone }] : [])] },
      select: { id: true },
    });
    if (existing) throw new AppError('CONFLICT', 'An account with these details already exists.');
    const roles: Role[] = input.role === 'COOK' ? ['CUSTOMER', 'COOK'] : ['CUSTOMER'];
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        phone: input.phone,
        name: input.name,
        locale: input.locale,
        roles,
        passwordHash: await argon2.hash(input.password, ARGON),
        customerProfile: { create: {} },
        ...(input.role === 'COOK' ? { cookProfile: { create: {} } } : {}),
        notificationPref: { create: {} },
      },
    });
    await this.audit.log({ actorId: user.id, actorRole: roles[roles.length - 1], action: 'USER_CREATED', entityType: 'User', entityId: user.id, ip: meta.ip });
    return { user: publicUser(user), tokens: await this.startSession(user, meta) };
  }

  async login(email: string, password: string, totp: string | undefined, meta: ClientMeta) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const hash = user?.passwordHash ?? (await this.dummyHash);
    const passwordOk = await argon2.verify(hash, password).catch(() => false);

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('RATE_LIMITED', 'Too many failed attempts. Try again later.');
    }
    if (!user || !user.passwordHash || !passwordOk || user.status === 'DELETED') {
      if (user && user.status !== 'DELETED') {
        const failed = user.failedLogins + 1;
        await this.prisma.user.update({
          where: { id: user.id },
          data: failed >= MAX_FAILED
            ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
            : { failedLogins: failed },
        });
        if (failed >= MAX_FAILED) await this.audit.log({ actorId: user.id, action: 'ACCOUNT_LOCKED', entityType: 'User', entityId: user.id, ip: meta.ip });
      }
      throw new AppError('INVALID_CREDENTIALS', 'Incorrect email or password.');
    }
    if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.');

    const isStaff = user.roles.some((r) => STAFF_ROLES.includes(r));
    if (isStaff && this.cfg.REQUIRE_ADMIN_MFA && !user.totpEnabled) {
      throw new AppError('MFA_REQUIRED', 'Staff accounts must enable two-factor authentication.');
    }
    if (user.totpEnabled) {
      if (!totp) throw new AppError('MFA_REQUIRED', 'Enter your authenticator code.');
      if (!user.totpSecretEnc || !verifyTotp(decrypt(this.cfg.DATA_ENC_KEY, user.totpSecretEnc), totp)) {
        throw new AppError('INVALID_CREDENTIALS', 'Incorrect email, password or code.');
      }
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    if (isStaff) await this.audit.log({ actorId: user.id, action: 'STAFF_LOGIN', entityType: 'User', entityId: user.id, ip: meta.ip });
    return { user: publicUser(user), tokens: await this.startSession(user, meta) };
  }

  private async startSession(user: Pick<User, 'id' | 'roles'>, meta: ClientMeta, familyId: string = randomUUID()): Promise<Tokens> {
    const refreshToken = randomToken(48);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.cfg.REFRESH_TTL_DAYS * 86_400_000),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 200),
      },
    });
    return {
      accessToken: signAccess(this.cfg, { sub: user.id, roles: user.roles, sid: familyId }),
      refreshToken,
      expiresIn: this.cfg.ACCESS_TTL_SECONDS,
    };
  }

  /** Rotating refresh tokens with reuse detection: presenting a spent token revokes the whole family. */
  async refresh(token: string, meta: ClientMeta): Promise<Tokens> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!row) throw new AppError('UNAUTHENTICATED', 'Invalid refresh token.');
    if (row.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ actorId: row.userId, action: 'REFRESH_TOKEN_REUSE', entityType: 'User', entityId: row.userId, ip: meta.ip });
      throw new AppError('UNAUTHENTICATED', 'Session ended.');
    }
    if (row.expiresAt < new Date()) throw new AppError('TOKEN_EXPIRED', 'Session expired.');
    if (row.user.status !== 'ACTIVE') throw new AppError(row.user.status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'UNAUTHENTICATED', 'Account unavailable.');
    // Atomic claim: only one concurrent request can rotate this token.
    const claimed = await this.prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (claimed.count !== 1) throw new AppError('UNAUTHENTICATED', 'Session ended.');
    return this.startSession(row.user, meta, row.familyId);
  }

  async logout(sid: string | undefined, userId: string) {
    if (!sid) return;
    await this.prisma.refreshToken.updateMany({ where: { familyId: sid, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  // ── OTP flows ──
  private async issueOtp(target: string, purpose: 'PHONE_VERIFY' | 'EMAIL_VERIFY' | 'PASSWORD_RESET', userId?: string) {
    const recent = await this.prisma.otpCode.count({ where: { target, purpose, createdAt: { gt: new Date(Date.now() - 60_000) } } });
    if (recent > 0) throw new AppError('RATE_LIMITED', 'Please wait a minute before requesting another code.');
    const code = numericCode(6);
    await this.prisma.otpCode.create({
      data: { userId, target, purpose, codeHash: sha256(`${target}:${purpose}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000) },
    });
    return code;
  }

  private async consumeOtp(target: string, purpose: 'PHONE_VERIFY' | 'EMAIL_VERIFY' | 'PASSWORD_RESET', code: string) {
    const otp = await this.prisma.otpCode.findFirst({
      where: { target, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw new AppError('VALIDATION_FAILED', 'Invalid or expired code.');
    if (otp.codeHash !== sha256(`${target}:${purpose}:${code}`)) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new AppError('VALIDATION_FAILED', 'Invalid or expired code.');
    }
    const c = await this.prisma.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (c.count !== 1) throw new AppError('VALIDATION_FAILED', 'Invalid or expired code.');
    return otp;
  }

  async requestPhoneOtp(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.phone) throw new AppError('VALIDATION_FAILED', 'Add a phone number first.');
    const code = await this.issueOtp(u.phone, 'PHONE_VERIFY', u.id);
    await this.notifications.sendSms(u.phone, `Your Tablya code is ${code}`);
    return this.cfg.EXPOSE_DEV_OTP ? { devCode: code } : { sent: true };
  }

  async verifyPhoneOtp(user: AuthUser, code: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.phone) throw new AppError('VALIDATION_FAILED', 'Add a phone number first.');
    await this.consumeOtp(u.phone, 'PHONE_VERIFY', code);
    await this.prisma.user.update({ where: { id: u.id }, data: { phoneVerifiedAt: new Date() } });
    return { verified: true };
  }

  async requestEmailOtp(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.email) throw new AppError('VALIDATION_FAILED', 'No email on account.');
    const code = await this.issueOtp(u.email, 'EMAIL_VERIFY', u.id);
    await this.notifications.sendEmail(u.email, 'Verify your email', `Your Tablya code is ${code}`);
    return this.cfg.EXPOSE_DEV_OTP ? { devCode: code } : { sent: true };
  }

  async verifyEmailOtp(user: AuthUser, code: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.email) throw new AppError('VALIDATION_FAILED', 'No email on account.');
    await this.consumeOtp(u.email, 'EMAIL_VERIFY', code);
    await this.prisma.user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date() } });
    return { verified: true };
  }

  /** Always responds identically so account existence is not disclosed. */
  async forgotPassword(email: string) {
    const u = await this.prisma.user.findUnique({ where: { email } });
    if (u && u.status === 'ACTIVE') {
      try {
        const code = await this.issueOtp(email, 'PASSWORD_RESET', u.id);
        await this.notifications.sendEmail(email, 'Reset your password', `Your Tablya reset code is ${code}`);
        return this.cfg.EXPOSE_DEV_OTP ? { sent: true, devCode: code } : { sent: true };
      } catch (e) {
        if (!(e instanceof AppError)) throw e; // swallow per-target throttle to avoid enumeration
      }
    }
    return { sent: true };
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    const otp = await this.consumeOtp(email, 'PASSWORD_RESET', code);
    if (!otp.userId) throw new AppError('VALIDATION_FAILED', 'Invalid or expired code.');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: otp.userId }, data: { passwordHash: await argon2.hash(newPassword, ARGON), failedLogins: 0, lockedUntil: null } }),
      this.prisma.refreshToken.updateMany({ where: { userId: otp.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ actorId: otp.userId, action: 'PASSWORD_RESET', entityType: 'User', entityId: otp.userId });
    return { reset: true };
  }

  async changePassword(userId: string, current: string, next: string, keepSid?: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!u.passwordHash || !(await argon2.verify(u.passwordHash, current).catch(() => false))) {
      throw new AppError('INVALID_CREDENTIALS', 'Incorrect password.');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(next, ARGON) } });
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null, ...(keepSid ? { NOT: { familyId: keepSid } } : {}) }, data: { revokedAt: new Date() } });
  }

  // ── TOTP (staff MFA) ──
  async totpEnroll(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (u.totpEnabled) throw new AppError('CONFLICT', 'Two-factor authentication is already enabled.');
    const secret = newTotpSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecretEnc: encrypt(this.cfg.DATA_ENC_KEY, secret) } });
    return { secret, otpauthUrl: `otpauth://totp/Tablya:${encodeURIComponent(u.email ?? u.id)}?secret=${secret}&issuer=Tablya` };
  }

  async totpActivate(userId: string, code: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!u.totpSecretEnc) throw new AppError('VALIDATION_FAILED', 'Start enrollment first.');
    if (!verifyTotp(decrypt(this.cfg.DATA_ENC_KEY, u.totpSecretEnc), code)) throw new AppError('VALIDATION_FAILED', 'Invalid code.');
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
    await this.audit.log({ actorId: userId, action: 'MFA_ENABLED', entityType: 'User', entityId: userId });
    return { enabled: true };
  }

  // ── Account deletion (store requirement) ──
  /**
   * Anonymises the account. Orders, payments and ledger rows are retained for
   * legal/financial audit but no longer reference personal data.
   */
  async deleteAccount(userId: string, password: string, meta: ClientMeta) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { kitchens: { select: { id: true } } } });
    if (!u.passwordHash || !(await argon2.verify(u.passwordHash, password).catch(() => false))) {
      throw new AppError('INVALID_CREDENTIALS', 'Incorrect password.');
    }
    const kitchenIds = u.kitchens.map((k) => k.id);
    const openStatuses = ['PENDING_PAYMENT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'REFUND_PENDING'] as const;
    const open = await this.prisma.order.count({
      where: { status: { in: [...openStatuses] }, OR: [{ customerId: userId }, ...(kitchenIds.length ? [{ kitchenId: { in: kitchenIds } }] : [])] },
    });
    if (open > 0) throw new AppError('CONFLICT', 'You have orders in progress. Complete or cancel them before deleting your account.');

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: null, phone: null, passwordHash: null, name: 'Deleted user', status: 'DELETED', deletedAt: new Date(),
          totpSecretEnc: null, totpEnabled: false, roles: ['CUSTOMER'],
        },
      });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.address.deleteMany({ where: { userId } });
      await tx.deviceToken.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.favorite.deleteMany({ where: { userId } });
      await tx.cart.deleteMany({ where: { customerId: userId } });
      await tx.otpCode.deleteMany({ where: { userId } });
      await tx.customerProfile.deleteMany({ where: { userId } });
      await tx.cookProfile.deleteMany({ where: { userId } });
      await tx.analyticsEvent.updateMany({ where: { userId }, data: { userId: null } });
      await tx.order.updateMany({ where: { customerId: userId }, data: { addressSnapshot: Prisma.DbNull, note: null } });
      await tx.review.updateMany({ where: { customerId: userId }, data: { imageKeys: [] } });
      if (kitchenIds.length) {
        await tx.kitchen.updateMany({ where: { id: { in: kitchenIds } }, data: { deletedAt: new Date(), verification: 'SUSPENDED', acceptingOrders: false } });
        await tx.menuItem.updateMany({ where: { kitchenId: { in: kitchenIds } }, data: { isAvailable: false } });
      }
    });
    await this.audit.log({ actorId: userId, action: 'ACCOUNT_DELETED', entityType: 'User', entityId: userId, ip: meta.ip });
  }
}
