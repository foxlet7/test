# Database

PostgreSQL 14+ with `pg_trgm`. Schema: `apps/api/prisma/schema.prisma` (46 models, 20 enums). Migrations: `apps/api/prisma/migrations` (versioned; applied from scratch on every test run, which verifies them on a clean database). Never edit a database by hand; add a migration (`prisma migrate dev --name …`; hand-written SQL goes in the same migration, as the integrity layer does).

## Model map
* **Identity**: `User` (roles[], status, TOTP secret encrypted), `CustomerProfile`, `CookProfile`, `RefreshToken` (hashed, family id), `OtpCode` (hashed), `UserBlock`, `DeviceToken`, `NotificationPreference`
* **Places**: `Address` (soft-deleted), `Kitchen` (+`KitchenCuisine`, `KitchenSchedule`, `DeliveryZone`, `KitchenVerification`, `KitchenDocument`)
* **Catalogue**: `Category`, `Cuisine`, `MenuItem` (+`MenuItemOptionGroup`, `MenuItemOption`)
* **Commerce**: `Cart`/`CartItem`, `Order`/`OrderItem`/`OrderStatusHistory`, `Coupon`/`CouponRedemption`/`Promotion`
* **Money**: `Payment`, `PaymentTransaction`, `WebhookEvent`, `Refund`, `LedgerEntry`, `Payout`
* **Engagement/safety**: `Review`, `Favorite`, `Notification`, `Report`, `ModerationAction`, `SupportTicket`/`SupportMessage`, `AuditLog`
* **Platform**: `IdempotencyKey`, `Setting`, `AnalyticsEvent`, `Upload`

## Integrity enforced in the database (not only in code)
* `AuditLog`, `OrderStatusHistory`, `LedgerEntry`, `ModerationAction`, `PaymentTransaction`: **append-only** (triggers block UPDATE/DELETE/TRUNCATE for every role).
* `Order.status` changes must follow the legal transition graph (`Order_transition_guard`).
* One succeeded payment per order (partial unique index) · one open verification case per kitchen · `(customerId, idempotencyKey)` unique on orders · `(provider, eventId)` unique on webhooks · `(ref, account)` unique on the ledger.
* CHECK constraints: non-negative money, quantity 1–50, rating 1–5, lat/lng ranges, schedule minutes, coupon percent ≤ 100, lower-case emails, favourite has exactly one target, ledger amounts non-zero.
* Soft delete: `Address`, `MenuItem`, `Kitchen` (`deletedAt`); orders keep **snapshots** of item names/prices/options and the delivery address, so catalogue edits never rewrite history.
* Indexes: trigram GIN on `searchText`; composite indexes on `(kitchenId,status)`, `(customerId,createdAt)`, `(status,createdAt)`, etc.

## Retention & deletion
See [PRIVACY.md](PRIVACY.md). Account deletion anonymises the `User` row and deletes personal side-tables; orders, payments and ledger rows are retained (legal/financial) without personal data.
