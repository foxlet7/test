import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export const ANALYTICS_EVENTS = [
  'app_opened', 'search', 'kitchen_viewed', 'food_viewed', 'add_to_cart', 'checkout_started',
  'payment_started', 'order_created', 'order_completed', 'review_created', 'favorite_added',
] as const;

@Injectable()
export class AnalyticsService {
  private readonly log = new Logger('analytics');
  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget; analytics must never break a user flow. No PII in props. */
  track(name: string, userId?: string | null, props?: Record<string, string | number | boolean>) {
    this.prisma.analyticsEvent
      .create({ data: { name, userId: userId ?? null, props } })
      .catch((e) => this.log.warn(`track failed: ${(e as Error).message}`));
  }
}
