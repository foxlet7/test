# Environment

Three environments: `development`, `staging`, `production` (+ `test` used by Jest). Configuration is environment variables only, validated at boot by `apps/api/src/config/config.ts` (Zod; the process refuses to start on invalid or unsafe values). Template: `apps/api/.env.example`. **Never commit real secrets.**

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres URL. Use a least-privilege app role; run migrations with a separate owner role. |
| `JWT_ACCESS_SECRET` | ≥ 32 chars, unique per environment (`openssl rand -base64 48`). Rotating it logs everyone out. |
| `DATA_ENC_KEY` | 32 bytes base64 (`openssl rand -base64 32`). **Losing it makes enrolled TOTP secrets unrecoverable** — back up in your secret manager. |
| `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET` | `sandbox` is dev-only and **rejected in production**. |
| `MESSAGE_PROVIDER` | `console` is dev-only and rejected in production. |
| `REQUIRE_ADMIN_MFA` | must be `true` in production. |
| `EXPOSE_DEV_OTP` | returns OTP codes in responses; must be `false` in production. |
| `CURRENCY`, `TAX_BPS`, `SERVICE_FEE_BPS`, `DEFAULT_COMMISSION_BPS` | defaults; tax/fee/commission can be overridden at runtime by a super admin (audited). |
| `CORS_ORIGINS` | comma-separated admin origins; empty = no browser origins (mobile apps do not need CORS). |
| `STORAGE_DIR`, `PUBLIC_BASE_URL` | local-disk storage adapter and public URL prefix for images. Use object storage + CDN in production. |
| `UNPAID_ORDER_TTL_MINUTES`, `COOK_ACCEPT_TTL_MINUTES`, `AUTO_COMPLETE_HOURS` | order automation. |
| `THROTTLE_LIMIT`, `AUTH_THROTTLE_LIMIT` | per-IP per-minute limits. |
| `EXPO_PUSH_ENABLED` | enable Expo push delivery (needs EAS credentials). |
| Mobile: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_SUPPORT_URL` | public by design; set per EAS build profile (`apps/mobile/eas.json`). |
| Admin: `VITE_API_URL` | API base URL at build time. |
