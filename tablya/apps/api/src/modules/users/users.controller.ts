import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { addressSchema, phoneSchema } from '@tablya/shared';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../../common/auth';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { z$ } from '../../common/zod.pipe';
import { publicUser } from '../auth/auth.service';

const profileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  locale: z.enum(['en', 'ar']).optional(),
  phone: phoneSchema.nullable().optional(),
});
const prefSchema = z.object({ push: z.boolean().optional(), email: z.boolean().optional(), marketing: z.boolean().optional() });
const deviceSchema = z.object({ token: z.string().min(10).max(300), platform: z.enum(['ios', 'android']) });

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentUser() u: AuthUser) {
    return publicUser(await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } }));
  }

  @Patch()
  async update(@CurrentUser() u: AuthUser, @Body(z$(profileSchema)) b: z.infer<typeof profileSchema>) {
    if (b.phone) {
      const taken = await this.prisma.user.findFirst({ where: { phone: b.phone, NOT: { id: u.id } }, select: { id: true } });
      if (taken) throw new AppError('CONFLICT', 'This phone number is already in use.');
    }
    const cur = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const phoneChanged = b.phone !== undefined && b.phone !== cur.phone;
    const updated = await this.prisma.user.update({
      where: { id: u.id },
      data: { ...b, ...(phoneChanged ? { phoneVerifiedAt: null } : {}) },
    });
    return publicUser(updated);
  }

  // ── addresses ──
  @Get('addresses')
  addresses(@CurrentUser() u: AuthUser) {
    return this.prisma.address.findMany({ where: { userId: u.id, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
  }

  @Post('addresses')
  async addAddress(@CurrentUser() u: AuthUser, @Body(z$(addressSchema)) b: z.infer<typeof addressSchema>) {
    const count = await this.prisma.address.count({ where: { userId: u.id, deletedAt: null } });
    if (count >= 20) throw new AppError('CONFLICT', 'Address limit reached.');
    return this.prisma.$transaction(async (tx) => {
      const makeDefault = b.isDefault || count === 0;
      if (makeDefault) await tx.address.updateMany({ where: { userId: u.id }, data: { isDefault: false } });
      return tx.address.create({ data: { ...b, userId: u.id, isDefault: makeDefault } });
    });
  }

  @Put('addresses/:id')
  async editAddress(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(z$(addressSchema)) b: z.infer<typeof addressSchema>) {
    const a = await this.prisma.address.findFirst({ where: { id, userId: u.id, deletedAt: null } });
    if (!a) throw new AppError('NOT_FOUND', 'Address not found.');
    return this.prisma.$transaction(async (tx) => {
      if (b.isDefault) await tx.address.updateMany({ where: { userId: u.id }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: b });
    });
  }

  /** Soft delete: past orders keep their own address snapshot. */
  @Delete('addresses/:id')
  async delAddress(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.prisma.address.updateMany({ where: { id, userId: u.id, deletedAt: null }, data: { deletedAt: new Date(), isDefault: false } });
    if (!r.count) throw new AppError('NOT_FOUND', 'Address not found.');
    return { ok: true };
  }

  // ── devices & preferences ──
  @HttpCode(200) @Post('devices')
  async device(@CurrentUser() u: AuthUser, @Body(z$(deviceSchema)) b: z.infer<typeof deviceSchema>) {
    await this.prisma.deviceToken.upsert({ where: { token: b.token }, create: { ...b, userId: u.id }, update: { userId: u.id, platform: b.platform } });
    return { ok: true };
  }

  @Delete('devices/:token')
  async removeDevice(@CurrentUser() u: AuthUser, @Param('token') token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId: u.id } });
    return { ok: true };
  }

  @Get('preferences')
  async prefs(@CurrentUser() u: AuthUser) {
    return (await this.prisma.notificationPreference.findUnique({ where: { userId: u.id } })) ?? { push: true, email: true, marketing: false };
  }

  @Put('preferences')
  async setPrefs(@CurrentUser() u: AuthUser, @Body(z$(prefSchema)) b: z.infer<typeof prefSchema>) {
    return this.prisma.notificationPreference.upsert({ where: { userId: u.id }, create: { userId: u.id, ...b }, update: b });
  }
}
