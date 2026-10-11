# Data inventory

| Data | Table.column | Purpose | Who can access | Retention / deletion |
|---|---|---|---|---|
| Email | users.email | sign-in, recovery | the user; no staff UI shows it | deleted with account |
| Password | users.password_hash (scrypt) | sign-in | nobody | with account |
| Pseudonym | profiles.pseudonym | public ranking name (no real name required) | public only if user opted into a ranking | with account |
| Tradition, UI language, weekly goal | profiles | personalise content/language | the user; tradition is implied (not shown) on rankings | with account |
| Adult confirmation | profiles.adult_confirmed_at | age policy | staff (audit) | with account |
| Consents | consents | proof of choice per purpose (account, evidence, ai_processing, leaderboard_A/B) | the user, auditors | with account; revoked rows kept until deletion |
| Activity logs | activity_logs | record deeds | the user | with account |
| Private notes | activity_logs.note | personal reflection | **only the user**; never in scoring, exports to staff, or logs | user can clear any time; deleted with account |
| Ledger | ledger_entries | points history | the user (own), staff by role | with account (purged in erasure tx) |
| Recitation audio | evidence_objects (+ encrypted blob) | verification | assigned qualified reviewer via 5-min signed URL; every access audited | **decision + 14 days**, safety cap 60 days; user can delete earlier unless review pending |
| Audio fingerprint | evidence_objects.sha256 | duplicate/replay detection | system | kept after blob deletion; deleted with account |
| Review decisions | review_decisions | audit of verification | staff by role | with account (cascade) |
| Appeals | appeals | due process | the user, reviewers | with account |
| Ranking membership | leaderboard_memberships | opt-in | system | deleted on leave/consent revoke/tradition change |
| Reports | reports | content/translation/abuse | moderators | user link set null on deletion |
| Audit log | audit_logs | staff accountability | auditors | no private content; actor ids of staff only |
| Deletion proof | deletion_requests.user_ref | prove erasure | super admin | one-way SHA-256 of the id only |

Not collected: real name, phone, location, contacts, device identifiers, advertising IDs, donation amounts, receipts (no receipt workflow yet). No third-party analytics/ads SDKs. Admin pilot metrics are aggregate counts only.
