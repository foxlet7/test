# NOC Platform

Self-hosted network monitoring with a NOC wall, alerting and **circuit cost / SLA tracking**.
Install it once, deploy small probes at your sites (or your customers' sites), add devices and
sensors in the browser.

Status: **milestone 1 (core)**. It works end to end, but it is not yet a sellable v1. See [Roadmap](#roadmap).

## What it does today

| Area | Included |
|---|---|
| Monitoring | Ping (latency, loss), SNMP v2c/v3 interface traffic (by name or ifIndex, 64-bit counters), any numeric SNMP OID, SNMP uptime / reboot detection, HTTP(S) status + response time + keyword + TLS expiry, TCP port, DNS |
| Probes | Single Go binary for Linux / Windows (service) / Docker; outbound HTTPS only; buffers results while the server is unreachable; token per probe, rotatable |
| Status engine | Thresholds (warn/down, above/below), confirm-before-DOWN (N failed checks), probe-side warnings (cert expiry, packet loss, reboot) |
| NOC wall | Kiosk page grouped by site, health line per site, faults as solid blocks, active alerts, stale-data and offline-probe banners |
| Circuits & cost | Monthly cost, bandwidth, SLA %, credit %, contract dates per link; availability from your own probe data; downtime cost; SLA verdict + credit to claim (only with ≥ 90 % monitoring coverage); p95 utilisation and real cost per used Mbit/s; contract-expiry notice |
| Alerts | Status-change log with acknowledge; Microsoft Teams and generic JSON webhooks (problem + recovery) |
| Access | Users with Admin / Operator / Viewer roles, scrypt password hashing, httpOnly session cookies; every row is tenant-scoped (multi-tenant ready) |

## Install (server)

```bash
cp .env.example .env            # set POSTGRES_PASSWORD, PUBLIC_URL, COOKIE_SECURE
docker compose up -d --build    # PostgreSQL/TimescaleDB + server; migrations run on start
```

Open `PUBLIC_URL`. The first visit runs setup (organisation + admin account).
Put the server behind HTTPS (reverse proxy or load balancer) before probes connect across the internet:
probe tokens and SNMP credentials travel over that connection.

## Install (probe)

Create a probe on **Probes** and copy its token (shown once). The page shows the exact commands for
Docker, Linux (systemd unit in `probe/noc-probe.service`) and Windows (runs as the `NocProbe` service).
The probe reads `NOC_SERVER` / `NOC_TOKEN` from the environment or from `noc-probe.env`
(next to the executable, or `/etc/noc-probe.env`).

Build the binaries:

```bash
cd probe
CGO_ENABLED=0 go build -o noc-probe .
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o noc-probe.exe .
```

## Architecture

```
browser ──► server (Next.js + Prisma) ──► PostgreSQL (+ TimescaleDB hypertable for measurements)
                 ▲  GET /api/probe/config   (every 60 s, work list)
                 │  POST /api/probe/results (every 5 s, batched)
            probe (Go) ──► devices: ICMP, SNMP (UDP 161), HTTP(S), TCP, DNS
```

- `server/prisma/schema.prisma`: data model (tenants, users, sites, probes, devices, sensors, measurements, circuits, alerts, channels)
- `server/src/lib/status.ts`: status engine (pure, unit-tested)
- `server/src/lib/billing.ts`: availability and circuit economics (pure, unit-tested)
- `server/src/lib/ingest.ts`: result ingestion; a probe can only write to sensors of devices assigned to it
- `probe/`: the probe (checks, scheduler, buffering client, Windows service)

## Development

```bash
cd server
echo 'DATABASE_URL="postgresql://noc@127.0.0.1:5432/noc?schema=public"' > .env
npm ci && npx prisma migrate deploy && npm run dev
npm test               # status + billing engines
npm run typecheck

cd ../probe
go test ./...                                   # unit + local network tests
NOC_SNMP_TEST=127.0.0.1:1161 go test ./...      # + SNMP v2c/v3 against an agent (e.g. snmpsim)
```

## Security notes

- Probe tokens and sessions are stored only as SHA-256 hashes; passwords use scrypt.
- Failed logins are throttled (5 per account and 20 per source address per 15 minutes, per server instance).
- All queries are scoped to the user's tenant; role checks guard every change.
- SNMP credentials are stored in the database and sent to the assigned probe. Encrypting them at rest is on the roadmap.
- Use HTTPS in production and set `COOKIE_SECURE=1`.

## Roadmap

| Milestone | Scope |
|---|---|
| M1 core (this) | Done: model, probe (Ping/SNMP/HTTP/TCP/DNS), status engine, NOC wall, devices/sensors UI, circuits & cost, alerts + webhooks, users/roles, Docker install |
| M1 remaining | Email (SMTP) alerts, measurement retention and downsampling, SNMP secrets encrypted at rest, audit log, image build in CI |
| M2 commercial | Monthly management report (PDF) per site/group, PRTG importer (migration tool), budget vs actual, multi-currency, invoice-style statements |
| M3 coverage | SSH command sensors, WinRM/PowerShell (Windows), SIP OPTIONS / trunk registration, FreeSWITCH/SBC templates, device templates (FortiGate, Cisco, MikroTik), subnet discovery |
| M4 scale & sell | Licence keys and tiers, MSP portals and white-label, AI NOC assistant, HA, SSO (Entra ID) |
