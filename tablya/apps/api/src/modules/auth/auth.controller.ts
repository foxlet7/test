import { Body, Controller, Delete, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { loginSchema, passwordSchema, registerSchema } from '@tablya/shared';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../../common/auth';
import { AuthedRequest } from '../../common/filters';
import { z$ } from '../../common/zod.pipe';
import { AuthService } from './auth.service';

const meta = (req: AuthedRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
const code6 = z.object({ code: z.string().regex(/^\d{6}$/) });
/** Resolved per request so the limit follows configuration instead of import-time env. */
const authLimit = () => ({ default: { limit: () => Number(process.env.AUTH_THROTTLE_LIMIT ?? 10), ttl: 60_000 } });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Throttle(authLimit()) @Post('register')
  register(@Body(z$(registerSchema)) body: z.infer<typeof registerSchema>, @Req() req: AuthedRequest) {
    return this.auth.register(body, meta(req));
  }

  @Public() @Throttle(authLimit()) @HttpCode(200) @Post('login')
  login(@Body(z$(loginSchema)) b: z.infer<typeof loginSchema>, @Req() req: AuthedRequest) {
    return this.auth.login(b.email, b.password, b.totp, meta(req));
  }

  @Public() @Throttle(authLimit()) @HttpCode(200) @Post('refresh')
  refresh(@Body(z$(z.object({ refreshToken: z.string().min(20).max(200) }))) b: { refreshToken: string }, @Req() req: AuthedRequest) {
    return this.auth.refresh(b.refreshToken, meta(req));
  }

  @ApiBearerAuth() @HttpCode(200) @Post('logout')
  async logout(@CurrentUser() u: AuthUser) {
    await this.auth.logout(u.sid, u.id);
    return { ok: true };
  }

  @ApiBearerAuth() @HttpCode(200) @Post('logout-all')
  async logoutAll(@CurrentUser() u: AuthUser) {
    await this.auth.logoutAll(u.id);
    return { ok: true };
  }

  @Public() @Throttle(authLimit()) @HttpCode(200) @Post('forgot-password')
  forgot(@Body(z$(z.object({ email: z.string().email().transform((e) => e.toLowerCase()) }))) b: { email: string }) {
    return this.auth.forgotPassword(b.email);
  }

  @Public() @Throttle(authLimit()) @HttpCode(200) @Post('reset-password')
  reset(@Body(z$(z.object({ email: z.string().email().transform((e) => e.toLowerCase()), code: z.string().regex(/^\d{6}$/), newPassword: passwordSchema }))) b: { email: string; code: string; newPassword: string }) {
    return this.auth.resetPassword(b.email, b.code, b.newPassword);
  }

  @ApiBearerAuth() @HttpCode(200) @Post('change-password')
  async change(@CurrentUser() u: AuthUser, @Body(z$(z.object({ currentPassword: z.string(), newPassword: passwordSchema }))) b: { currentPassword: string; newPassword: string }) {
    await this.auth.changePassword(u.id, b.currentPassword, b.newPassword, u.sid);
    return { ok: true };
  }

  @ApiBearerAuth() @Throttle(authLimit()) @HttpCode(200) @Post('phone/request-otp')
  phoneReq(@CurrentUser() u: AuthUser) { return this.auth.requestPhoneOtp(u); }

  @ApiBearerAuth() @Throttle(authLimit()) @HttpCode(200) @Post('phone/verify')
  phoneVerify(@CurrentUser() u: AuthUser, @Body(z$(code6)) b: { code: string }) { return this.auth.verifyPhoneOtp(u, b.code); }

  @ApiBearerAuth() @Throttle(authLimit()) @HttpCode(200) @Post('email/request-otp')
  emailReq(@CurrentUser() u: AuthUser) { return this.auth.requestEmailOtp(u); }

  @ApiBearerAuth() @Throttle(authLimit()) @HttpCode(200) @Post('email/verify')
  emailVerify(@CurrentUser() u: AuthUser, @Body(z$(code6)) b: { code: string }) { return this.auth.verifyEmailOtp(u, b.code); }

  @ApiBearerAuth() @HttpCode(200) @Post('totp/enroll')
  totpEnroll(@CurrentUser() u: AuthUser) { return this.auth.totpEnroll(u.id); }

  @ApiBearerAuth() @Throttle(authLimit()) @HttpCode(200) @Post('totp/activate')
  totpActivate(@CurrentUser() u: AuthUser, @Body(z$(code6)) b: { code: string }) { return this.auth.totpActivate(u.id, b.code); }

  /** Account deletion (App Store 5.1.1(v) / Play requirement). */
  @ApiBearerAuth() @Throttle(authLimit()) @Delete('account')
  async deleteAccount(@CurrentUser() u: AuthUser, @Body(z$(z.object({ password: z.string().min(1) }))) b: { password: string }, @Req() req: AuthedRequest) {
    await this.auth.deleteAccount(u.id, b.password, meta(req));
    return { deleted: true };
  }
}
