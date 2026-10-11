# Security (OWASP MASVS v2 mapping) and test evidence

Legend: ✅ implemented & tested · 🟡 implemented, needs device/ops verification · ⬜ not done

| MASVS | Control | Status | Evidence |
|---|---|---|---|
| STORAGE | Tokens in Keychain/Keystore (`expo-secure-store`); no private content cached to disk by the app | 🟡 | `apps/mobile/src/api.ts`; verify on device |
| STORAGE | Android `allowBackup=false` so tokens/data aren't in cloud backups | 🟡 | `app.json` |
| STORAGE | Server evidence encrypted AES-256-GCM before storage; tamper detected | ✅ | `verification.test.ts` ("stored blobs are ciphertext") |
| CRYPTO | scrypt (N=16384) passwords; HS256 JWT 15 min; refresh tokens random, hashed in DB, rotated, revoked on reset/logout | ✅ | `core.test.ts` |
| CRYPTO | Secrets only from env; production refuses to start without them or with weak ones | ✅ | `config.ts` |
| AUTH | Invite-only registration, adult attestation, generic login errors, no account enumeration on recovery | ✅ | `core.test.ts` |
| AUTH | Roles/status re-read from DB every request (suspension & role changes immediate) | ✅ | `admin.test.ts` |
| AUTH | Per-IP rate limits (10/min on auth, 300/min global); 5 recitation uploads/day/user | ✅ | `routes/auth.ts`, `app.ts` (limits disabled in tests) |
| AUTH | Per-account lockout, MFA for staff | ⬜ | recommend MFA via identity provider before wider rollout |
| AUTHZ | Every staff route denies users (403) / anonymous (401); roles not interchangeable; IDOR checks on logs/notes/submissions/appeals | ✅ | `admin.test.ts` RBAC matrix, `verification.test.ts` |
| AUTHZ | Reviewers: tradition-qualified only; no identity in tasks; signed 5-min audio URLs, audited | ✅ | `verification.test.ts` |
| NETWORK | TLS required (proxy); mobile production build refuses non-https API_URL; admin CSP, X-Frame-Options, no-referrer; API `nosniff`, `no-store` | 🟡 | config + headers; pinning not implemented |
| PLATFORM | Minimal permissions (microphone only, requested at point of use with explainer) | 🟡 | `app.json`, `Verify.tsx` |
| CODE | zod validation on every body/query; parameterised SQL (only whitelisted identifiers interpolated); upload type/size limits; internal errors never leaked | ✅ | code + tests |
| CODE | Dependency audit | 🟡 | API/runtime deps clean. Open advisories (`npm audit --omit=dev`) are in Expo/Metro/node-forge/braces **build tooling** and Next's PostCSS **build-time** — not shipped in the mobile runtime or API; revisit when Expo ships patched releases |
| RESILIENCE | Jailbreak/root detection, obfuscation | ⬜ | deliberately omitted (non-blocking per spec) |
| PRIVACY | Consent per purpose, private-by-default, minimal public projection, deletion, export, retention | ✅ | `core/leaderboard/verification.test.ts`, `PRIVACY.md` |
| PRIVACY | No private content in logs/audit | ✅ | `admin.test.ts`; logger redacts auth header; bodies not logged |

## Residual risks to review
* The access token for the admin app lives in `sessionStorage` (XSS would expose it); mitigated by a strict CSP and no third-party scripts. Prefer HttpOnly cookies + SSO/MFA before scaling the staff team.
* Uploaded audio is trusted by declared MIME type; it is only stored encrypted and streamed back to reviewers, never parsed server-side (an AI provider, if added, becomes a new parsing surface).
* `trustProxy` is on: deploy only behind a trusted proxy.
* Recovery emails are not implemented (token returned only outside production).
* No penetration test by a third party has been done; the automated authz/IDOR tests are not a substitute.
