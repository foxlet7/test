import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/auth';
import { PrismaService } from '../../common/prisma.service';

@ApiTags('ops')
@Public()
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. */
  @Get('health')
  health() {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  /** Readiness: dependencies are reachable (load balancers should gate traffic on this). */
  @Get('readiness')
  async readiness(@Res({ passthrough: true }) res: Response) {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', checks: { database: { ok: true, ms: Date.now() - started } } };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'unavailable', checks: { database: { ok: false } } };
    }
  }
}
