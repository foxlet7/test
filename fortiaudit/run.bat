@echo off
rem Start FortiAudit locally (http://127.0.0.1:8765). Offline; binds to localhost only.
cd /d %~dp0
if not exist .venv ( py -3 -m venv .venv && .venv\Scripts\pip install -q -r requirements.txt )
cd backend
..\.venv\Scripts\python -m fortiaudit.api %*
