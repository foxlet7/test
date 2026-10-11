#!/usr/bin/env bash
# Backup/restore drill: dump the database, restore into a scratch database, and compare table row counts.
# Usage: DATABASE_URL=postgres://... ./tools/backup-restore-drill.sh
# Run quarterly and after schema changes. Evidence blobs are backed up separately (object-store versioning) and are
# deliberately short-lived (see retention policy) — a restore must be followed by `POST /admin/retention/run`
# so blobs that expired since the backup are removed again, and by re-applying account-deletion requests
# (table deletion_requests keeps a one-way hash so erased accounts are not resurrected; see docs/RUNBOOK.md).
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
SCRATCH="gdc_restore_$(date +%s)"
DUMP="$(mktemp)"
withdb() { echo "$1" | sed -E "s#(://[^/]*/)[^?]*#\1$2#"; }   # swap the database name, keep any ?query
ADMIN_URL="${ADMIN_URL:-$(withdb "$DATABASE_URL" postgres)}"
trap 'rm -f "$DUMP"; psql "$ADMIN_URL" -qc "drop database if exists $SCRATCH" || true' EXIT
pg_dump --no-owner --format=custom "$DATABASE_URL" -f "$DUMP"
psql "$ADMIN_URL" -qc "create database $SCRATCH"
RESTORE_URL="$(withdb "$DATABASE_URL" "$SCRATCH")"
pg_restore --no-owner -d "$RESTORE_URL" "$DUMP"
count() { psql "$1" -Atc "select 'users',count(*) from users union all select 'ledger',count(*) from ledger_entries union all select 'logs',count(*) from activity_logs union all select 'versions',count(*) from activity_versions order by 1"; }
A="$(count "$DATABASE_URL")"; B="$(count "$RESTORE_URL")"
if [ "$A" = "$B" ]; then echo "RESTORE DRILL OK"; echo "$B"; else echo "MISMATCH"; diff <(echo "$A") <(echo "$B") || true; exit 1; fi
