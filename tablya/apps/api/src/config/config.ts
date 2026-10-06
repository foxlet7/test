import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  /** 32-byte key, base64, used to encrypt TOTP secrets at rest. */
  DATA_ENC_KEY: z.string().min(1),
  CORS_ORIGINS: z.string().default(''),
  CURRENCY: z.string().length(3).default('SAR'),
  TAX_BPS: z.coerce.number().int().min(0).max(5000).default(1500),
  SERVICE_FEE_BPS: z.coerce.number().int().min(0).max(5000).default(0),
  DEFAULT_COMMISSION_BPS: z.coerce.number().int().min(0).max(5000).default(1500),
  PAYMENT_PROVIDER: z.enum(['sandbox']).default('sandbox'),
  MESSAGE_PROVIDER: z.enum(['console']).default('console'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  /** Admin/staff must have TOTP enabled to log in. */
  REQUIRE_ADMIN_MFA: z.coerce.boolean().default(false),
  STORAGE_DIR: z.string().default('./uploads'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  UNPAID_ORDER_TTL_MINUTES: z.coerce.number().default(15),
  COOK_ACCEPT_TTL_MINUTES: z.coerce.number().default(15),
  AUTO_COMPLETE_HOURS: z.coerce.number().default(24),
  EXPO_PUSH_ENABLED: z.coerce.boolean().default(false),
  THROTTLE_LIMIT: z.coerce.number().default(120),
  AUTH_THROTTLE_LIMIT: z.coerce.number().default(10),
  /** Dev only: return OTP codes in responses. Rejected in production. */
  EXPOSE_DEV_OTP: z.coerce.boolean().default(false),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production') {
    if (cfg.EXPOSE_DEV_OTP) throw new Error('EXPOSE_DEV_OTP must be false in production');
    if (cfg.PAYMENT_PROVIDER === 'sandbox')
      throw new Error('PAYMENT_PROVIDER=sandbox is development-only; configure a real provider adapter');
    if (cfg.MESSAGE_PROVIDER === 'console')
      throw new Error('MESSAGE_PROVIDER=console is development-only; configure real email/SMS adapters');
    if (!cfg.REQUIRE_ADMIN_MFA) throw new Error('REQUIRE_ADMIN_MFA must be true in production');
  }
  if (Buffer.from(cfg.DATA_ENC_KEY, 'base64').length !== 32)
    throw new Error('DATA_ENC_KEY must be 32 bytes, base64 encoded');
  return cfg;
}

export const CONFIG = Symbol('CONFIG');
