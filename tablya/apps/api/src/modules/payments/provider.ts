import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hmacHex, safeEqual } from '../../common/crypto';
import { AppConfig, CONFIG } from '../../config/config';

export interface InitiateParams {
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
}
export interface InitiateResult {
  providerRef: string;
  /** Opaque data the mobile SDK / hosted page needs to complete payment. Contains no server secrets. */
  clientSession: Record<string, string>;
}
export interface RefundParams {
  providerRef: string;
  amountMinor: number;
  idempotencyKey: string;
}
export interface RefundResult {
  providerRef: string;
  status: 'succeeded' | 'pending' | 'failed';
}
export type ProviderEventType = 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'refund.failed';
export interface ProviderEvent {
  id: string;
  type: ProviderEventType;
  providerRef: string;
  amountMinor?: number;
  reason?: string;
}

/**
 * Payment provider port. The domain code only talks to this interface so a real gateway
 * (Stripe, HyperPay, Moyasar, Tap, ...) can be added by implementing it and registering it in PaymentsModule.
 */
export abstract class PaymentProvider {
  abstract readonly name: string;
  abstract initiate(p: InitiateParams): Promise<InitiateResult>;
  abstract refund(p: RefundParams): Promise<RefundResult>;
  /** Must authenticate the payload (signature) and return null when it is not authentic. */
  abstract parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderEvent | null;
}

/**
 * Development/test provider. It behaves like a gateway that settles asynchronously via signed webhooks,
 * so the whole webhook path (signature, idempotency, retries) is exercised exactly as in production.
 * Refused at startup when NODE_ENV=production.
 */
@Injectable()
export class SandboxPaymentProvider extends PaymentProvider {
  readonly name = 'sandbox';
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    super();
  }

  async initiate(p: InitiateParams): Promise<InitiateResult> {
    return { providerRef: `sbx_${randomUUID()}`, clientSession: { providerRef: '', mode: 'sandbox', amountMinor: String(p.amountMinor), currency: p.currency } };
  }

  async refund(p: RefundParams): Promise<RefundResult> {
    return { providerRef: `sbx_re_${p.idempotencyKey.slice(0, 24)}`, status: 'succeeded' };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderEvent | null {
    const sig = headers['x-tablya-signature'];
    if (typeof sig !== 'string' || !safeEqual(sig, hmacHex(this.cfg.PAYMENT_WEBHOOK_SECRET, rawBody))) return null;
    try {
      const e = JSON.parse(rawBody.toString('utf8'));
      if (typeof e.id !== 'string' || typeof e.type !== 'string' || typeof e.providerRef !== 'string') return null;
      return e as ProviderEvent;
    } catch {
      return null;
    }
  }

  /** Build a correctly signed webhook body (used by the dev completion endpoint and tests). */
  sign(event: ProviderEvent): { body: string; signature: string } {
    const body = JSON.stringify(event);
    return { body, signature: hmacHex(this.cfg.PAYMENT_WEBHOOK_SECRET, body) };
  }
}
