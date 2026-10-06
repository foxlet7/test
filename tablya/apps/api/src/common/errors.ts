import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@tablya/shared';

const STATUS: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  MFA_REQUIRED: 401,
  FORBIDDEN: 403,
  ACCOUNT_SUSPENDED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  ILLEGAL_TRANSITION: 409,
  PRICE_CHANGED: 409,
  KITCHEN_UNAVAILABLE: 409,
  ITEM_UNAVAILABLE: 409,
  MIN_ORDER_NOT_MET: 422,
  OUT_OF_DELIVERY_ZONE: 422,
  CART_EMPTY: 422,
  CART_MIXED_KITCHENS: 409,
  COUPON_INVALID: 422,
  PAYMENT_FAILED: 402,
  REVIEW_NOT_ELIGIBLE: 422,
  UPLOAD_REJECTED: 415,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, STATUS[code] ?? 400);
  }
}
