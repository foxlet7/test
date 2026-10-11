# Privacy design, retention and store disclosures (draft)

> **Not legal advice.** Religious beliefs and practices are sensitive personal data in many jurisdictions (e.g. GDPR Art. 9; the Saudi PDPL treats data revealing religious belief as sensitive). A private pilot is not an exemption. Qualified counsel must review hosting location, lawful basis/explicit consent wording, vendors and cross-border transfers **before inviting participants in each market.**

## Principles implemented

* **Private by default.** Nothing is public until the user separately opts into each ranking; public data = nickname, rank, score.
* **Separate, revocable consents** for account, evidence upload, AI processing, ranking A, ranking B. Revoking a ranking consent removes the entry immediately.
* **Minimal evidence.** Never required for private deeds; only for the opt-in scripture verification. Pre-permission explainer before microphone use.
* **Short retention** (table in `DATA_INVENTORY.md`), enforced by an hourly job and testable at `/admin/retention`. User-initiated early deletion: `DELETE /me/evidence`.
* **Account deletion:** in-app (`DELETE /me`, Me → Delete my account) and web (`/delete-account` page → `POST /public/deletion-request`). Erases profile, logs, notes, ledger, consents, memberships, evidence rows and blobs. Pending appeals do not block deletion. Backups age out within 30 days; restores must re-apply `deletion_requests`.
* **Export:** `GET /me/export` (Me → Export my data).
* **Encryption:** TLS in transit (terminate at the proxy — required); AES-256-GCM on every evidence blob before it touches disk/S3; passwords scrypt-hashed.
* **No evidence/private content in logs** (request bodies are not logged; Authorization header redacted; audit entries carry ids only).
* **No data sale, no faith-based ad targeting, no ad/analytics SDKs.**
* **AI providers** (none integrated): must not train on audio, retention documented in `DECISIONS.md`; separate `ai_processing` consent already gates any call.

## Draft store disclosures (verify before submission)

**Apple privacy labels:** Contact info — email (app functionality, linked to user); User content — audio data (app functionality, linked, optional), other user content — activity notes (app functionality, linked); Identifiers — user ID; Sensitive info — *religious practices* are inferable from content: declare accordingly. Tracking: **none**.
**Google Play Data safety:** collects email, user IDs, audio (optional), app activity; data encrypted in transit; users can request deletion (in-app + web URL `/delete-account`); not shared with third parties; no ads. Declare sensitive-data handling for religious content.
