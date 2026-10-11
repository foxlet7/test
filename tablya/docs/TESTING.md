# Testing

```bash
npm test          # shared unit tests + API integration tests (in band) + i18n parity
npm run lint && npm run typecheck
```
Requires Postgres. `apps/api/test/global-setup.ts` drops/recreates the test schema and runs **all migrations from scratch** on every run (set `TEST_DATABASE_URL` to override).

## Current results (this commit)
* `packages/shared`: **17** unit tests — state machine (incl. reachability), pricing/coupon/settlement invariants, schedule (midnight crossing), Arabic normalisation, validation.
* `apps/api`: **75** integration tests (real HTTP + real Postgres), 4 suites:
  * `auth` — registration, hashing, lockout, token expiry/tampering, refresh rotation + reuse + concurrency, logout, password reset, OTP limits, suspension, account deletion/anonymisation, TOTP, mandatory-MFA bootstrap, error envelope, health.
  * `commerce` — server pricing, option rules, zones, min order, stale price, price edit race, closed kitchen/unavailable item, **idempotent concurrent orders**, **oversell race**, stock restore, signed webhooks (duplicate/concurrent/forged/amount mismatch), failed→retry payment, late payment auto-refund, reconciler, full lifecycle + ledger reconciliation, COD ledger, reject/cancel refunds, auto-complete, refund idempotency/partial/over-refund, DB-level immutability and transition guards.
  * `access` — customer/cook/admin boundaries, IDOR on orders/kitchens/menus/addresses/cart/uploads, role scoping inside staff, self-suspend/escalation rules, audit, validation, SQLi probes, headers, rate limiting, upload attacks (disguised scripts, SVG, polyglot, corrupt, tiny, oversize, traversal, private docs).
  * `journey` — the spec's full E2E flow (register → browse → search → kitchen → cart → checkout → pay → cook fulfils → complete → review) plus search (Arabic/typos), availability states, reviews/moderation, favourites/coupons/blocking/support/notifications, onboarding, dashboard, settings, payouts.
* Mobile: `tsc` strict + ESLint + i18n parity check (259 keys). Admin: `tsc` + production build.
* **Browser smoke tests** (`tests/e2e-web`, manual): admin console (all pages, RTL, customer rejected, mandatory-MFA enrolment), mobile web build (customer: register → browse → kitchen → dish → cart → address → COD order; cook: accept → prepare → ready → out → delivered; Arabic/RTL), all against the live API with no console errors.

## Not covered (be aware)
* No native iOS/Android device testing, push delivery, or deep-link testing in this environment; no mobile unit/component tests; no load/performance tests; no automated accessibility audit (labels/roles/targets were built in but not machine-verified); no test of a real payment gateway.
* Browser smoke tests are not in CI.

## Bug policy
Reproduce → root cause → fix → regression test → rerun suite. Examples with tests: corrupt upload 500, payout idempotency race, MFA lockout, moderator privilege leak.
