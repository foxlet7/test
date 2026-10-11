# Architecture

```
apps/mobile  (Expo / React Native, iOS + Android, AR/EN with RTL)
apps/admin   (Next.js staff dashboard: content governance, review queue, moderation, ops)
services/api (Fastify + PostgreSQL; the only thing that writes points)
packages/shared (types, pure scoring/date/period helpers, UI strings AR+EN)
tools/       (e2e smoke, load test, AI benchmark gate, backup/restore drill)
```

## Three systems, three data boundaries

1. **Faith & activity catalogue** — `activity_definitions` + immutable `activity_versions` (draft → in_review → approved → retired), `review_records`, `scripture_tasks`. It is data, never code. Approved versions cannot be edited (DB trigger); a change is a new version, and approval retires the old one.
2. **Activity & verification engine** — `activity_logs`, append-only `ledger_entries`, `verification_submissions`, `review_tasks/decisions`, `appeals`, `evidence_objects`. Scoring is server-authoritative; clients never send points.
3. **Growth & community** — dashboard/achievements are computed from logs, rankings from the `v_public_scores` view over opt-in memberships.

| Boundary | Tables | Who can read |
|---|---|---|
| Private records | `activity_logs.note`, `evidence_*`, `consents` | the user; reviewers see only the recording + rubric for an assigned task (no identity) |
| Scoring/verification | `ledger_entries`, `review_*`, `audit_logs` | staff by role (`auditor`, `moderator`, …) |
| Public projection | `v_public_scores` (pseudonym, tradition, period score) | the leaderboard endpoint only; never returns account ids |

## Ledger model (the core invariant)

`ledger_entries(eligible_points, verified_points, effective_date, kind)`; kinds: `award`, `verification`, `reversal`, `adjustment`.

* An **award** carries the activity's base points as `eligible_points` (Leaderboard A).
* **Verification** adds an entry with `eligible_points = 0` and `verified_points = the points already awarded` (Leaderboard B). It can never add points, so B ⊂ A and verification is never a multiplier. Idempotent.
* **Reversal/adjustment** mirror or correct entries; history is never edited (trigger rejects UPDATE/DELETE; DELETE is allowed only inside the account-erasure transaction).
* Every entry stores the `rule_version` and `activity_version_id` used.
* `GET /admin/ledger-check` recomputes leaderboards independently in memory and compares them with SQL.

## Verification pilot (scripture recitation milestone)

user logs milestone (self-reported, counts for A) → optional recitation upload (consent `evidence`) → `pending_review` task → qualified reviewer decides → `verified | unable_to_verify | rejected | under_investigation` → appeal (fresh reviewer, original excluded) → retention timers delete audio. **Human review is the baseline.** The AI pre-check is an interface (`AssessmentProvider`) behind flags `ai_precheck` / `ai_auto_verify`, both OFF; it can abstain and never rejects.

## Stack choices

TypeScript everywhere; PostgreSQL 16 (PGlite embedded only for dev/tests, refused in production); Fastify + zod validation; scrypt password hashing; short-lived JWT access tokens (roles re-read from the DB each request) + rotating refresh tokens; AES-256-GCM client-side encryption of evidence before it reaches local disk or S3. See `DECISIONS.md`.

## Ranking periods

Weekly = Monday 00:00–Sunday UTC, monthly = calendar month UTC, lifetime. The ranking date is the activity's `local_date` (device-local date), bounded to `[today-2d, today+1d]` UTC to stop backdating. Tie-break: points → earliest time the total was reached → md5(account id). The UI shows the period end (cutoff) in the viewer's locale.
