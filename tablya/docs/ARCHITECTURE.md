# Architecture

## Decisions (and why)
| Decision | Rationale |
|---|---|
| Monorepo with a shared TS package | The order state machine, money maths, schedule logic and validation exist once and are used by API, admin and mobile. Domain rules cannot drift between clients and server. |
| Modular monolith (NestJS) | One deployable, strong module boundaries (`auth, users, catalog, cart, orders, payments, checkout, cook, engagement, admin, uploads, notifications, health`). Splitting later is cheap; distributed systems are not warranted yet. |
| PostgreSQL only | Relational integrity, transactions, row locks, partial unique indexes, triggers and `pg_trgm` search. No Redis/Elasticsearch until measured need (see limitations). |
| Money = integer minor units | No floating point anywhere. Currency is configurable (`CURRENCY`, default `SAR`). |
| Server is the only price authority | `PricingService.quote()` recomputes everything from the DB. Client totals are only an *expected* value; a mismatch returns `PRICE_CHANGED`. |
| Payment provider port | `PaymentProvider` interface (`initiate`, `refund`, `parseWebhook`). Domain code never imports a gateway SDK. |
| Events after commit | `OrderLifecycleService.transition()` commits, then emits `order.transitioned`; listeners do notifications, refunds, COD capture and ledger settlement. Failures are logged and repaired by the reconciler. |

## Order lifecycle
Single source of truth: `packages/shared/src/order-state.ts`, mirrored by a DB trigger (`Order_transition_guard`).

```
PENDING_PAYMENT → PLACED → ACCEPTED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED → COMPLETED
      │              │ └→ REJECTED          (cook cancels ACCEPTED/PREPARING; customer cancels PLACED)
      └→ CANCELLED   └→ CANCELLED     CANCELLED/REJECTED/DELIVERED/COMPLETED → REFUND_PENDING → REFUNDED
```
`PLACED` means *payment confirmed (or cash on delivery chosen) and the kitchen notified* — the spec's separate `PAYMENT_CONFIRMED` state
was collapsed into it because nothing can act on an order in between. Every change goes through one function that does a compare-and-set
on the previous status (two actors cannot both win), appends immutable history, restores stock/coupons on cancel/reject.

## Checkout & payments
1. Server-side cart (one kitchen). `POST /checkout/quote` returns authoritative totals plus a list of `issues` (unavailable item, closed kitchen, out of zone, min order, coupon).
2. `POST /orders` with an `Idempotency-Key` header: re-price strictly → atomically reserve stock (`UPDATE … WHERE stock >= qty`) → create order/items/history → redeem coupon (guarded counter) → clear cart. Same key + same body returns the same order; different body → `IDEMPOTENCY_CONFLICT`.
3. **Card**: order stays `PENDING_PAYMENT`; `POST /orders/:id/pay` starts an attempt (idempotent within 60 s). The order is placed **only** by a signed gateway webhook (HMAC over the raw body, timing-safe), stored in `WebhookEvent (provider, eventId)` for idempotency; amount mismatches never place an order; success after expiry/cancel triggers an automatic refund.
4. **Cash on delivery**: placed immediately; cash is "captured" when the cook marks it delivered; the ledger records that the kitchen holds the cash.
5. Refunds: `PaymentsService.refundOrder` is idempotent on a key, serialised per payment with `SELECT … FOR UPDATE`, cannot exceed the amount paid. Partial refunds only after `COMPLETED`.

### Ledger (append-only, DB-enforced)
Accounts: `CUSTOMER_PAYMENT, VENDOR_EARNINGS, PLATFORM_FEE, TAX, REFUND, ADJUSTMENT, DELIVERY_FEE, PAYOUT`. On `COMPLETED`, revenue is split by
`settlement()` — invariant `vendorEarnings + platformFee + tax = total` (unit-tested). Coupons are platform-funded. Refunds reverse the settlement
(full) or book an adjustment (partial). Kitchen balance = ledger sum − payouts; **it is never derived from order rows**. Payouts are recorded with an idempotency key; marking them paid is manual (no payout-provider integration).

## Background jobs (`JobsService`, every minute)
Recover paid-but-unplaced orders · expire unpaid card orders · reject orders the kitchen ignores · auto-complete delivered orders · retry stuck refunds · purge stale idempotency keys/OTPs/refresh tokens.
Each step is idempotent and uses compare-and-set transitions, so running on several instances is safe (just redundant).

## Search
`searchText` columns hold text normalised by `normalizeSearch` (lower-case, strips diacritics/tatweel, unifies alef/yaa/taa-marbuta, Arabic-Indic digits).
Queries use `ILIKE` + `word_similarity ≥ 0.5` on a GIN trigram index: partial words, typos and Arabic variants all match. Threshold chosen from measured scores (see git history).

## Internationalisation
EN/AR from the start: shared message catalogue (`packages/shared/src/i18n.ts`) + app-specific catalogues; Arabic columns on catalogue entities; `pick()` selects Arabic when present. Mobile uses `I18nManager` (native needs a restart for direction flip — the UI says so), web sets `dir`. `npm run check:i18n -w @tablya/mobile` fails on key drift or undefined keys.

## Known limitations
These are real and deliberate scope boundaries, not hidden TODOs:
1. **No production adapters**: only `sandbox` payments, `console` email/SMS and local-disk storage exist. `loadConfig` refuses to boot in production with any of them. You must implement `PaymentProvider` (+ webhook mapping), `MessageProvider` and `StorageProvider` (S3/GCS). The mobile `PayStep` needs the chosen gateway's SDK.
2. **Kitchen listing scales to hundreds, not hundreds of thousands**: `/kitchens` loads ≤500 candidates and computes distance/availability in Node. For scale move geo filtering into SQL (PostGIS or `earthdistance`) and cache availability.
3. **Scheduler is in-process** (`@nestjs/schedule`); rate limiting is in-memory (`@nestjs/throttler`). With >1 replica use Redis storage for throttling and run the scheduler on one instance or move jobs to a queue.
4. **Delivery** is cook-delivered with distance-tier fees. Driver dispatch/live tracking are not implemented (the `DeliveryZone` + order status model leaves room for it).
5. `KITCHEN_MANAGER` role exists in RBAC but there is no staff↔kitchen assignment table yet; only owners manage a kitchen.
6. No in-app chat (support tickets only). No email templates (provider interface only). Push uses Expo's service and needs an EAS project id + APNs/FCM credentials.
7. Mobile has no device/native automated tests; flows were verified on the web build and by typecheck (see TESTING.md).
8. Customer→cook blocking is one-directional (cooks can block customers).
