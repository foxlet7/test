# API

* Base URL: `https://<host>/` — OpenAPI/Swagger UI at `/docs` (disabled when `NODE_ENV=production`).
* **Full route list with auth requirement per endpoint:** [`API_ROUTES.md`](API_ROUTES.md) (generated from the real decorators: `npx ts-node apps/api/scripts/routes.ts`).

## Conventions
Success: `{ "success": true, "data": … }` · Error: `{ "success": false, "error": { "code", "message", "details?", "requestId" } }`.
Codes live in `packages/shared/src/errors.ts` (`VALIDATION_FAILED 400`, `UNAUTHENTICATED/INVALID_CREDENTIALS/TOKEN_EXPIRED 401`, `FORBIDDEN/ACCOUNT_SUSPENDED 403`, `NOT_FOUND 404`, `CONFLICT/ILLEGAL_TRANSITION/PRICE_CHANGED/KITCHEN_UNAVAILABLE/ITEM_UNAVAILABLE 409`, `MIN_ORDER_NOT_MET/OUT_OF_DELIVERY_ZONE/COUPON_INVALID 422`, `PAYMENT_FAILED 402`, `RATE_LIMITED 429`).
Every response carries `x-request-id`; logs and error bodies share it. Stack traces never leave the server.

* **Auth**: `Authorization: Bearer <access JWT>` (HS256, 15 min). Refresh tokens are opaque, rotated on every use, reuse of a spent token revokes the whole session family. Access tokens are also checked against the live session and user status on every request, so logout/suspension is immediate.
* **Idempotency**: `Idempotency-Key` header (16–80 chars) is **required** on `POST /orders`, `POST /admin/orders/:id/refund`, `POST /admin/kitchens/:id/payouts`.
* **Pagination**: lists use `page/pageSize` (admin, catalogue) or opaque `cursor` (orders, notifications, reviews). Max page size 30–100.
* **Ids** are UUIDs. Other users' resources return **404**, not 403, so ids cannot be probed.
* **Money** fields are integers in minor units (`…Minor`).
* **Uploads**: `POST /uploads` multipart (`file`, `purpose`). JPEG/PNG/WebP only (magic bytes), ≤ 5 MB, 100–8000 px, re-encoded to WebP (EXIF stripped), thumbnails generated, random keys. Verification documents are stored privately and never served publicly.
* **Webhook**: `POST /payments/webhooks/:provider`, authenticated by `x-tablya-signature` = HMAC-SHA256(raw body, `PAYMENT_WEBHOOK_SECRET`) for the sandbox provider. A real adapter defines its own scheme in `parseWebhook`.

## Main flows (happy path)
```
POST /auth/register → POST /me/addresses → GET /home | /kitchens | /search → GET /kitchens/:id
POST /cart/items → POST /checkout/quote → POST /orders (Idempotency-Key) → [card: pay via gateway → webhook] → GET /orders/:id
cook: GET /cook/kitchens/:id/orders → POST /cook/orders/:id/transition {to}
customer: POST /orders/:id/confirm-received → POST /reviews
```
