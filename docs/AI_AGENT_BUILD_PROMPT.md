# AI Agent Build Prompt — Good Deeds Companion (Muslim & Christian)

> Working title: **Good Deeds Companion**. Paste this entire document to the AI coding agent. It is the final product specification and build brief, consolidating all discovery decisions.

---

## 0. Your role and operating rules

You are a senior full-stack/mobile engineer and technical lead. Research, architect, build, test, and prepare for store submission a mobile app (iOS + Android) with a backend and a lightweight admin web dashboard.

Operating rules:
1. **Work in phases** (Section 14). Finish and test each phase before the next. Commit often with clear messages.
2. **Do not invent religious content.** Seed the activity catalogue only with the *draft* structure and source references in Section 6, flagged `draft`. Nothing is user-visible as "approved" until a reviewer approves it in the admin dashboard. Never claim endorsement by any religious authority.
3. **Never claim to measure faith, sincerity, righteousness, or divine reward.** Points are game mechanics. This disclaimer must appear in onboarding, the points explainer, and the leaderboard screens (in Arabic and English).
4. If something is ambiguous, choose the most privacy-protective, least-claiming option, document it in `docs/DECISIONS.md`, and continue.
5. Write tests alongside code. Keep a `docs/` folder: `ARCHITECTURE.md`, `DECISIONS.md`, `DATA_INVENTORY.md`, `SCORING_SPEC.md`, `PRIVACY.md`, `PILOT_PROTOCOL.md`, `RUNBOOK.md`.

---

## 1. Product vision

A privacy-first mobile app where adult Muslims and Christians log religious and charitable good deeds, build consistent habits, track learning milestones, and *optionally* take part in transparent community rankings.

Priority order (never invert): **(1) personal growth & habits → (2) trustworthy recognition/verification → (3) optional competition.**

Guiding principles:
- Participation is accessible: no evidence is required for private deeds.
- Verification is specific: evidence confirms only what it can reasonably establish.
- Points are not spiritual merit.
- Private by default; public is explicit opt-in and minimal.
- No wealth leaderboard, no guilt mechanics, no public shaming.

---

## 2. Locked product decisions

| Area | Decision |
|---|---|
| Traditions | Islam and Christianity at launch; separate, independently governed content packages on a shared framework |
| Christian scope | Broad introductory catalogue with transparent tradition-specific notes (Catholic / Orthodox / Protestant) and qualified review |
| Languages | Arabic + English at launch (full RTL), architecture ready for more (i18n keys, no hard-coded strings) |
| Interface language ≠ religious tradition | Fully independent settings. Language never silently changes religious content |
| Platforms | iOS + Android from one cross-platform codebase |
| Launch | **Invitation-only private pilot** in 3 stages (Section 13); public markets chosen after pilot |
| Age | **Adults only (18+)** at launch; age gate + terms acceptance |
| Leaderboards | Two views of **one ledger**: (A) All Eligible Activities, (B) Verified Activities. Optional, opt-in, per-tradition. Weekly / monthly / lifetime |
| Verified scoring | Same base points as (A). Only verified activities count for (B). **No verification bonus.** Verified ⊂ eligible |
| Verification model | Self-log for private deeds; evidence + human/AI-assisted review only for selected activities |
| First verified activity | **Scripture learning/recitation milestone**, one fixed task per tradition. **Manual (human-review) baseline first**; AI-assisted pre-check built behind a feature flag, off by default, enabled only after benchmark gates pass |
| Evidence retention | Separate policy per evidence type, short defaults (Section 9) |
| Business model | Free core. No ads, no sale of data, nothing purchasable affects points/rank/verification. Premium evaluated later |

---

## 3. Recommended technical stack (justify or change in `DECISIONS.md`)

- **Mobile:** React Native + Expo (TypeScript), `expo-av`/`expo-audio` for recording, `react-i18next` with RTL support, `expo-secure-store`, push via Expo Notifications.
- **Backend:** TypeScript (NestJS or Fastify) + **PostgreSQL**; object storage (S3-compatible) with per-object encryption and short-lived signed URLs; job queue (BullMQ/Redis or pg-based) for scoring/ranking/retention jobs.
- **Admin web:** Next.js (TypeScript) with RBAC.
- **Infra:** Docker Compose for local dev; IaC-ready; CI (lint, typecheck, unit, integration, e2e smoke) via GitHub Actions; secrets via env/secret manager, never committed.
- **Auth:** email/password + Apple/Google sign-in; secure session/refresh tokens; account recovery; rate limits. Pseudonymous profiles (no real name required).
- Region/hosting must be configurable (data residency for PDPL and similar regimes).

---

## 4. Core domain architecture — three separated systems

1. **Faith & Activity Catalogue** — versioned, reviewed content (data, not code).
2. **Activity & Verification Engine** — logging, evidence, scoring, anti-abuse, review, append-only ledger.
3. **Growth & Community** — private dashboard, goals, achievements, optional leaderboards, challenges (Phase 2).

Data boundaries (enforce in schema + API + access control):
- **Private records** (activity notes, evidence, audio, reflections, religious preference).
- **Scoring/verification service** (restricted, audited).
- **Minimal public projection** (pseudonym, opt-in avatar, score, period, rank — nothing else). Materialized separately; never join public endpoints to private tables.

---

## 5. Data model (minimum)

`users`, `profiles` (pseudonym, language, tradition, adult_confirmed_at), `consents` (type: account | evidence | ai_processing | leaderboard_A | leaderboard_B, version, granted_at, revoked_at), `traditions`, `content_packages` (per tradition, versioned), `activity_definitions`, `activity_definition_versions`, `activity_translations`, `religious_references`, `review_records` (reviewer role, decision, date, notes), `activity_logs` (user, definition version, local activity date + tz, status), `ledger_entries` (**append-only**: award | reversal | adjustment; points, rule_version, verification_status, reason, actor), `verification_submissions`, `evidence_objects` (type, storage key, retention_expires_at, deleted_at), `review_tasks`, `review_decisions`, `appeals`, `leaderboard_memberships`, `leaderboard_snapshots` (periodic), `goals`, `achievements`, `reports` (abuse/translation/content), `audit_logs`, `feature_flags`, `deletion_requests`.

Rules:
- Ledger rows are never updated or deleted; corrections are new entries.
- Every award stores the scoring-rule version and activity-definition version used.
- Idempotency keys on all award/verification operations.
- Activity date is the user's local date captured with timezone; ranking periods are computed **server-side** in a single documented timezone policy (default: UTC week boundaries Monday 00:00 UTC; display local equivalents). Document in `SCORING_SPEC.md`.

---

## 6. Activity catalogue (draft seed, all flagged `draft` until reviewed)

Every definition must include: stable ID, tradition, category, description (AR+EN), type (recurring | milestone | event | measurable), obligation class (`obligatory` | `voluntary` | `general_good_deed`), religious references, base points, repeat policy, verification class (A private / B assessable / C externally confirmable), privacy classification, review status, version.

**Islam (draft structure):** Charity & generosity (sadaqa, feeding people, donating useful items, anonymous giving — *zakat is obligatory with specific rules; model separately from voluntary sadaqa and do not auto-score it as interchangeable*); Qur'an learning (reading, memorization milestone, review session); Worship & remembrance (daily prayers, voluntary worship, dhikr, learning); Character, family & service (kindness to parents, family ties, neighbors, honesty, reconciliation, volunteering).
Starting references to be verified by reviewers: Qur'an 2:261–271, 2:263; Sahih Muslim 1907a (intention).

**Christianity (draft structure):** Charity & serving (feeding, donating, volunteering, supporting vulnerable people); Bible study & memorization (reading, study plan, memorized passage); Prayer & spiritual growth; Compassion, forgiveness & community (family, visiting, reconciliation, neighbors). Tradition-specific notes where practices differ (Catholic/Orthodox/Protestant), including sacramental practices which must not be scored as if universal.
Starting references to be verified by reviewers: James 2:14–17; Ephesians 2:10; Matthew 6:1–4 (informs how public display is handled).

**Illustrative base points (placeholders, configurable, versioned; NOT religious valuations):**
study session 5 · memorization/learning milestone 15 · volunteering session 15 · help someone in need 5 · eligible charity act 5 · defined service milestone 10 · daily prayer/remembrance 3.
**Donation points never scale with amount.** No unlimited repetition: each definition has its own repeat policy (daily / weekly / once per milestone). Prayer and private kindness are never worth fewer points *because* they are hard to verify.

---

## 7. Scoring & ledger spec

1. One action → one scoring event; verified submission links to the same activity log, never double-counted.
2. Base points only. **Verification adds zero points**; it changes status and Leaderboard-B eligibility.
3. Leaderboard A counts eligible self-reported + verified. Leaderboard B counts only `verified` entries. Same points.
4. Late verification credits the **original activity date** if within a configurable submission+review window (default 14 days); after the window, it counts for verification status but is documented per policy.
5. Tie-break: stable and published (earliest time to reach the score, then pseudonym ID hash).
6. Rule changes create new versions; history is never rewritten. Reversals/adjustments are new ledger entries with reasons, and rankings recompute deterministically.
7. Premium, donations to the app, ads, referrals can **never** modify points or rank (enforce with a test).
8. Show category progress (consistency, learning, service, community) beside the total; avoid presenting one number as "goodness".
9. No negative scores, no streak-loss penalties, no guilt language.

Build a deterministic `scoring` module with exhaustive unit tests (duplicates, idempotency, repeat policies, timezone boundaries, late verification, reversal, tie-breaks).

---

## 8. Verification system

States: `self_reported` → `pending_review` → `verified` | `unable_to_verify` | `rejected` (with reason + appeal) | `under_investigation`.

Classes:
- **A – Private (self-log):** prayer, private kindness, reflection. No evidence required, ever.
- **B – Assessable:** scripture learning/recitation (pilot activity).
- **C – Externally confirmable:** volunteering/charity via partner confirmation (Phase 2; design hooks only).

**Pilot activity — scripture recitation milestone:**
- One fixed passage per tradition (config-driven; the passage, reference text/edition or translation, permitted variations, and pass rubric are set and approved by reviewers in the admin dashboard — do not hard-code religious judgments).
- Flow: select task → consent screen (purpose, retention, reviewers' access) → record audio → upload → status tracking → result with plain-language explanation → appeal.
- **Phase 1 of verification = human review queue** with rubric form, reviewer overrides, second-review for appeals, inter-reviewer disagreement tracking.
- **AI pre-check (feature-flagged OFF):** pluggable `AssessmentProvider` interface returning `{result: match | review | unable_to_assess, confidence, notes}`. Must be able to **abstain**. Never auto-reject; low confidence → retry or human review. Never judges tajwid/pronunciation quality unless a validated provider and reviewer-approved criteria exist. Include a benchmark harness (`tools/benchmark`) reporting false-accept, false-reject, abstention, reviewer-override rates and per-subgroup breakdowns. Do not enable until pre-agreed thresholds pass. No provider may train on user audio; log provider data-handling terms in `DECISIONS.md`.
- Re-recording the same task earns no extra points unless a new milestone is defined.
- Reviewers see only: the recording, task, rubric — not rank, real identity, or unrelated records.

---

## 9. Privacy, security, retention

- **Private by default.** Joining Leaderboard A or B is a separate explicit consent each; revoking removes the public entry promptly. Public exposes only pseudonym, optional avatar, score, period, rank. Tradition shown only if the user opted into a tradition leaderboard.
- Separate consents: account, evidence upload, AI processing, leaderboard participation. Pre-permission explainer before mic/file access.
- **Evidence retention defaults (configurable, enforced by scheduled jobs and tested):**
  - Recitation audio: delete raw audio after decision + appeal window (default 14 days).
  - Charity receipts: extract minimum confirmation data; delete original after short window (default 30 days).
  - Volunteer confirmations: keep minimum confirmation record.
  - Reviewer decisions: keep decision, criteria, minimal audit info.
  - Private notes: until user deletes or account deleted.
- Encryption in transit (TLS) and at rest; evidence in a separate bucket; short-lived signed URLs; no recordings/receipts/private activity content in logs or analytics; role-scoped reviewer access with audit logging.
- **In-app account deletion** (Apple) and external web deletion request (Google Play); **data export**; deletion must cover evidence, derived data, public leaderboard entries, and define backup/cache handling and pending-appeal exceptions.
- No sale of religious data; no faith-based ad targeting; no third-party ad SDKs. Minimal analytics, no content in events.
- Follow **OWASP MASVS** (storage, auth, network, platform, privacy). Add a security checklist and tests: authz on every endpoint (IDOR tests), rate limiting, input validation, upload type/size limits and malware-safe handling, certificate pinning optional, jailbreak/root awareness non-blocking.
- Prepare store privacy disclosures (Apple privacy labels, Google Data Safety) as drafts in `docs/PRIVACY.md`, and a `DATA_INVENTORY.md` (field, purpose, access, retention).
- Flag in docs that legal review is required per jurisdiction before inviting participants (e.g., Saudi PDPL treats religious-belief data as sensitive; GDPR special category data). Do not assume a private pilot is exempt.

---

## 10. Anti-abuse

Layered: idempotent awards; duplicate/replay detection (event IDs, audio fingerprints); plausibility checks and per-activity rate limits; account-creation throttling without invasive device tracking; partner-account award caps and traceability; risk signals route to human review. Response ladder: block duplicate + explain → temporary review/limit → hold verified submissions pending review → reverse via ledger + proportionate restriction. Never publicly label anyone; always explain and allow appeal. Appeals: fresh human review where feasible, status updates, target response time in config.

---

## 11. UX requirements

Core journey: welcome/language → account + adult confirmation → choose tradition (or explore) → dashboard (today, goals, recent progress) → **quick log in ≤ 3 taps for simple deeds** → points explanation (what was earned, repeat rules, which leaderboards it counts for) → verification tracking (when applicable) → progress (weekly/monthly trends, learning milestones, achievements) → optional leaderboards.

- Warm, calm, non-judgmental tone; no guilt streaks; missing a day loses nothing.
- Full RTL for Arabic, proper fonts/numerals/dates, text expansion, accessibility (screen reader labels, dynamic type, contrast, reduced motion).
- Scripture shown with reviewed references only; "report translation/content error" on every activity.
- Leaderboard screens: clearly labeled what each measures; period + cutoff visible; opt-out one tap; private profile still sees own progress.
- Settings: privacy dashboard (consents, retention info, delete evidence, export, delete account), reminders (opt-in), language, tradition.

---

## 12. Admin web dashboard (required in MVP)

RBAC roles: `super_admin`, `content_admin`, `islamic_reviewer`, `christian_reviewer`, `translation_reviewer`, `verification_reviewer`, `moderator`, `auditor` (read-only).
Features: manage content packages and activity definitions with versioning + review workflow (`draft → in_review → approved → retired`), reference management, translation review, scoring-rule versions (with diff and effective date), verification review queue + rubric + appeals, reports/abuse queue, ledger inspector with adjustments (requires reason + second approver for large changes), leaderboard recompute preview, feature flags, retention job status, full audit log. No raw evidence visible outside assigned tasks.

---

## 13. Pilot protocol (implement support + document in `PILOT_PROTOCOL.md`)

Invitation-only access (invite codes, allow-list, kill switch, tested rollback).
- **Stage 1 (≈20–30 adults):** usability, onboarding, AR/EN, private logging, consent, deletion. Public ranking off or isolated opt-in group.
- **Stage 2 (≈30–50 adults):** the single verified scripture workflow, human review, appeals, duplicates, evidence deletion.
- **Stage 3:** weekly/monthly/lifetime rankings, corrections, privacy settings, user reaction; decide public markets.

(Participant counts are planning suggestions, not statistical guarantees.) Recruit balanced Muslim/Christian, Arabic-first/English-first, varied tech comfort; avoid only friends/colleagues. Collect intended market separately from religion; minimal data. No public comments, DMs, or user posts in the pilot.

**Go/no-go criteria (build an in-dashboard checklist and instrumentation for each):**
1. Users understand points are game mechanics, not merit.
2. Core tasks complete in AR and EN without material translation/layout/content errors.
3. Consent, private-by-default, evidence deletion, account deletion, leaderboard opt-out pass end-to-end tests.
4. Rankings reproducible (duplicates, late verification, corrections follow documented rules).
5. Verification fair: reviewer-labelled test cases, abstention/escalation, appeals work; reviewer agreement measured.
6. Operations sustainable: review workload, turnaround, support burden, cost per submission/verified result within budget.
7. Religious content approved with documented reviewers, sources, translation review, correction process.
Failures on privacy, content integrity, or ranking correctness block expansion.

Instrument (privacy-safe, no content): D1/D7/D30 retention, weekly/monthly actives, log-completion time, review turnaround, appeal outcomes, reviewer overrides, cost per assessment, deletion completion, cost per active user.

---

## 14. Build phases and deliverables

**Phase 0 – Foundations:** monorepo (`apps/mobile`, `apps/admin`, `services/api`, `packages/shared`, `docs`), CI, linting, local Docker stack, i18n + RTL scaffold, schema + migrations, seed script (draft catalogue), auth, consent framework, feature flags, audit logging.
**Phase 1 – Core MVP:** catalogue browse/search, quick logging, append-only ledger + scoring engine (with full tests), personal dashboard, goals, achievements, privacy dashboard, deletion/export, admin content workflow, invite-only access.
**Phase 2 – Leaderboards:** public projection, opt-in A and B, weekly/monthly/lifetime, tie-break, recompute/reversal handling, per-tradition views, opt-out removal.
**Phase 3 – Scripture verification pilot:** recording, secure upload, review queue, rubric, appeals, retention jobs, AI provider interface + benchmark harness (flag off).
**Phase 4 – Hardening & store readiness:** MASVS checklist, pen-test-style authz tests, accessibility audit, AR/EN QA, load test, backup/restore drill, incident-response runbook, store assets/metadata drafts, privacy disclosures, TestFlight/internal-track builds.
**Phase 2+ backlog (design hooks only, do not build):** partner-confirmed volunteering/charity, community challenges, collective impact view, more languages/traditions, premium features, direct donations/fundraising (explicitly out of scope).

Out of scope for MVP: payments or handling donations, public social feed, messaging/comments, minors, automated verification beyond the single pilot activity.

---

## 15. Definition of done

- All phases 0–4 delivered, CI green, test suites passing (scoring, authz, retention, deletion, i18n/RTL, e2e smoke on both platforms).
- Every claim in Sections 7–10 covered by an automated test or documented manual test.
- `docs/` complete; every non-obvious choice recorded in `DECISIONS.md`.
- No catalogue item displayed as approved without a reviewer approval record.
- Final report: what was built, what is stubbed (e.g., AI provider), open risks, and a list of **human-required next steps** (religious reviewer recruitment, legal review per market, vendor data-handling review, store accounts, budget approval).

Begin with Phase 0. Before writing code, produce `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` summarizing your plan, then proceed.
