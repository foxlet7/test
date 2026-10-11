# Private pilot protocol

Access is invitation-only (`invites`: code, max uses, stage, deactivate; kill switch = deactivate all invites + suspend users). Numbers are planning suggestions, not statistical guarantees.

| Stage | Participants | What to test | Notes |
|---|---|---|---|
| 1 — usability | ~20–30 adults | onboarding, AR/EN, private logging, consents, deletion | rankings off or isolated opt-in group; invite stage 1 |
| 2 — verification | ~30–50 adults | one scripture workflow: human review, appeals, duplicates, evidence deletion | task content must be approved by qualified reviewers first |
| 3 — rankings | stage 2 group | weekly/monthly/lifetime, corrections, privacy settings, user reaction | decide public markets afterwards |

**Recruit** balanced Muslim/Christian, Arabic-first/English-first, varied tech comfort; not only friends/colleagues; record intended market separately from religion; minimal data. No comments, DMs or user posts in the pilot.

## Before Stage 1 (humans)
1. Qualified reviewers recruited; approve (or change) the draft catalogue through the admin dashboard; translation review done.
2. Legal/privacy review per market (see `PRIVACY.md`); vendor check for hosting.
3. Create staff accounts (`npm run staff:create -w @gdc/api`), create invite codes, seed catalogue (`npm run seed:catalogue -w @gdc/api`).
4. Set the privacy notice/terms URLs shown in the apps (placeholders today).

## Go/no-go (dashboard → Pilot, checklist is persisted and audited)
1. Users understand points are game mechanics, not merit — *interviews/survey; the disclaimer is shown on 4 screens.*
2. AR and EN core tasks work — *manual device test on both languages (RTL) required; automated: key parity + placeholder tests.*
3. Consent, private-by-default, evidence deletion, account deletion, ranking opt-out — *automated API tests exist; re-run on devices.*
4. Rankings reproducible — *`/admin/ledger-check` + tests for duplicates, late verification, corrections, boundaries.*
5. Verification fair — *needs reviewer-labelled cases and `tools/benchmark.ts` if/when AI is considered; agreement between reviewers must be measured (not yet instrumented beyond appeal-overturn rate).*
6. Operations sustainable — *dashboard: review turnaround, open tasks, appeal outcomes; cost per assessment requires provider billing data.*
7. Religious content approved — *dashboard → Content shows approvals; reviewer sign-off is a human process.*

A failure on privacy, content integrity or ranking correctness blocks expansion; usability issues justify another iteration.
