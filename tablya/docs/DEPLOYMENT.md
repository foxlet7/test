# Deployment

## Topology (recommended)
Load balancer (TLS) → API containers (stateless) → managed PostgreSQL with automated backups + PITR; object storage + CDN for images; admin console as static files behind the same CDN; secrets from a secret manager.

## Release steps
1. CI green (`.github/workflows/ci.yml`: lint, typecheck, tests against Postgres, build, `npm audit`, secret scan).
2. Build image: `docker build -f infrastructure/docker/api.Dockerfile -t tablya-api .`
3. **Migrate first**, as a release step with the owner role: `npx prisma migrate deploy` (migrations are additive/forward-only; take a snapshot before). Do not run migrations on container start.
4. Roll the API containers. Health: `GET /health` (liveness), `GET /readiness` (DB reachable → 503 otherwise). Gate traffic on readiness.
5. Admin: `npm run build -w @tablya/admin` → upload `apps/admin/dist` to static hosting.
6. Promotion to production is a **manual gate** (protected environment/approval); the pipeline never auto-deploys.

## Production checklist
- [ ] Real `PaymentProvider`, `MessageProvider`, `StorageProvider` implemented and registered; webhook endpoint configured at the gateway
- [ ] `NODE_ENV=production`, `REQUIRE_ADMIN_MFA=true`, secrets generated per environment, `DATA_ENC_KEY` backed up
- [ ] First super admin created out-of-band (SQL/CLI), then enrol MFA on first login
- [ ] DB backups + restore drill; separate staging database
- [ ] Redis (or equivalent) for throttling if running >1 replica; scheduler on one instance
- [ ] Error tracking (Sentry/Datadog) and log shipping hooked to the structured JSON logs; alerts on `/readiness`, 5xx rate, webhook problems (`/admin/webhooks?problemsOnly=true`), `REFUND_PENDING` age
- [ ] Rate limits and `trust proxy` verified behind your load balancer
- [ ] Retention jobs for verification documents decided and scheduled
- [ ] Penetration test, privacy policy/terms published

## Observability that exists today
Structured request/error logs with request id · health/readiness · admin dashboard (DB status, webhook problems, pending refunds, open reports) · audit log · `WebhookEvent` table. External APM/error tracking is **not** wired (needs your vendor DSN).
