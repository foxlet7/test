#!/usr/bin/env bash
# Start FortiAudit locally (http://127.0.0.1:8765). Offline; binds to localhost only.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; fi
cd backend && exec ../.venv/bin/python -m fortiaudit.api "$@"
