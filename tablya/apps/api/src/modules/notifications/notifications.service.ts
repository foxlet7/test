import { Inject, Injectable, Logger } from '@nestjs/common';
import { Locale, t } from '@tablya/shared';
import { AppConfig, CONFIG } from '../../config/config';
import { PrismaService } from '../../common/prisma.service';

/** Outbound email/SMS abstraction. Swap the implementation per environment. */
export abstract class MessageProvider {
  abstract sendEmail(to: string, subject: string, body: string): Promise<void>;
  abstract sendSms(to: string, body: string): Promise<void>;
}

/** Development-only provider. Never registered in production (see loadConfig). */
@Injectable()
export class ConsoleMessageProvider extends MessageProvider {
  private readonly log = new Logger('messages');
  async sendEmail(to: string, subject: string, body: string) {
    this.log.log(`[dev email] to=${to.replace(/(.{2}).*(@.*)/, '$1***$2')} subject="${subject}" body="${body}"`);
  }
  async sendSms(to: string, body: string) {
    this.log.log(`[dev sms] to=${to.slice(0, 5)}*** body="${body}"`);
  }
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger('notifications');
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly messages: MessageProvider,
  ) {}

  /** In-app row (always) + push (if enabled & device registered & preference allows). Never throws. */
  async notify(userId: string, type: string, titleKey: string, vars: Record<string, string | number> = {}, data?: Record<string, string>) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { locale: true, status: true, notificationPref: true },
      });
      if (!user || user.status !== 'ACTIVE') return;
      const locale = (user.locale === 'ar' ? 'ar' : 'en') as Locale;
      const title = t(locale, titleKey, vars);
      await this.prisma.notification.create({ data: { userId, type, titleKey, title, data } });
      if (this.cfg.EXPO_PUSH_ENABLED && (user.notificationPref?.push ?? true)) {
        const tokens = await this.prisma.deviceToken.findMany({ where: { userId }, select: { token: true } });
        if (tokens.length) await this.sendExpoPush(tokens.map((x) => x.token), title, data);
      }
    } catch (e) {
      this.log.warn(`notify failed: ${(e as Error).message}`);
    }
  }

  private async sendExpoPush(tokens: string[], title: string, data?: Record<string, string>) {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title, data, sound: 'default' }))),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) this.log.warn(`expo push http ${res.status}`);
  }

  sendEmail(to: string, subject: string, body: string) {
    return this.messages.sendEmail(to, subject, body);
  }
  sendSms(to: string, body: string) {
    return this.messages.sendSms(to, body);
  }
}
