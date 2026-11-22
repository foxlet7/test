"""Local HTTP API (FastAPI). Binds to 127.0.0.1 only. No outbound network access, no device connectivity."""
from __future__ import annotations

import ipaddress as ipa
import threading
from collections import OrderedDict
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import inventory, remediation, reports
from .audit import LIMITATIONS, coverage, run_audit
from .diff import ha_compare, semantic_diff
from .model import ConfigModel
from .parser import parse
from .redact import is_sensitive, redact_lines
from .sim import simulate
from .store import Store

MAX_UPLOAD = 64 * 1024 * 1024
FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
MODES = ("audit", "assisted", "auto")

app = FastAPI(title="FortiAudit", docs_url="/api/docs", openapi_url="/api/openapi.json")
store: Store | None = None
_cache: "OrderedDict[str, tuple]" = OrderedDict()
_lock = threading.Lock()


def get_store() -> Store:
    global store
    if store is None:
        store = Store()
    return store


@app.middleware("http")
async def local_only(request: Request, call_next):
    host = (request.headers.get("host") or "").split(":")[0]
    if host not in ("127.0.0.1", "localhost", "testserver", "::1", "[::1]"):
        return JSONResponse({"detail": "FortiAudit only serves localhost (DNS-rebinding protection)"}, 403)
    if request.method in ("POST", "PUT", "DELETE") and request.headers.get("x-fortiaudit") != "1":
        return JSONResponse({"detail": "missing X-FortiAudit header (CSRF protection)"}, 403)
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
    return resp


def decode_upload(data: bytes) -> str:
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "file too large")
    if b"\x00" in data:
        raise HTTPException(400, "binary file rejected: not a FortiOS text configuration")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("utf-8", "surrogateescape")
    if text.startswith("﻿"):
        text = text[1:]
    head = "\n".join(text.splitlines()[:40])
    if "config " not in text[:200000] and "#config-version" not in head:
        raise HTTPException(400, "file does not look like a FortiOS CLI configuration backup")
    return text


def loaded(cid: str):
    with _lock:
        if cid in _cache:
            _cache.move_to_end(cid)
            return _cache[cid]
    c = get_store().config(cid)
    if c is None:
        raise HTTPException(404, "configuration not found")
    p = get_store().project(c["project_id"])
    model = ConfigModel(parse(c["text"]))
    if p and p.get("vdom") and p["vdom"] in model.vdoms:
        model.active = p["vdom"]
    res = run_audit(model)
    with _lock:
        _cache[cid] = (c, model, res)
        while len(_cache) > 6:
            _cache.popitem(last=False)
    return _cache[cid]


def _entry_json(e, depth=0):
    attrs = []
    for k, a in e.attrs.items():
        val = "<redacted>" if is_sensitive(e.table.path, k) or (a.values[:1] == ["ENC"]) else " ".join(a.values)
        attrs.append({"name": k, "value": val, "op": a.op, "line": a.line})
    sub = {}
    if depth < 3:
        for sn, st in e.sub.items():
            sub[sn] = {"attrs": [{"name": k, "value": " ".join(a.values), "line": a.line} for k, a in st.attrs.items()],
                       "entries": [_entry_json(x, depth + 1) for x in st]}
    return {"uid": e.uid, "key": e.key, "line": e.node.line, "end_line": e.node.end_line, "attrs": attrs, "sub": sub}


# ------------------------------------------------------------------ projects
class ProjectIn(BaseModel):
    name: str


@app.get("/api/health")
def health():
    return {"ok": True, "offline": True, "limitations": LIMITATIONS}


@app.get("/api/projects")
def projects():
    return get_store().projects()


@app.post("/api/projects")
def create_project(p: ProjectIn):
    return {"id": get_store().create_project(p.name.strip()[:120] or "Untitled")}


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    s = get_store()
    for c in s.projects():
        if c["id"] == pid:
            for cc in c["configs"]:
                _cache.pop(cc["id"], None)
    s.delete_project(pid)
    return {"deleted": pid}


class ModeIn(BaseModel):
    mode: str
    vdom: str | None = None


@app.post("/api/projects/{pid}/settings")
def project_settings(pid: str, m: ModeIn):
    if m.mode not in MODES:
        raise HTTPException(400, f"mode must be one of {MODES}")
    s = get_store()
    s.set_mode(pid, m.mode)
    if m.vdom is not None:
        s.set_vdom(pid, m.vdom)
        for c in s.projects():
            if c["id"] == pid:
                for cc in c["configs"]:
                    _cache.pop(cc["id"], None)
    return s.project(pid)


@app.post("/api/projects/{pid}/configs")
async def upload(pid: str, file: UploadFile = File(...), role: str = Form("primary")):
    if get_store().project(pid) is None:
        raise HTTPException(404, "project not found")
    if role not in ("primary", "secondary", "revision", "modified"):
        raise HTTPException(400, "invalid role")
    data = await file.read()
    text = decode_upload(data)
    try:
        parse(text)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    name = Path(file.filename or "config.conf").name[:200]
    cid = get_store().add_config(pid, role, name, text)
    _, model, res = loaded(cid)
    return {"id": cid, "identity": model.identity(), "summary": res.summary()}


# ------------------------------------------------------------------ views
@app.get("/api/configs/{cid}/dashboard")
def dashboard(cid: str):
    c, model, res = loaded(cid)
    d = inventory.dashboard(res.ctx, res)
    d["config"] = {k: c[k] for k in ("id", "project_id", "role", "filename", "sha256", "imported_at", "parent_id", "note")}
    d["parse_issues"] = [i.to_dict() for i in model.issues]
    d["coverage"] = coverage(model)
    d["limitations"] = LIMITATIONS
    return d


@app.get("/api/configs/{cid}/tree")
def tree(cid: str):
    _, model, _ = loaded(cid)
    out = []
    for (scope, path), t in model.tables.items():
        if " > " in path:
            continue
        out.append({"scope": scope, "path": path, "line": t.node.line, "end_line": t.node.end_line, "count": len(t),
                    "singleton": not t.entries, "keys": [e.key for e in list(t)[:2000]],
                    "analysed": path in model.schema.ANALYZED_TABLES})
    return out


@app.get("/api/configs/{cid}/table")
def table(cid: str, path: str, scope: str | None = None):
    _, model, _ = loaded(cid)
    t = model.table(path, scope)
    if t is None:
        raise HTTPException(404, "table not found")
    return {"path": path, "scope": t.scope, "line": t.node.line,
            "attrs": [{"name": k, "value": "<redacted>" if is_sensitive(path, k) else " ".join(a.values), "line": a.line}
                      for k, a in t.attrs.items()],
            "entries": [_entry_json(e) for e in t],
            "sub": {k: [_entry_json(e) for e in st] for k, st in t.sub.items()}}


@app.get("/api/configs/{cid}/lines")
def lines(cid: str, start: int = 1, end: int = 0):
    _, model, _ = loaded(cid)
    n = len(model.pc.lines)
    start = max(1, start)
    end = min(n, end or start + 200, start + 2000)
    return {"start": start, "end": end, "total": n, "lines": redact_lines(model.pc.lines)[start - 1:end]}


@app.get("/api/configs/{cid}/search")
def search(cid: str, q: str):
    _, model, res = loaded(cid)
    q = q.strip()
    out = []
    ip = None
    try:
        ip = ipa.ip_address(q)
    except ValueError:
        pass
    exp = res.ctx.cache["exp"]
    for t in model.all_tables():
        for e in t:
            hit = None
            if q.lower() in e.key.lower():
                hit = "name"
            elif ip is not None and t.path in ("firewall address", "firewall addrgrp", "system interface", "firewall vip",
                                                "router static", "vpn ipsec phase2-interface"):
                if t.path in ("firewall address", "firewall addrgrp"):
                    s = exp.addr([e.key])
                    if any(ip in n for n in s.nets if n.prefixlen > 0):
                        hit = "contains-ip"
                else:
                    if any(q in " ".join(a.values) for a in e.attrs.values()):
                        hit = "ip-in-attr"
                    from .netutil import safe_ipmask
                    for k in ("ip", "dst", "dst-subnet", "src-subnet"):
                        v = safe_ipmask(e.get(k)) if e.explicit(k) else None
                        if v and v.network.prefixlen > 0 and ip in v.network:
                            hit = "contains-ip"
            elif t.path.startswith("firewall policy") and q == e.key:
                hit = "policy-id"
            if hit:
                out.append({"uid": e.uid, "table": t.path, "key": e.key, "line": e.node.line, "match": hit})
            if len(out) >= 300:
                break
    if not out and len(q) >= 3:
        for i, ln in enumerate(model.pc.lines):
            if q.lower() in ln.lower():
                out.append({"uid": None, "table": "text", "key": redact_lines([ln])[0].strip()[:120], "line": i + 1, "match": "text"})
                if len(out) >= 100:
                    break
    return out


@app.get("/api/configs/{cid}/inventory/{kind}")
def inv(cid: str, kind: str):
    _, _, res = loaded(cid)
    fn = {"interfaces": inventory.interfaces, "zones": inventory.zones, "addresses": inventory.addresses,
          "policies": inventory.policies, "routes": inventory.routes, "vpn": inventory.vpn, "nat": inventory.nat,
          "dhcp": inventory.dhcp, "profiles": inventory.profiles, "topology": inventory.topology}.get(kind)
    if fn is None:
        raise HTTPException(404, "unknown inventory")
    return fn(res.ctx)


@app.get("/api/configs/{cid}/findings")
def findings(cid: str):
    c, model, res = loaded(cid)
    dec = get_store().decisions(cid)
    out = []
    for f in res.findings:
        d = f.to_dict()
        d["source"] = reports._src(model, f, 6)
        d["change_status"] = {ch: dec.get(ch, {}).get("status", "pending") for ch in f.changes}
        out.append(d)
    return out


@app.get("/api/configs/{cid}/object")
def obj(cid: str, uid: str):
    _, model, res = loaded(cid)
    g = res.ctx.g
    if uid not in g.g:
        raise HTTPException(404, "object not found")
    nd = g.g.nodes[uid]
    path, key = uid.rsplit("|", 1)
    e = model.entry(path, key) if key != "_" else None
    src = redact_lines(model.pc.lines[nd["line"] - 1:nd["end_line"]])
    return {"uid": uid, "table": nd["table"], "name": nd["name"], "line": nd["line"], "end_line": nd["end_line"],
            "entry": _entry_json(e) if e else None, "source": src, "direct": g.direct(uid), "impact": g.impact(uid),
            "findings": [f.to_dict() for f in res.findings if uid in f.objects]}


@app.get("/api/configs/{cid}/graph")
def graph(cid: str, uid: str, depth: int = 1):
    _, _, res = loaded(cid)
    sub = res.ctx.g.neighborhood(uid, max(1, min(depth, 3)))
    if len(sub["nodes"]) > 400:
        sub = res.ctx.g.neighborhood(uid, 1)
        sub["truncated"] = True
    return sub


@app.get("/api/configs/{cid}/broken")
def broken(cid: str):
    _, _, res = loaded(cid)
    return [b.to_dict() for b in res.ctx.g.broken]


class SimIn(BaseModel):
    src: str
    dst: str
    proto: str = "tcp"
    port: int | None = 443
    src_intf: str | None = None


@app.post("/api/configs/{cid}/simulate")
def sim(cid: str, s: SimIn):
    _, _, res = loaded(cid)
    try:
        return simulate(res.ctx, s.src, s.dst, s.proto, s.port, s.src_intf or None)
    except ValueError as ex:
        raise HTTPException(400, str(ex))


# ------------------------------------------------------------------ remediation
@app.get("/api/configs/{cid}/changes")
def changes(cid: str):
    _, _, res = loaded(cid)
    dec = get_store().decisions(cid)
    fmap = {f.id: f for f in res.findings}
    out = []
    for c in res.ctx.changes.values():
        d = c.to_dict()
        f = fmap.get(c.finding_id)
        d["finding"] = {"id": f.id, "title": f.title, "severity": f.severity} if f else None
        d["status"] = dec.get(c.id, {}).get("status", "pending")
        d["dependencies"] = {u: res.ctx.g.impact(u).get("total", 0) for u in c.affected}
        out.append(d)
    return out


class DecisionIn(BaseModel):
    status: str


@app.post("/api/configs/{cid}/changes/{chid}/decision")
def decide(cid: str, chid: str, d: DecisionIn):
    c, _, res = loaded(cid)
    p = get_store().project(c["project_id"])
    if p["mode"] == "audit":
        raise HTTPException(403, "project is in audit-only mode; remediation decisions are disabled")
    if d.status not in ("approved", "rejected", "pending"):
        raise HTTPException(400, "invalid status")
    ch = res.ctx.changes.get(chid)
    if ch is None:
        raise HTTPException(404, "change not found")
    get_store().decide(cid, chid, d.status, ch.title)
    return {"ok": True}


class RemediateIn(BaseModel):
    mode: str = "assisted"  # assisted: approved changes ; auto: auto-eligible changes only
    confirm: bool = False


@app.post("/api/configs/{cid}/remediate")
def remediate(cid: str, r: RemediateIn):
    c, model, res = loaded(cid)
    p = get_store().project(c["project_id"])
    if p["mode"] == "audit":
        raise HTTPException(403, "project is in audit-only mode")
    dec = get_store().decisions(cid)
    if r.mode == "auto":
        if p["mode"] != "auto" or not r.confirm:
            raise HTTPException(403, "controlled auto-remediation requires project mode 'auto' and confirm=true")
        sel = [ch for ch in res.ctx.changes.values() if ch.auto_eligible and dec.get(ch.id, {}).get("status") != "rejected"]
    else:
        sel = [ch for ch in res.ctx.changes.values() if dec.get(ch.id, {}).get("status") == "approved"]
    if not sel:
        raise HTTPException(400, "no changes selected (approve changes first)")
    try:
        new_text = remediation.apply_changes(model, sel)
    except ValueError as ex:
        raise HTTPException(409, str(ex))
    val = remediation.validate(model, new_text, sel, res.findings)
    new_id = get_store().add_config(c["project_id"], "revision", f"remediated-{c['filename']}", new_text, parent_id=cid,
                                    note=f"{len(sel)} changes ({r.mode}); validation {'OK' if val['ok'] else 'FAILED'}")
    for ch in sel:
        get_store().log(c["project_id"], new_id, "change-applied-offline", f"{ch.id} {ch.title}")
    return {"new_config_id": new_id, "validation": val, "applied": [ch.id for ch in sel],
            "script": remediation.script(sel, model)}


@app.get("/api/configs/{cid}/script", response_class=PlainTextResponse)
def script(cid: str):
    _, model, res = loaded(cid)
    dec = get_store().decisions(cid)
    sel = [ch for ch in res.ctx.changes.values() if dec.get(ch.id, {}).get("status") == "approved"]
    return Response(remediation.script(sel, model), media_type="text/plain",
                    headers={"Content-Disposition": f'attachment; filename="remediation-{cid}.txt"'})


@app.get("/api/configs/{cid}/download")
def download(cid: str):
    c = get_store().config(cid)
    if c is None:
        raise HTTPException(404)
    return Response(c["text"].encode("utf-8", "surrogateescape"), media_type="text/plain",
                    headers={"Content-Disposition": f'attachment; filename="{c["filename"]}"'})


# ------------------------------------------------------------------ comparison
@app.get("/api/diff")
def diff(a: str, b: str):
    _, ma, _ = loaded(a)
    _, mb, _ = loaded(b)
    return semantic_diff(ma, mb)


@app.get("/api/ha")
def ha(primary: str, secondary: str):
    _, ma, _ = loaded(primary)
    _, mb, _ = loaded(secondary)
    return ha_compare(ma, mb)


# ------------------------------------------------------------------ reports
@app.get("/api/configs/{cid}/report.{fmt}")
def report(cid: str, fmt: str):
    c, model, res = loaded(cid)
    p = get_store().project(c["project_id"]) or {}
    cl = [{"change_id": d["change_id"], "status": d["status"], "title": d["title"], "at": d["at"]}
          for d in get_store().decisions(cid).values()]
    rep = reports.build(res, {**p, **{k: c[k] for k in ("filename", "sha256", "imported_at")}}, cl)
    fn = f"fortiaudit-{(model.hostname or 'config')}-{cid}"
    if fmt == "json":
        return Response(reports.to_json(rep), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{fn}.json"'})
    if fmt == "csv":
        return Response(reports.to_csv(rep), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{fn}.csv"'})
    if fmt == "html":
        return HTMLResponse(reports.to_html(rep), headers={"Content-Disposition": f'inline; filename="{fn}.html"'})
    if fmt == "pdf":
        return Response(reports.to_pdf(rep), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fn}.pdf"'})
    raise HTTPException(404, "format must be json|csv|html|pdf")


@app.get("/api/projects/{pid}/changelog")
def changelog(pid: str):
    return get_store().changelog(pid)


# ------------------------------------------------------------------ frontend
if FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")


def main():
    import argparse

    import uvicorn
    ap = argparse.ArgumentParser(description="FortiAudit local server")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--data", default=None, help="data directory (default ~/.fortiaudit)")
    a = ap.parse_args()
    global store
    store = Store(a.data)
    print(f"FortiAudit running at http://127.0.0.1:{a.port}  (offline, data in {store.dir})")
    uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
