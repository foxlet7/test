import { Injectable } from '@nestjs/common';
import { AuthUser, hasRole } from '../../common/auth';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';

/** Ownership checks. Returns 404 (not 403) for other people's kitchens so ids cannot be probed. */
@Injectable()
export class KitchenAccess {
  constructor(private readonly prisma: PrismaService) {}

  async assertOwner(user: AuthUser, kitchenId: string) {
    const k = await this.prisma.kitchen.findFirst({ where: { id: kitchenId, deletedAt: null, ...(hasRole(user, 'ADMIN', 'SUPER_ADMIN') ? {} : { ownerId: user.id }) } });
    if (!k) throw new AppError('NOT_FOUND', 'Kitchen not found.');
    return k;
  }

  async ownedIds(userId: string): Promise<string[]> {
    return (await this.prisma.kitchen.findMany({ where: { ownerId: userId, deletedAt: null }, select: { id: true } })).map((k) => k.id);
  }
}
