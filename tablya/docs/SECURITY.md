# Security

## Controls implemented (and where they are tested)
| Area | Control | Test |
|---|---|---|
| Passwords | argon2id (19 MiB, t=2); policy ≥10 chars with letters+digits; unknown-email logins cost the same as wrong-password (timing) | `auth.e2e` |
| Brute force | per-IP throttling (`@nestjs/throttler`, stricter on auth routes) + per-account lockout (5 failures → 15 min) | `auth.e2e`, `access.e2e` |
| Sessions | 15-min JWT (HS256, algorithm and issuer pinned) bound to a server-side session family; rotating refresh tokens with reuse detection; logout / suspend / password reset revoke immediately | `auth.e2e` |
| MFA | TOTP (RFC 6238) for staff, secret AES-256-GCM encrypted at rest; `REQUIRE_ADMIN_MFA` is mandatory in production and uses a restricted bootstrap session so first-time enrolment cannot lock staff out | `auth.e2e` |
| Authorisation | global auth guard (deny by default; `@Public()` is explicit and listed in `API_ROUTES.md`), role guard, and **ownership checks in queries** (404 on other people's data). Roles are scoped: moderators cannot see users/orders/payments; support cannot refund; only `SUPER_ADMIN` changes roles/settings | `access.e2e` |
| Privilege changes | role change revokes the user's sessions; staff cannot suspend themselves; only super admins suspend staff; every sensitive action needs a written reason and is audit-logged with actor, IP and request id | `access.e2e` |
| Input | Zod validation on every body/query (unknown fields stripped, ids as UUIDs, bounded lengths); parameterised SQL only (raw SQL uses tagged templates); 256 KB JSON body limit → 413 | `access.e2e` |
| Money | integer arithmetic; server-authoritative pricing; idempotent order/refund/payout; DB constraints | `commerce.e2e` |
| Webhooks | HMAC over raw body, timing-safe compare, event-id idempotency, amount verification, invalid attempts recorded | `commerce.e2e` |
| Uploads | magic-byte sniffing (not extension/MIME), size and dimension limits, decode + re-encode (strips EXIF/polyglots), random keys, ownership proof before attaching, private bucket for documents, `nosniff` | `access.e2e` |
| Transport/headers | Helmet (HSTS, nosniff, frame-ancestors…), no `X-Powered-By`, CORS allow-list (default: none) | `access.e2e` |
| Data at rest | OTPs/refresh tokens stored as hashes; TOTP encrypted; no card data ever touches the API (gateway-hosted) | — |
| Logging | structured JSON with request id; no bodies, tokens, passwords or query strings logged | — |
| Tamper resistance | append-only audit/ledger/history tables (DB triggers) | `commerce.e2e` |

## Hostile review — findings fixed during development
1. Corrupt-pixel PNG with valid header crashed upload with HTTP 500 → now `415 UPLOAD_REJECTED` (regression test).
2. Oversized/malformed JSON returned 500 → `413`/`400`.
3. Concurrent payout requests with one idempotency key: loser returned 409 instead of the original payout → re-check inside the locked section.
4. `REQUIRE_ADMIN_MFA=true` would have made enrolment impossible → restricted bootstrap session.
5. `MODERATOR` could read users/orders (class-level default) → least-privilege default; moderators only reach moderation endpoints.
6. Fuzzy search matched unrelated words (`secret`→`second`) → similarity threshold raised to 0.5.
7. Vulnerable runtime dependencies (multer, sharp/libvips, lodash, qs, js-yaml, body-parser) → patched via workspace overrides (`npm audit --omit=dev` shows no remaining high findings for API runtime packages; Expo/Metro build-tool advisories remain and are not shipped).

## Accepted trade-offs / residual risk (decide before launch)
* Registration reveals whether an email is registered (409). Password-reset and login do not.
* Lockout can be used to deny service to a known email for 15 minutes (mitigated by the IP throttle).
* Password-reset OTP is 6 digits, 10 min, 5 attempts per code, 1 code/min/target — adequate with the IP throttle; consider link-based reset or longer codes for higher assurance.
* Cash-on-delivery is available without phone verification; consider requiring `phoneVerified` and per-account COD limits to curb fraud.
* The sandbox payment provider is development-only; the server refuses to start with it in production.
* Throttling is in-memory per instance. Behind a load balancer set `trust proxy` correctly (it is `1` hop) and use Redis storage when scaling out.
* Mobile tokens live in Keychain/Keystore (`expo-secure-store`); web fallback (`sessionStorage`) is for local preview only. No secrets are shipped in the apps (`EXPO_PUBLIC_*` values are public by design).
* No external penetration test has been performed. Commission one before launch.

## Reporting
Add a `security.txt` / contact address on the production domain.
