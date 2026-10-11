# Contributing

* Branch from `main`; small PRs; CI must be green (`npm run lint && npm run typecheck && npm test`).
* TypeScript strict everywhere; no new `any` without a reason; Prettier + ESLint enforced.
* **Domain rules go in `packages/shared`** (with unit tests), not duplicated in clients.
* New endpoint checklist: Zod validation · explicit auth (`@Public()` or `@Roles`) · ownership check in the query · audit log if it changes money/permissions/catalogue · idempotency key if it creates money/orders · integration test including the *forbidden* case.
* Schema change = new migration (`prisma migrate dev --name …`) + update `docs/DATABASE.md` if it changes invariants. Never edit applied migrations.
* All user-facing strings go through i18n (EN + AR); run `npm run check:i18n -w @tablya/mobile`.
* Never log secrets, tokens, passwords or request bodies. Never commit `.env`.
* Regenerate `docs/API_ROUTES.md` when routes change: `npx ts-node apps/api/scripts/routes.ts`.
