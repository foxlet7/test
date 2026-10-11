# Decisions log

Each item: decision · why · alternatives/consequences. Items marked **Assumption** need a human to confirm.

1. **React Native + Expo (SDK 57), TypeScript.** One codebase for iOS/Android; `expo-audio` for recording, `expo-secure-store` for tokens. *Not run on a physical device or simulator in this build* — only typechecked and bundled with Metro/Hermes.
2. **Fastify + PostgreSQL**, plain SQL migrations (no ORM). Ledger/trigger semantics are easier to audit in SQL. PGlite (embedded Postgres) is used for tests/dev; the same suite also passes against PostgreSQL 16 (CI runs both).
3. **Server-authoritative scoring.** Clients send an activity id and a date; the server decides points, repeats and eligibility.
4. **Verification adds zero points** (ledger design above). Self-reported claims count for Leaderboard A; verified for B.
5. **Rejected verification reverses the claim's points (as ledger entries); unable-to-verify does not.** Inconclusive ≠ dishonest. An appeal that is overturned — or inconclusive after a rejection — restores them. *Assumption:* this is the right treatment of a rejected self-claim; the alternative is to keep eligible points and only deny B.
6. **Manual review baseline; AI pre-check off.** `MockProvider` exists for tests only. No real speech/assessment provider is integrated: choosing one needs the vendor review (retention, training, cross-border transfer), reviewer-labelled benchmark data, and a passing gate from `tools/benchmark.ts` (`false-accept ≤ 1%`, `false-reject ≤ 20%`, ≥30 samples per subgroup are the *defaults* in the CLI — final thresholds must be set with the reviewers).
7. **Reviewer qualification = `verification_reviewer` + the tradition role** (`islamic_reviewer` / `christian_reviewer`). Approving content or scripture tasks needs the tradition role; the author may not approve their own version; translation must be marked reviewed first.
8. **Per-activity repeat policies** (`per_day`, `per_week`, `per_milestone`), no universal cap. Donation amounts are never collected or scored (a test asserts the scoring path never reads an amount).
9. **Zakat modelled separately** (obligation class `obligatory`, once per year-milestone, no amount) from voluntary sadaqa. Wording is a draft for scholars.
10. **Tradition scopes rankings.** A user ranks only within their own tradition; changing tradition removes memberships and revokes ranking consents. Tradition is never shown on a profile — it is implied only by which board you opted into.
11. **Interface language ≠ religious content.** Language is a profile setting; content packages are keyed by tradition.
12. **Adults only.** Registration requires `adultConfirmed` (self-declaration). No stronger age assurance is built. *Assumption:* acceptable for a private pilot.
13. **Invite-only access** via `invites` (max uses, stage, deactivate). Staff are created with `npm run staff:create` (CLI) — there is no public staff signup.
14. **Reminders are local notifications, opt-in, gentle copy.** No server push, no streaks, no penalties.
15. **Evidence storage:** local disk or S3 behind one interface, always AES-256-GCM encrypted by the app. The S3 adapter is implemented but **untested against a real bucket**.
16. **Not built (explicitly out of scope):** payments or donation handling, social feed, DMs/comments, minors, automated verification beyond the pilot activity, email delivery for password recovery (the recovery token is returned only outside production; in production it must be delivered by a mail provider — a stub comment marks the spot), partner-confirmed volunteering/charity (class C hooks exist in the schema only).
17. **Retention defaults:** recitation audio = decision + 14 days (`APPEAL_WINDOW_DAYS`); pending evidence safety cap 60 days; receipts/confirmations types exist in the schema but no receipt workflow is built, so no retention logic beyond the shared job.
18. **Backups:** erased accounts are tracked as a one-way hash in `deletion_requests` so a restore can re-apply erasure (procedure in RUNBOOK). Backups must age out within 30 days.
19. **Dependency advisories:** production API dependencies audit clean; remaining advisories sit in Expo/Metro build tooling and Next's PostCSS (build-time) — see `SECURITY.md`.
