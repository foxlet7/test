import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/auth';
import { PrismaService } from '../../common/prisma.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query('cursor') cursor?: string) {
    const take = 30;
    const rows = await this.prisma.notification.findMany({
      where: { userId: u.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const unread = await this.prisma.notification.count({ where: { userId: u.id, readAt: null } });
    return {
      items: rows.slice(0, take),
      nextCursor: rows.length > take ? rows[take - 1].id : null,
      unread,
    };
  }

  @Post(':id/read')
  async read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId: u.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  @Post('read-all')
  async readAll(@CurrentUser() u: AuthUser) {
    await this.prisma.notification.updateMany({
      where: { userId: u.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
