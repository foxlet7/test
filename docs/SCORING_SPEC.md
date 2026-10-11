# Scoring specification (v1)

> Points are a game mechanic that recognises recorded activity and consistency. They do **not** measure faith, sincerity, righteousness or reward from God. This sentence is shown in onboarding, the progress screen, and both ranking screens (AR + EN).

## Rules

1. **One action → one scoring event.** A log is idempotent on `(user, idempotencyKey)`.
2. **Base points only.** Each approved activity version has `base_points` (illustrative values, see catalogue) and a **repeat policy**: `per_day(max)`, `per_week(max)` (Mon–Sun UTC week of the activity date) or `per_milestone` (once per `milestoneKey`). Concurrent submissions are serialised by an advisory lock.
3. **Verification adds zero.** `verified_points` mirrors the points already awarded to that log. Leaderboard A sums `eligible_points`; B sums `verified_points`; B ⊂ A by construction (invariant checked by `/admin/ledger-check`).
4. **Late verification:** within `lateVerificationWindowDays` (default 14) of the activity date the verified points are credited to the **original** date; later, to the verification date.
5. **Dates:** the client sends its local date + tz; the server accepts `[today-maxBackdateDays (2), today+1]` (UTC today), covering UTC+14.
6. **No purchasable influence.** There is no concept of premium/subscription/ads/referral in the server code (a test greps for it). Donation amounts are not accepted.
7. **Corrections are new entries.** Reversals mirror prior buckets; restores undo specific reversals once; staff adjustments need a reason, are audited, and above `adjustmentApprovalThreshold` (20) need a second approver. No negative totals; `verified ≤ eligible` per user.
8. **Versioning.** `scoring_rule_versions` (never edited; new version effective from today or later). Activity versions are immutable once approved. Every ledger row records both versions.
9. **No guilt mechanics.** No streak counters, no point loss for absence, no negative scores. The dashboard test asserts no streak/penalty fields.

## Rankings

* Boards: **A** (all eligible), **B** (verified). Periods: weekly, monthly, lifetime. Per tradition. Opt-in per board with explicit consent; leaving removes the entry immediately and revokes the consent.
* Order: points desc → earliest `created_at` of the latest contributing entry asc → `md5(user_id)`. Only members with > 0 points in the period appear. Own rank is returned even if outside the top 50.
* Public fields: rank, pseudonym, points. Nothing else.

## Illustrative point values (placeholders — reviewers/product may change them via new content versions)

study session 5 · memorization milestone 15 · volunteering session 15 · help/kindness 5 · charity act 5 · prayer/remembrance 3. Verification difficulty is never a reason for a different value.
