# Build status, limitations and human next steps

## Built and verified in this repository
| Area | Status |
|---|---|
| Shared scoring/date/period helpers, AR+EN dictionaries | ✅ 18 unit tests |
| API: auth, consents, catalogue, logging, ledger, rankings, verification pilot, appeals, retention, deletion/export, admin RBAC, content governance, scoring rules, adjustments, pilot metrics | ✅ 66 integration tests, passing on **PGlite and PostgreSQL 16** |
| Production API bundle | ✅ built and smoke-tested against PostgreSQL; `tools/e2e-smoke.mjs` passes over real HTTP (register → log → upload → review → verified → rankings → delete) |
| Admin dashboard (Next.js) | ✅ builds; login + pilot/content/ops pages exercised in a real browser (no page errors) |
| Mobile app (Expo) | 🟡 typechecks; bundles for Android with Metro/Hermes. **Never run on a device/simulator** — the UI is unverified visually |
| Backup/restore drill, load smoke test | ✅ ran locally (see RUNBOOK) |
| CI workflow, Dockerfile, compose | 🟡 written; CI not executed, Docker not built here |

## Stubbed or absent (honest list)
* **AI recitation assessment:** interface + feature flags + benchmark gate only; no provider. Human review is the working path.
* Password-recovery **email delivery**; staff MFA/SSO; S3 backend untested; iOS/Android **device tests, store assets, privacy-policy text**; third-party pen-test; screen-reader/RTL QA.
* Partner-confirmed volunteering/charity (class C), community challenges, premium features — out of scope by design.
* The Arabic text everywhere is a **machine draft**; Christian/Islamic activity wording and references are **unreviewed drafts** (seeded as `draft`, not visible to users until approved).

## Human-required next steps
1. **Religious reviewers:** recruit qualified Islamic and Christian reviewers (and Arabic/English translation reviewers); have them approve/replace the catalogue and define the real scripture tasks (passage, edition/translation, permitted variations, rubric).
2. **Legal/privacy review per pilot market** (sensitive religious data, hosting/residency, consent wording, minors policy, vendor terms) and write the privacy notice/terms.
3. **Infra:** managed PostgreSQL, TLS, secret manager, object storage + lifecycle, backups; set `CORS_ORIGINS`; add transactional email for recovery.
4. **Device QA** on iOS and Android in Arabic and English (RTL, VoiceOver/TalkBack, microphone permission flows); EAS build profiles, app icons/screenshots; Apple/Google developer accounts.
5. **If AI assessment is wanted:** vendor review (no training, retention, region), labelled benchmark set, run `tools/benchmark.ts`, set thresholds with reviewers, then a human enables the flag.
6. **Budget & staffing:** review SLA and cost per verified submission; invite codes and pilot recruitment per `PILOT_PROTOCOL.md`.

## Getting a test APK
No APK is checked in (the authoring sandbox cannot reach the Android SDK or Expo's build service). Build one on GitHub: **Actions → android-apk → Run workflow**, passing the **HTTPS** URL of an API the phone can reach (production builds refuse `http://`). Download the `good-deeds-companion-apk` artifact and sideload it (debug-keystore signed: testing only). For a quick backend: run the API locally with `npm run seed:demo` + `npm run dev:api` and expose it through an HTTPS tunnel (e.g. `cloudflared tunnel --url http://localhost:8080`); sign up with invite `DEMO-INVITE`.
