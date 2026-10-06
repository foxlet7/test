import { Global, Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';
import { SettingsService } from './settings.service';
import { CONFIG, loadConfig } from '../config/config';

@Global()
@Module({
  providers: [
    PrismaService,
    AuditService,
    SettingsService,
    AnalyticsService,
    { provide: CONFIG, useFactory: () => loadConfig() },
  ],
  exports: [PrismaService, AuditService, SettingsService, AnalyticsService, CONFIG],
})
export class CommonModule {}
