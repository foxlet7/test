# Runbook

## Deploy
`docker compose up --build` (needs `JWT_SECRET`, `EVIDENCE_KEY_HEX`) or run `services/api/dist/server.js` with `.env.example` variables. Migrations run at start. Then:
```
npm run seed:catalogue -w @gdc/api                       # draft catalogue (idempotent)
STAFF_PASSWORD=... npm run staff:create -w @gdc/api -- you@org.example nick super_admin
```
Terminate TLS in front of the API and admin. Set `CORS_ORIGINS` to the admin origin only.
(Docker/compose files are provided but were **not built in the authoring sandbox**; CI builds the API bundle, admin and mobile bundle.)

## Routine
* **Retention** runs hourly; check *Operations → Evidence retention* — "Overdue" must be 0. Manual: `POST /admin/retention/run`.
* **Review queue** *Operations → Review queue*; escalate if the oldest open task exceeds the agreed target (suggested: 3 days).
* **Backups:** nightly `pg_dump`; object-store versioning for blobs with lifecycle ≤ 30 days; run `tools/backup-restore-drill.sh` quarterly. (Drill verified locally: dump → restore to scratch DB → row counts match.)
* **Restore procedure:** restore DB → `POST /admin/retention/run` (re-deletes expired blobs) → re-apply erasures: for every row in `deletion_requests` created after the backup, delete the account again (hash match is not reversible; keep the deletion log outside the DB too, e.g. support tickets).
* **Rotate `JWT_SECRET`:** all sessions end; acceptable. **Rotate `EVIDENCE_KEY_HEX`:** old blobs become unreadable — only rotate after pending reviews are done and old evidence has expired, or re-encrypt offline.

## Incident response
1. **Detect/triage:** severity 1 = suspected exposure of evidence/private notes or ranking data; sev 2 = ledger/ranking incorrectness; sev 3 = availability.
2. **Contain:** deactivate invites, suspend implicated users (`/admin/users/:id/status`), disable `ai_*` flags, rotate secrets, revoke refresh tokens (`update refresh_tokens set revoked_at=now()`).
3. **Assess** with *Operations → Audit log* (who accessed evidence: `evidence.url_issued/accessed`), DB logs, object-store access logs.
4. **Notify:** affected users and regulators as the applicable law requires (e.g. GDPR 72h) — counsel decides; religious data raises the stakes.
5. **Recover & learn:** blameless post-mortem; add a regression test.
* **Ledger problem:** run *Operations → Ledger recomputation check*; fix with audited adjustments (second approver for large) — never edit rows.

## Cost & capacity
Local load test (`tools/loadtest.mjs`; 40 virtual users × 15 rounds, API bundle on PostgreSQL 16, one small shared VM): 2,480 requests, ~416 req/s, **0 server errors**, read p95 ≈ 137 ms, write p95 ≈ 119 ms, registration p50 ≈ 800 ms (scrypt is deliberately CPU-heavy). This is a smoke-level number, not a capacity plan: repeat on staging. Measure human review cost from *Pilot → avg review time* × reviewer rate; AI cost per assessment must come from the provider invoice (no provider integrated).
