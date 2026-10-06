import { Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { PrismaService } from './prisma.service';

export interface PlatformSettings {
  currency: string;
  taxBps: number;
  serviceFeeBps: number;
  defaultCommissionBps: number;
}

/** Runtime-editable platform settings: DB overrides fall back to env defaults. */
@Injectable()
export class SettingsService {
  private cache: { at: number; value: PlatformSettings } | null = null;
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  async get(): Promise<PlatformSettings> {
    if (this.cache && Date.now() - this.cache.at < 10_000) return this.cache.value;
    const rows = await this.prisma.setting.findMany();
    const o = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const value: PlatformSettings = {
      currency: this.cfg.CURRENCY,
      taxBps: (o.taxBps as number) ?? this.cfg.TAX_BPS,
      serviceFeeBps: (o.serviceFeeBps as number) ?? this.cfg.SERVICE_FEE_BPS,
      defaultCommissionBps: (o.defaultCommissionBps as number) ?? this.cfg.DEFAULT_COMMISSION_BPS,
    };
    this.cache = { at: Date.now(), value };
    return value;
  }

  async set(key: keyof PlatformSettings, value: number) {
    await this.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    this.cache = null;
  }
  invalidate() {
    this.cache = null;
  }
}
