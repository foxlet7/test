# Tablya — homemade-food marketplace

A three-sided marketplace (customers, home cooks, administrators) built as an independent implementation inspired by the
public product concept of *Tablya: Homemade Food*. No code, assets or APIs from the original app are used.

| Part | Path | Stack |
|---|---|---|
| Domain package | `packages/shared` | TypeScript, Zod — order state machine, money/ledger maths, schedule, Arabic-aware search normaliser, validation, EN/AR strings |
| API | `apps/api` | NestJS 10, Prisma 6, PostgreSQL 16 (`pg_trgm`), Jest + Supertest |
| Admin console | `apps/admin` | Vite, React 19, TanStack Query, EN/AR + RTL |
| Mobile app | `apps/mobile` | Expo SDK 54, React Native 0.81, Expo Router, Zustand, TanStack Query, React Hook Form + Zod |
| Infra | `infrastructure/docker`, `.github/workflows` | Dockerfile, compose, CI |

**Status: feature-complete core, not yet launch-ready.** Read [Known limitations](docs/ARCHITECTURE.md#known-limitations) and
[STORE_RELEASE.md](docs/STORE_RELEASE.md) before shipping; real payment/email/SMS adapters and store credentials are required.

## Quick start

```bash
# prerequisites: Node >= 20, PostgreSQL 14+ (pg_trgm is a trusted extension)
npm install
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL, JWT_ACCESS_SECRET, DATA_ENC_KEY, PAYMENT_WEBHOOK_SECRET
npm run build:shared
cd apps/api && npx prisma migrate deploy && npm run seed     # demo data; refuses to run in production
npm run start:dev                                            # API on :3000, Swagger on /docs (non-production)
npm run dev -w @tablya/admin                                 # admin on :5173 (proxies /api -> :3000)
npm run web -w @tablya/mobile                                # or `npm start -w @tablya/mobile` for a device
```

Demo logins (password `DemoPassw0rd!`): `admin@tablya.test` (super admin), `support@tablya.test`, `moderator@tablya.test`,
`customer@tablya.test`, `cook.fatima@tablya.test`.

## Verify

```bash
npm run lint && npm run typecheck && npm test   # needs Postgres; the test DB is rebuilt from migrations on every run
```

Docs: [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Routes](docs/API_ROUTES.md) · [Database](docs/DATABASE.md) ·
[Security](docs/SECURITY.md) · [Privacy](docs/PRIVACY.md) · [Deployment](docs/DEPLOYMENT.md) · [Environment](docs/ENVIRONMENT.md) ·
[Testing](docs/TESTING.md) · [Store release](docs/STORE_RELEASE.md) · [Contributing](docs/CONTRIBUTING.md)
