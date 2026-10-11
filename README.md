# Good Deeds Companion

Privacy-first app for adult Muslims and Christians to log good deeds, build gentle habits, track learning milestones and optionally join transparent community rankings. Points are a game mechanic — never a measure of faith or divine reward.

* `docs/AI_AGENT_BUILD_PROMPT.md` — the product spec this repo implements
* `docs/STATUS.md` — **what is built, what is stubbed, and human next steps (read first)**
* `docs/ARCHITECTURE.md`, `SCORING_SPEC.md`, `PRIVACY.md`, `DATA_INVENTORY.md`, `SECURITY.md`, `PILOT_PROTOCOL.md`, `RUNBOOK.md`, `DECISIONS.md`, `ACCESSIBILITY.md`, `STORE_LISTING.md`

## Quick start (development, no external services)
```bash
npm install
npm test                         # shared + API tests (embedded Postgres)
npm run seed:demo                # demo catalogue approved + demo staff + invite DEMO-INVITE (dev only)
npm run dev:api                  # http://localhost:8080  (embedded DB, data in memory unless PGLITE_DIR is set)
npm run dev:admin                # http://localhost:3001  (admin@demo.local / demo-password-123)
npm run dev:mobile              # Expo; set apps/mobile/app.json extra.apiUrl to your API (use your LAN IP on a device)
node tools/e2e-smoke.mjs         # end-to-end flow against a running API (needs seed:demo against the same DB)
```
Against real PostgreSQL: `TEST_PG_ADMIN_URL=postgres://user:pass@host/postgres npm test -w @gdc/api`.

> `seed:demo` approves placeholder content **for development only** and refuses to run in production. In real deployments use `seed:catalogue` (drafts) and let qualified reviewers approve content in the admin dashboard.
