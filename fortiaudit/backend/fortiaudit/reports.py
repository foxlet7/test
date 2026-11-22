"""Report generation: JSON, CSV, HTML (self-contained) and PDF. All output is redacted."""
from __future__ import annotations

import csv
import datetime as dt
import html
import io
import json

from .audit import LIMITATIONS, coverage
from .redact import redact_lines

MODULE_NAMES = {"A": "System & administration", "B": "Interfaces", "C": "Zones", "D": "Address objects",
                "E": "Firewall policies", "F": "Routing", "G": "IPsec VPN", "H": "NAT, VIPs & IP pools",
                "I": "DHCP & DNS", "J": "Security profiles", "K": "High availability", "Dependency": "Dependency integrity",
                "Parser": "Parsing & baseline"}
SECTION_ORDER = ["Parser", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "Dependency"]


def _src(model, f, n=3):
    out = []
    for ln in f.lines[:n]:
        if 1 <= ln <= len(model.pc.lines):
            out.append(f"{ln}: " + redact_lines([model.pc.lines[ln - 1]])[0].strip())
    return out


def build(result, project: dict, changelog: list[dict]) -> dict:
    ctx = result.ctx
    m = ctx.m
    from .inventory import dashboard
    dash = dashboard(ctx, result)
    fs = []
    for f in result.findings:
        d = f.to_dict()
        d["source"] = _src(m, f)
        d["changes"] = [ctx.changes[c].to_dict() for c in f.changes if c in ctx.changes]
        fs.append(d)
    return {"generated": dt.datetime.now().isoformat(timespec="seconds"), "tool": "FortiAudit (offline)",
            "project": {k: project.get(k) for k in ("id", "name", "filename", "sha256", "imported_at")},
            "dashboard": dash, "findings": fs, "coverage": coverage(m), "changelog": changelog,
            "limitations": LIMITATIONS}


def to_json(rep) -> str:
    return json.dumps(rep, indent=2, default=str)


def to_csv(rep) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "severity", "confidence", "classification", "module", "rule", "title", "objects", "lines",
                "detail", "recommendation", "impact", "auto_remediation", "evidence"])
    for f in rep["findings"]:
        w.writerow([f["id"], f["severity"], f["confidence"], f["classification"], MODULE_NAMES.get(f["module"], f["module"]),
                    f["rule"], f["title"], "; ".join(f["objects"]), " ".join(map(str, f["lines"])), f["detail"],
                    f["recommendation"], f["impact"], f["auto_remediation"], f["evidence"]])
    return buf.getvalue()


def _e(s):
    return html.escape(str(s if s is not None else ""))


def to_html(rep) -> str:
    d = rep["dashboard"]
    idn, s = d["identity"], d["summary"]
    by = s["by_severity"]
    rows = []
    for mod in SECTION_ORDER:
        group = [f for f in rep["findings"] if f["module"] == mod]
        if not group:
            continue
        rows.append(f"<h2>{_e(MODULE_NAMES.get(mod, mod))} <small>({len(group)})</small></h2>")
        for f in group:
            src = "".join(f"<code>{_e(x)}</code><br>" for x in f["source"])
            chg = "".join(f"<details><summary>Proposed change {c['id']} ({_e(c['risk'])} risk)</summary><pre>{_e(c['commands'])}</pre>"
                          f"<b>Rollback</b><pre>{_e(c['rollback'])}</pre></details>" for c in f["changes"])
            rows.append(
                f"<div class='f {f['severity']}'><div class='h'><span class='sev'>{f['severity'].upper()}</span> "
                f"<b>{_e(f['title'])}</b> <span class='id'>{f['id']}</span></div>"
                f"<div class='meta'>{_e(f['classification'])} · confidence {f['confidence']} · {_e(f['evidence'])} · "
                f"auto-remediation: {_e(f['auto_remediation'])}</div>"
                f"<p>{_e(f['detail'])}</p><p><b>Recommendation:</b> {_e(f['recommendation'])}</p>"
                + (f"<p><b>Operational impact:</b> {_e(f['impact'])}</p>" if f["impact"] else "")
                + f"<div class='objs'>Objects: {_e(', '.join(f['objects']))}</div><div class='src'>{src}</div>{chg}</div>")
    counts = "".join(f"<tr><td>{_e(k)}</td><td>{v}</td></tr>" for k, v in d["counts"].items())
    cl = "".join(f"<tr><td>{_e(c.get('change_id'))}</td><td>{_e(c.get('status'))}</td><td>{_e(c.get('title'))}</td>"
                 f"<td>{_e(c.get('at'))}</td></tr>" for c in rep["changelog"]) or "<tr><td colspan=4>No approved changes.</td></tr>"
    lim = "".join(f"<li>{_e(x)}</li>" for x in rep["limitations"] + idn.get("warnings", []))
    cov = rep["coverage"]
    crit = by["critical"] + by["high"]
    exec_sum = (f"The configuration of <b>{_e(idn.get('hostname'))}</b> (FortiGate {_e(idn.get('model'))}, FortiOS "
                f"{_e(idn.get('version'))} build {_e(idn.get('build'))}) was analysed offline. {s['total']} findings were "
                f"produced: {by['critical']} critical, {by['high']} high, {by['medium']} medium, {by['low']} low and "
                f"{by['info']} informational ({s['optimizations']} optimisation opportunities). "
                + ("Critical/high findings require prompt engineering review. " if crit else "")
                + "This is a static configuration audit; it does not establish that the firewall is healthy at runtime.")
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>FortiAudit report</title>
<style>body{{font:14px/1.45 system-ui,Segoe UI,Arial;margin:32px;color:#1b2330;max-width:1100px}}h1{{margin:0}}
h2{{border-bottom:2px solid #d8dee8;padding-bottom:4px;margin-top:32px}}table{{border-collapse:collapse}}td{{border:1px solid #d8dee8;padding:3px 8px}}
.f{{border-left:5px solid #999;background:#f7f9fc;margin:10px 0;padding:8px 12px}}.critical{{border-color:#7a0010}}.high{{border-color:#d7263d}}
.medium{{border-color:#f49d37}}.low{{border-color:#3f88c5}}.info{{border-color:#8a94a6}}.sev{{font-weight:700;font-size:11px}}
.id{{color:#8a94a6;font-size:11px}}.meta,.objs{{color:#56607a;font-size:12px}}code,pre{{font:12px ui-monospace,Consolas,monospace;background:#eef2f8}}
pre{{padding:6px;white-space:pre-wrap}}</style></head><body>
<h1>FortiGate configuration audit</h1><p>Generated {_e(rep['generated'])} · project {_e(rep['project'].get('name'))} ·
file {_e(rep['project'].get('filename'))} (sha256 {_e((rep['project'].get('sha256') or '')[:16])}…)</p>
<h2>1. Executive summary</h2><p>{exec_sum}</p><p>Static health indicator: <b>{s['health_score']}/100</b> — {_e(s['health_note'])}</p>
<h2>2–3. Device and firmware identification</h2><table>
<tr><td>Hostname</td><td>{_e(idn.get('hostname'))}</td></tr><tr><td>Platform / model</td><td>{_e(idn.get('platform'))} / {_e(idn.get('model'))}</td></tr>
<tr><td>FortiOS</td><td>{_e(idn.get('version'))} build {_e(idn.get('build'))}</td></tr><tr><td>VDOM mode</td><td>{_e(idn.get('vdom_mode'))}</td></tr>
<tr><td>Baseline match (7.4.12 b2902 / 121G)</td><td>{'yes' if idn.get('baseline_match') else 'NO'}</td></tr></table>
<h2>4. Configuration statistics</h2><table>{counts}</table>
<p>Analysed tables: {len(cov['analysed_tables'])}; parsed but not analysed: {len(cov['parsed_not_analysed'])}; unrecognised lines: {len(cov['unrecognised_lines'])}</p>
{''.join(rows)}
<h2>Risk assessment</h2><p>Critical {by['critical']} · High {by['high']} · Medium {by['medium']} · Low {by['low']} · Info {by['info']}</p>
<h2>Change log</h2><table><tr><td><b>Change</b></td><td><b>Status</b></td><td><b>Title</b></td><td><b>When</b></td></tr>{cl}</table>
<h2>Validation limitations</h2><ul>{lim}</ul>
<p style="color:#8a94a6">Secrets (passwords, PSKs, keys, SNMP communities, certificates) are redacted from this report.</p></body></html>"""


def to_pdf(rep) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title="FortiAudit report")
    st = getSampleStyleSheet()
    small = st["BodyText"].clone("small", fontSize=8, leading=10)
    d = rep["dashboard"]
    idn, s = d["identity"], d["summary"]
    el = [Paragraph("FortiGate configuration audit", st["Title"]),
          Paragraph(f"{_e(idn.get('hostname'))} · FortiGate {_e(idn.get('model'))} · FortiOS {_e(idn.get('version'))} build "
                    f"{_e(idn.get('build'))} · generated {_e(rep['generated'])}", st["BodyText"]), Spacer(1, 6),
          Paragraph("Executive summary", st["Heading2"]),
          Paragraph(f"{s['total']} findings: " + ", ".join(f"{v} {k}" for k, v in s["by_severity"].items())
                    + f". Static health indicator {s['health_score']}/100 (not a runtime health statement).", st["BodyText"])]
    t = Table([[k, str(v)] for k, v in d["counts"].items()], colWidths=[60 * mm, 30 * mm])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 8)]))
    el += [Paragraph("Configuration statistics", st["Heading2"]), t]
    sevc = {"critical": "#7a0010", "high": "#d7263d", "medium": "#f49d37", "low": "#3f88c5", "info": "#8a94a6"}
    for mod in SECTION_ORDER:
        group = [f for f in rep["findings"] if f["module"] == mod]
        if not group:
            continue
        el.append(Paragraph(f"{_e(MODULE_NAMES.get(mod, mod))} ({len(group)})", st["Heading2"]))
        for f in group:
            el.append(Paragraph(f"<font color='{sevc[f['severity']]}'><b>{f['severity'].upper()}</b></font> "
                                f"<b>{_e(f['title'])}</b> <font size=7 color='#888888'>{f['id']}</font>", st["BodyText"]))
            el.append(Paragraph(f"{_e(f['classification'])} · confidence {f['confidence']} · auto: {_e(f['auto_remediation'])}", small))
            el.append(Paragraph(_e(f["detail"]), small))
            el.append(Paragraph("<b>Recommendation:</b> " + _e(f["recommendation"]), small))
            for x in f["source"]:
                el.append(Paragraph("<font face='Courier' size=7>" + _e(x) + "</font>", small))
            el.append(Spacer(1, 4))
    el.append(Paragraph("Change log", st["Heading2"]))
    for c in rep["changelog"] or [{"change_id": "-", "status": "none", "title": "No approved changes"}]:
        el.append(Paragraph(f"{_e(c.get('change_id'))} {_e(c.get('status'))} {_e(c.get('title'))}", small))
    el.append(Paragraph("Validation limitations", st["Heading2"]))
    for x in rep["limitations"] + idn.get("warnings", []):
        el.append(Paragraph("• " + _e(x), small))
    doc.build(el)
    return buf.getvalue()
