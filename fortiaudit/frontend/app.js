"use strict";
// FortiAudit SPA – no external dependencies, talks only to the local API.
const $ = (s) => document.querySelector(s);
const S = { projects: [], pid: null, cid: null, project: null, cache: {} };
const SEV = ["critical", "high", "medium", "low", "info"];
const VIEWS = [
  ["dashboard", "Dashboard"], ["explorer", "Configuration Explorer"], ["interfaces", "Interfaces"], ["zones", "Zones"],
  ["addresses", "Address Objects"], ["policies", "Firewall Policies"], ["routing", "Routing & Path Sim"], ["vpn", "VPN"],
  ["nat", "NAT and VIPs"], ["dhcp", "DHCP and DNS"], ["profiles", "Security Profiles"], ["ha", "HA Comparison"],
  ["graph", "Dependency Graph"], ["topology", "Network Topology"], ["audit", "Configuration Audit"],
  ["remediation", "Remediation Center"], ["diff", "Configuration Diff"], ["reports", "Reports"], ["settings", "Settings"],
];

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
async function api(path, opts = {}) {
  opts.headers = Object.assign({ "X-FortiAudit": "1" }, opts.headers || {});
  if (opts.json !== undefined) { opts.body = JSON.stringify(opts.json); opts.headers["Content-Type"] = "application/json"; delete opts.json; }
  const r = await fetch(path, opts);
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((body && body.detail) || body || r.statusText);
  return body;
}
async function cached(key, fn) { const k = S.cid + ":" + key; if (!(k in S.cache)) S.cache[k] = await fn(); return S.cache[k]; }
const sev = (s) => s ? h("span", { class: "sev " + s }, s) : "";
const tags = (arr) => (arr || []).map((x) => h("span", { class: "tag" }, x));
const view = () => $("#view");
function put(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((x) => x != null && x !== false && x !== "").map((x) => (x instanceof Node ? x : document.createTextNode(String(x)))));
}
function setView(...kids) {
  view().replaceChildren(...kids.flat(Infinity).filter((x) => x != null && x !== false && x !== "").map((x) => (x instanceof Node ? x : document.createTextNode(String(x)))));
}
function toast(msg, bad) { const t = h("div", { class: "panel " + (bad ? "bad" : "good") }, msg); view().prepend(t); setTimeout(() => t.remove(), 6000); }
function refLink(uid, label) { return h("a", { class: "ref", onclick: (e) => { e.stopPropagation(); openObject(uid); } }, label || uid); }

// ---------------------------------------------------------------- generic table
function dataTable(cols, rows, opts = {}) {
  let sortKey = null, asc = true, q = "";
  const wrap = h("div");
  const filt = h("input", { placeholder: "Filter…", style: "width:260px;margin-bottom:8px" });
  const count = h("span", { class: "muted", style: "margin-left:10px" });
  filt.addEventListener("input", () => { q = filt.value.toLowerCase(); render(); });
  const tbl = h("table", { class: "t" });
  function render() {
    let rs = rows.filter((r) => !q || cols.some((c) => String(c.text ? c.text(r) : r[c.k] ?? "").toLowerCase().includes(q)));
    if (sortKey) {
      const c = cols.find((x) => x.k === sortKey);
      rs = rs.slice().sort((a, b) => {
        const va = c.sort ? c.sort(a) : (c.text ? c.text(a) : a[c.k]); const vb = c.sort ? c.sort(b) : (c.text ? c.text(b) : b[c.k]);
        return (va > vb ? 1 : va < vb ? -1 : 0) * (asc ? 1 : -1);
      });
    }
    count.textContent = `${rs.length} / ${rows.length}`;
    const head = h("tr", {}, cols.map((c) => h("th", { onclick: () => { asc = sortKey === c.k ? !asc : true; sortKey = c.k; render(); } }, c.t)));
    const body = rs.slice(0, 3000).map((r) => h("tr", { class: opts.onRow ? "click" : "", onclick: opts.onRow ? () => opts.onRow(r) : null },
      cols.map((c) => h("td", {}, c.f ? c.f(r) : (Array.isArray(r[c.k]) ? r[c.k].join(", ") : r[c.k] ?? "")))));
    put(tbl, h("thead", {}, head), h("tbody", {}, body));
  }
  render();
  wrap.append(h("div", { class: "row" }, filt, count, opts.extra || ""), tbl);
  return wrap;
}

// ---------------------------------------------------------------- drawer / object inspector
async function openObject(uid) {
  if (!S.cid || !uid) return;
  const d = $("#drawer"); d.classList.remove("hidden");
  const body = $("#drawerBody"); put(body, h("div", { class: "muted" }, "Loading…"));
  try {
    const o = await api(`/api/configs/${S.cid}/object?uid=${encodeURIComponent(uid)}`);
    const imp = o.impact;
    const byT = Object.entries(imp.by_table || {});
    put(body, 
      h("h1", {}, o.name), h("div", { class: "muted" }, `${o.table} · lines ${o.line}-${o.end_line}`),
      h("div", { class: "row", style: "margin:8px 0" }, h("button", { class: "ghost", onclick: () => { location.hash = "graph"; setTimeout(() => drawGraph(uid), 50); } }, "Show in dependency graph")),
      o.findings.length ? h("div", {}, h("h2", {}, `Findings (${o.findings.length})`), o.findings.map((f) => h("div", { class: "finding " + f.severity }, sev(f.severity), " ", f.title))) : "",
      h("h2", {}, `Change impact — ${imp.total || 0} dependent objects (${imp.direct || 0} direct)`),
      h("div", { class: "muted" }, "If this object changes, these objects may be affected (reverse dependency closure)."),
      byT.length ? byT.map(([t, xs]) => h("div", { class: "panel" }, h("b", {}, `${t} (${xs.length})`), h("div", {}, xs.slice(0, 80).map((x) =>
        h("div", {}, refLink(x.uid, x.name), x.direct ? h("span", { class: "tag" }, "direct") : h("span", { class: "muted" }, "  via " + x.via.slice(1, -1).map((v) => v.split("|")[1]).join(" → ")))))))
        : h("div", { class: "muted" }, "Nothing references this object."),
      h("h2", {}, "Depends on"), o.direct.depends_on.length ? o.direct.depends_on.map((x) => h("div", {}, h("span", { class: "tag" }, x.attr), " ", refLink(x.to))) : h("div", { class: "muted" }, "none"),
      h("h2", {}, "Source configuration (redacted)"), pre(o.source, o.line));
  } catch (e) { put(body, h("div", { class: "bad" }, e.message)); }
}
function pre(lines, start) { return h("pre", {}, lines.map((l, i) => h("div", {}, h("span", { class: "ln" }, start + i), l))); }
$("#drawerClose").addEventListener("click", () => $("#drawer").classList.add("hidden"));

// ---------------------------------------------------------------- top bar
async function loadProjects(selectPid, selectCid) {
  S.projects = await api("/api/projects");
  const ps = $("#projectSel");
  put(ps, ...(S.projects.length ? S.projects.map((p) => h("option", { value: p.id }, p.name)) : [h("option", { value: "" }, "— no project —")]));
  S.pid = selectPid || S.pid || (S.projects[0] && S.projects[0].id) || null;
  if (S.pid) ps.value = S.pid;
  S.project = S.projects.find((p) => p.id === S.pid) || null;
  const cs = $("#configSel");
  const cfgs = S.project ? S.project.configs : [];
  put(cs, ...(cfgs.length ? cfgs.map((c) => h("option", { value: c.id }, `${c.role}: ${c.filename} (${c.imported_at.slice(0, 16)})`)) : [h("option", { value: "" }, "— import a configuration —")]));
  S.cid = selectCid || (cfgs.find((c) => c.id === S.cid) ? S.cid : (cfgs.length ? cfgs[cfgs.length - 1].id : null));
  if (S.cid) cs.value = S.cid;
  $("#mode").textContent = S.project ? `mode: ${({ audit: "Audit only", assisted: "Assisted remediation", auto: "Controlled auto-remediation" })[S.project.mode]}` : "";
}
$("#projectSel").addEventListener("change", async (e) => { S.pid = e.target.value; S.cid = null; await loadProjects(); route(); });
$("#configSel").addEventListener("change", (e) => { S.cid = e.target.value; route(); });
$("#newProject").addEventListener("click", async () => {
  const name = prompt("Project name", "HQ FortiGate 121G"); if (!name) return;
  const r = await api("/api/projects", { method: "POST", json: { name } }); await loadProjects(r.id); route();
});
$("#fileIn").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (!S.pid) { const r = await api("/api/projects", { method: "POST", json: { name: f.name } }); await loadProjects(r.id); }
  const fd = new FormData(); fd.append("file", f); fd.append("role", $("#roleSel").value);
  setView(h("div", { class: "empty" }, `Parsing and auditing ${f.name}…`));
  try { const r = await api(`/api/projects/${S.pid}/configs`, { method: "POST", body: fd }); await loadProjects(S.pid, r.id); location.hash = "dashboard"; route(); }
  catch (err) { setView(h("div", { class: "panel bad" }, "Import failed: " + err.message)); }
  e.target.value = "";
});
let searchT;
$("#search").addEventListener("input", (e) => {
  clearTimeout(searchT); const q = e.target.value.trim(); if (!q || !S.cid) return;
  searchT = setTimeout(async () => {
    const rs = await api(`/api/configs/${S.cid}/search?q=${encodeURIComponent(q)}`);
    const d = $("#drawer"); d.classList.remove("hidden");
    put($("#drawerBody"), h("h1", {}, `Search: ${q}`), h("div", { class: "muted" }, `${rs.length} results`),
      rs.map((r) => h("div", {}, r.uid ? refLink(r.uid, `${r.table} › ${r.key}`) : h("span", {}, r.key), h("span", { class: "muted" }, `  line ${r.line} · ${r.match}`))));
  }, 300);
});

// ---------------------------------------------------------------- views
const V = {};
V.dashboard = async () => {
  const d = await cached("dash", () => api(`/api/configs/${S.cid}/dashboard`));
  const id = d.identity, s = d.summary;
  setView(
    h("h1", {}, `${id.hostname || "(no hostname)"} — FortiGate ${id.model || "?"} · FortiOS ${id.version || "?"} build ${id.build || "?"}`),
    id.warnings.length ? h("div", { class: "panel warn" }, id.warnings.map((w) => h("div", {}, "⚠ " + w))) : h("div", { class: "panel good" }, "✓ Configuration matches the authoritative baseline (FortiOS 7.4.12 build 2902, FortiGate 121G)."),
    h("div", { class: "cards" },
      [["Health indicator", s.health_score + "/100"], ["Findings", s.total], ["Critical", s.by_severity.critical], ["High", s.by_severity.high],
       ["Medium", s.by_severity.medium], ["Optimisations", s.optimizations], ["Proposed changes", s.changes], ["Auto-eligible", s.auto_eligible_changes]]
        .map(([k, v]) => h("div", { class: "card" }, h("div", { class: "k" }, k), h("div", { class: "v" }, v)))),
    h("div", { class: "muted", style: "margin:6px 0 14px" }, s.health_note),
    h("h2", {}, "Configuration statistics"),
    h("div", { class: "cards" }, Object.entries(d.counts).map(([k, v]) => h("div", { class: "card" }, h("div", { class: "k" }, k.replace(/_/g, " ")), h("div", { class: "v" }, v)))),
    h("div", { class: "flex2", style: "margin-top:14px" },
      h("div", { class: "panel" }, h("h3", {}, "Device & import"), kv({ Platform: id.platform, Model: id.model, Firmware: `${id.version} build ${id.build}`, "Build date": id.build_date,
        "VDOM mode": `${id.vdom_mode} (${id.vdoms.join(", ")}) · audited: ${id.active_vdom}`, File: d.config.filename, Imported: d.config.imported_at,
        "SHA-256": d.config.sha256, Role: d.config.role, Note: d.config.note, "Schema": `${id.schema} (verified: ${id.schema_verified})`,
        "Graph": `${d.graph.nodes} objects, ${d.graph.edges} references, ${d.graph.broken_refs} broken`, "Audit time": d.audit_seconds + " s" })),
      h("div", { class: "panel" }, h("h3", {}, "Parse & analysis coverage"),
        h("div", {}, `${d.coverage.analysed_tables.length} tables analysed · ${d.coverage.parsed_not_analysed.length} parsed but not analysed · ${d.coverage.unrecognised_lines.length} unrecognised lines`),
        d.parse_issues.length ? h("div", {}, d.parse_issues.slice(0, 30).map((i) => h("div", { class: i.severity === "error" ? "bad" : "warn" }, `line ${i.line}: ${i.message}`))) : h("div", { class: "good" }, "No parse issues."),
        h("details", {}, h("summary", {}, "Parsed but not analysed (preserved verbatim)"), d.coverage.parsed_not_analysed.map((t) => h("div", { class: "muted" }, `${t.path} (${t.entries}) line ${t.line}`))))),
    h("div", { class: "panel" }, h("h3", {}, "Validation limitations"), d.limitations.map((l) => h("div", { class: "muted" }, "• " + l))));
};
function kv(o) { return h("table", { class: "t" }, Object.entries(o).map(([k, v]) => h("tr", {}, h("td", { class: "muted" }, k), h("td", {}, v ?? "")))); }

V.explorer = async () => {
  const tree = await cached("tree", () => api(`/api/configs/${S.cid}/tree`));
  const right = h("div", { class: "grow" }, h("div", { class: "empty" }, "Select a configuration table."));
  const left = h("div", { class: "tree panel", style: "width:330px;max-height:80vh;overflow:auto" },
    tree.map((t) => h("details", {}, h("summary", { onclick: () => showTable(t, right) }, `${t.path}`, h("span", { class: "muted" }, ` ${t.singleton ? "" : "(" + t.count + ")"}${t.scope !== "root" ? " [" + t.scope + "]" : ""}${t.analysed ? "" : " · not analysed"}`)))));
  setView(h("h1", {}, "Configuration Explorer"), h("div", { class: "row", style: "align-items:flex-start" }, left, right));
};
async function showTable(t, target) {
  const d = await api(`/api/configs/${S.cid}/table?path=${encodeURIComponent(t.path)}&scope=${encodeURIComponent(t.scope)}`);
  const attrs = (a) => h("table", { class: "t" }, a.map((x) => h("tr", {}, h("td", { class: "muted", style: "width:30%" }, (x.op === "unset" ? "unset " : "") + x.name), h("td", {}, x.value), h("td", { class: "muted" }, "L" + x.line))));
  const ent = (e) => h("details", { class: "panel" }, h("summary", {}, h("b", {}, e.key), h("span", { class: "muted" }, ` lines ${e.line}-${e.end_line} `), refLink(e.uid, "inspect ›")),
    attrs(e.attrs), Object.entries(e.sub).map(([k, s]) => h("div", { style: "margin-left:16px" }, h("h3", {}, "config " + k), attrs(s.attrs), s.entries.map(ent))));
  const cli = h("div");
  put(target, h("div", { class: "row" }, h("h2", { class: "grow" }, `config ${d.path}`),
    h("button", { class: "ghost", onclick: async () => { const l = await api(`/api/configs/${S.cid}/lines?start=${t.line}&end=${t.end_line}`); put(cli, pre(l.lines, l.start)); } }, "View original CLI")),
    cli, d.attrs.length ? attrs(d.attrs) : "", d.entries.map(ent),
    Object.entries(d.sub).map(([k, es]) => h("div", {}, h("h3", {}, "config " + k), es.map(ent))));
}

const inv = (k) => cached("inv-" + k, () => api(`/api/configs/${S.cid}/inventory/${k}`));
const fcount = (r) => r.findings && r.findings.length ? h("span", { class: "sev medium" }, r.findings.length) : "";
V.interfaces = async () => {
  const rows = await inv("interfaces");
  setView(h("h1", {}, `Interfaces (${rows.length})`), dataTable([
    { k: "name", t: "Name" }, { k: "type", t: "Type" }, { k: "alias", t: "Alias" }, { k: "ip", t: "IP/mask", f: (r) => [r.ip, ...r.secondary.map((s) => h("div", { class: "muted" }, s + " (sec)"))] },
    { k: "parent", t: "Parent" }, { k: "vlanid", t: "VLAN" }, { k: "status", t: "Status" }, { k: "role", t: "Role" }, { k: "zone", t: "Zone" },
    { k: "allowaccess", t: "Admin access", f: (r) => h("span", { class: /http\b|telnet/.test(r.allowaccess) ? "bad" : "" }, r.allowaccess) },
    { k: "mode", t: "Mode" }, { k: "p", t: "Policies", text: (r) => r.policies.length, f: (r) => r.policies.length }, { k: "r", t: "Routes", text: (r) => r.routes.length, f: (r) => r.routes.length },
    { k: "v", t: "VPN", text: (r) => r.vpn.length, f: (r) => r.vpn.length }, { k: "f", t: "Findings", text: (r) => r.findings.length, f: fcount },
  ], rows, { onRow: (r) => openObject(r.uid) }));
};
V.zones = async () => {
  const rows = await inv("zones");
  setView(h("h1", {}, `Zones (${rows.length})`), dataTable([{ k: "name", t: "Zone" }, { k: "members", t: "Members", f: (r) => tags(r.members) },
    { k: "intrazone", t: "Intra-zone" }, { k: "p", t: "Policies", text: (r) => r.policies.length, f: (r) => r.policies.length }, { k: "f", t: "Findings", text: (r) => r.findings.length, f: fcount }], rows, { onRow: (r) => openObject(r.uid) }));
};
V.addresses = async () => {
  const rows = await inv("addresses");
  setView(h("h1", {}, `Address objects, groups and VIPs (${rows.length})`), dataTable([{ k: "name", t: "Name" }, { k: "table", t: "Table" }, { k: "type", t: "Type" },
    { k: "value", t: "Value" }, { k: "interface", t: "Interface" }, { k: "ref_count", t: "Refs", sort: (r) => r.ref_count }, { k: "comment", t: "Comment" },
    { k: "f", t: "Findings", text: (r) => r.findings.length, f: fcount }], rows, { onRow: (r) => openObject(r.uid) }));
};
V.policies = async () => {
  const rows = await inv("policies");
  setView(h("h1", {}, `Firewall policies (${rows.length}) — table order = evaluation order`), dataTable([
    { k: "seq", t: "#", sort: (r) => r.seq }, { k: "id", t: "ID", sort: (r) => +r.id }, { k: "name", t: "Name" }, { k: "srcintf", t: "In" }, { k: "dstintf", t: "Out" },
    { k: "srcaddr", t: "Source" }, { k: "dstaddr", t: "Destination" }, { k: "service", t: "Service" },
    { k: "action", t: "Action", f: (r) => h("span", { class: r.action === "accept" ? "good" : "bad" }, r.action + (r.status === "disable" ? " (disabled)" : "")) },
    { k: "nat", t: "NAT", f: (r) => r.nat + (r.poolname ? " " + r.poolname : "") }, { k: "profiles", t: "Profiles", f: (r) => tags(r.profiles) },
    { k: "logtraffic", t: "Log" }, { k: "risk", t: "Risk", f: (r) => sev(r.risk), sort: (r) => r.risk ? SEV.indexOf(r.risk) : 9 },
  ], rows, { onRow: (r) => openObject(r.uid) }));
};
V.routing = async () => {
  const d = await inv("routes");
  const ifs = await inv("interfaces");
  const out = h("div");
  const f = { src: h("input", { placeholder: "source IP", value: "10.10.0.10" }), dst: h("input", { placeholder: "destination IP", value: "8.8.8.8" }),
    proto: h("select", {}, ["tcp", "udp", "icmp"].map((x) => h("option", {}, x))), port: h("input", { placeholder: "port", value: "443", style: "width:80px" }),
    intf: h("select", {}, h("option", { value: "" }, "(infer ingress)"), ifs.map((i) => h("option", { value: i.name }, i.name))) };
  const run = async () => {
    try {
      const r = await api(`/api/configs/${S.cid}/simulate`, { method: "POST", json: { src: f.src.value, dst: f.dst.value, proto: f.proto.value, port: f.port.value ? +f.port.value : null, src_intf: f.intf.value || null } });
      put(out, h("div", { class: "panel" }, h("h3", {}, "Verdict: " + r.verdict), r.issues.map((i) => h("div", { class: "warn" }, "⚠ " + i)),
        h("table", { class: "t" }, r.steps.map((s) => h("tr", {}, h("td", { class: "muted" }, s.step), h("td", {}, fmtStep(s)), h("td", { class: "muted" }, s.note || "")))),
        h("div", { class: "muted" }, r.disclaimer), r.rib_incomplete.map((x) => h("div", { class: "muted" }, "RIB note: " + x))));
    } catch (e) { put(out, h("div", { class: "bad" }, e.message)); }
  };
  setView(h("h1", {}, "Routing & network path simulation"),
    h("div", { class: "panel" }, h("h3", {}, "Path simulation (static configuration model)"), h("div", { class: "row" }, f.src, f.dst, f.proto, f.port, f.intf, h("button", { onclick: run }, "Simulate")), out),
    h("h2", {}, "Static routes"), dataTable([{ k: "id", t: "ID" }, { k: "dst", t: "Destination" }, { k: "gateway", t: "Gateway" }, { k: "device", t: "Device" }, { k: "distance", t: "Dist" },
      { k: "priority", t: "Prio" }, { k: "blackhole", t: "Blackhole" }, { k: "status", t: "Status" }, { k: "comment", t: "Comment" }, { k: "f", t: "Findings", text: (r) => r.findings.length, f: fcount }], d.static, { onRow: (r) => openObject(r.uid) }),
    h("h2", {}, "Policy routes"), dataTable([{ k: "id", t: "Seq" }, { k: "input", t: "In" }, { k: "src", t: "Src" }, { k: "dst", t: "Dst" }, { k: "protocol", t: "Proto" }, { k: "output", t: "Out" }, { k: "gateway", t: "GW" }, { k: "status", t: "Status" }], d.policy_routes, { onRow: (r) => openObject(r.uid) }),
    h("h2", {}, "Reconstructed RIB (configuration-based)"), h("div", { class: "muted" }, d.incomplete.join(" · ")),
    dataTable([{ k: "kind", t: "Kind" }, { k: "dst", t: "Prefix" }, { k: "gateway", t: "Gateway" }, { k: "devices", t: "Interfaces" }, { k: "distance", t: "Dist", sort: (r) => r.distance }, { k: "priority", t: "Prio" }], d.rib));
};
function fmtStep(s) {
  const r = s.result;
  if (typeof r === "string") return s.object ? [r, " ", refLink(s.object, "›")] : r;
  if (!Array.isArray(r)) return JSON.stringify(r);
  return r.map((x) => {
    if (typeof x === "string") return h("div", {}, x);
    if ("dst" in x) return h("div", {}, `${x.kind} ${x.dst} → ${x.devices.join(", ") || "blackhole"}${x.gateway ? " via " + x.gateway : ""} (distance ${x.distance}, priority ${x.priority}) `, refLink(x.source, "line " + x.line));
    if ("policy" in x) return h("div", {}, refLink("firewall policy|" + x.policy, "policy " + x.policy), ` ${x.name || ""} — ${x.action} `, h("span", { class: x.verdict === "yes" ? "good" : "warn" }, x.verdict === "yes" ? "definite match" : "possible match (runtime)"), x.nat === "enable" ? " · NAT" : "");
    return h("div", {}, JSON.stringify(x));
  });
}
V.vpn = async () => {
  const rows = await inv("vpn");
  setView(h("h1", {}, `IPsec VPN (${rows.length} tunnels)`), rows.length ? rows.map((t) => h("div", { class: "panel" },
    h("div", { class: "row" }, h("h2", { class: "grow" }, t.name), refLink(t.uid, "inspect ›")),
    kv({ "WAN interface": t.interface, "Remote gateway": t.remote_gw, Type: t.type, IKE: "v" + t.ike, Mode: t.mode, Auth: t.authmethod, Proposal: t.proposal || "(default)", DH: t.dhgrp || "(default)", DPD: t.dpd, "NAT-T": t.nattraversal,
      "Policies in": t.policies_in.join(", ") || "none", "Policies out": t.policies_out.join(", ") || "none", "Routes via tunnel": t.routes.join(", ") || "none", "Addresses used": t.addresses.join(", ") }),
    h("h3", {}, "Phase 2"), dataTable([{ k: "name", t: "Name" }, { k: "src", t: "Local" }, { k: "dst", t: "Remote" }, { k: "proposal", t: "Proposal" }, { k: "pfs", t: "PFS" }, { k: "dhgrp", t: "DH" }], t.phase2),
    h("h3", {}, "Tunnel dependency diagram"), layeredSvg(t.graph, t.uid),
    h("div", { class: "muted" }, "Configuration only: tunnel state, negotiation and peer configuration require live verification (`diagnose vpn ike gateway list`)."))) : h("div", { class: "empty" }, "No IPsec tunnels."));
};
V.nat = async () => {
  const d = await inv("nat");
  setView(h("h1", {}, "NAT, VIPs and IP pools"), h("div", { class: "panel" }, "Central NAT: ", h("b", {}, d.central_nat ? "enabled" : "disabled (policy NAT)")),
    h("h2", {}, "Virtual IPs"), dataTable([{ k: "name", t: "Name" }, { k: "value", t: "Mapping" }, { k: "interface", t: "Ext interface" }, { k: "ref_count", t: "Refs" }, { k: "f", t: "Findings", text: (r) => r.findings.length, f: fcount }], d.vips, { onRow: (r) => openObject(r.uid) }),
    h("h2", {}, "IP pools"), dataTable([{ k: "name", t: "Name" }, { k: "type", t: "Type" }, { k: "start", t: "Start" }, { k: "end", t: "End" }, { k: "refs", t: "Used by" }, { k: "f", t: "Findings", text: (r) => r.findings.length, f: fcount }], d.ippools, { onRow: (r) => openObject(r.uid) }),
    d.snat.length ? [h("h2", {}, "Central SNAT"), dataTable([{ k: "id", t: "ID" }, { k: "srcintf", t: "In" }, { k: "dstintf", t: "Out" }, { k: "orig", t: "Orig" }, { k: "dst", t: "Dst" }, { k: "pool", t: "Pool" }], d.snat)] : "");
};
V.dhcp = async () => {
  const d = await inv("dhcp");
  setView(h("h1", {}, "DHCP and DNS"), h("div", { class: "panel" }, kv({ "System DNS primary": d.dns.primary, "System DNS secondary": d.dns.secondary })),
    dataTable([{ k: "id", t: "ID" }, { k: "interface", t: "Interface" }, { k: "gateway", t: "Gateway" }, { k: "netmask", t: "Mask" }, { k: "ranges", t: "Ranges" }, { k: "reserved", t: "Reserved" }, { k: "dns", t: "DNS" }, { k: "status", t: "Status" }, { k: "f", t: "Findings", text: (r) => r.findings.length, f: fcount }], d.servers, { onRow: (r) => openObject(r.uid) }));
};
V.profiles = async () => {
  const rows = await inv("profiles");
  setView(h("h1", {}, "Security profiles"), dataTable([{ k: "table", t: "Type" }, { k: "name", t: "Name" }, { k: "used_by", t: "Used by", f: (r) => r.used_by.length ? r.used_by.map((u) => h("div", {}, refLink(u))) : h("span", { class: "muted" }, "unused") }], rows, { onRow: (r) => openObject(r.uid) }));
};
function configPicker(label, def) {
  const cfgs = S.project ? S.project.configs : [];
  const s = h("select", {}, cfgs.map((c) => h("option", { value: c.id }, `${c.role}: ${c.filename}`)));
  if (def) s.value = def;
  return [h("span", { class: "muted" }, label), s];
}
V.ha = async () => {
  const cfgs = S.project ? S.project.configs : [];
  const [la, a] = configPicker("Primary", (cfgs.find((c) => c.role === "primary") || {}).id);
  const [lb, b] = configPicker("Secondary", (cfgs.find((c) => c.role === "secondary") || {}).id);
  const out = h("div");
  const run = async () => {
    const r = await api(`/api/ha?primary=${a.value}&secondary=${b.value}`);
    const vc = { critical: "bad", concerning: "bad", review: "warn", expected: "muted" };
    put(out, 
      r.identity.mismatches.length ? h("div", { class: "panel bad" }, r.identity.mismatches.map((m) => h("div", {}, `${m.field}: ${m.primary} vs ${m.secondary} — ${m.reason}`))) : h("div", { class: "panel good" }, `Same model/firmware: ${r.identity.primary.model} ${r.identity.primary.version} b${r.identity.primary.build}`),
      h("div", { class: "row" }, Object.entries(r.summary).map(([k, v]) => h("span", { class: "pill " + (vc[k] || "") }, `${k}: ${v}`))),
      h("div", { class: "muted" }, r.note),
      dataTable([{ k: "verdict", t: "Verdict", f: (x) => h("b", { class: vc[x.verdict] }, x.verdict), sort: (x) => ["critical", "concerning", "review", "expected"].indexOf(x.verdict) },
        { k: "type", t: "Change" }, { k: "table", t: "Table" }, { k: "key", t: "Object" },
        { k: "changes", t: "Differences", f: (x) => x.changes ? x.changes.slice(0, 12).map((c) => h("div", {}, h("b", {}, c.attr), ": ", h("span", { class: "diffdel" }, c.before ?? "∅"), " → ", h("span", { class: "diffadd" }, c.after ?? "∅"))) : "" },
        { k: "reason", t: "Assessment" }], r.items));
  };
  setView(h("h1", {}, "HA member comparison"), h("div", { class: "muted" }, "Import the Primary and Secondary backups into this project (choose the role when importing)."),
    h("div", { class: "row panel" }, la, a, lb, b, h("button", { onclick: run }, "Compare")), out);
  if (cfgs.length >= 2) run();
};

// ---------------------------------------------------------------- graphs
function layeredSvg(g, centerId) {
  const W = 1100; const nodes = g.nodes; if (!nodes.length) return h("div", { class: "muted" }, "No nodes.");
  const out = {}, inn = {};
  g.edges.forEach((e) => { (out[e.source] = out[e.source] || []).push(e.target); (inn[e.target] = inn[e.target] || []).push(e.source); });
  const layer = { [centerId]: 0 };
  let fr = [centerId]; for (let d = 1; d <= 3; d++) { const n = []; fr.forEach((x) => (out[x] || []).forEach((y) => { if (!(y in layer)) { layer[y] = d; n.push(y); } })); fr = n; }
  fr = [centerId]; for (let d = 1; d <= 3; d++) { const n = []; fr.forEach((x) => (inn[x] || []).forEach((y) => { if (!(y in layer)) { layer[y] = -d; n.push(y); } })); fr = n; }
  nodes.forEach((n) => { if (!(n.id in layer)) layer[n.id] = 4; });
  const cols = {}; nodes.forEach((n) => (cols[layer[n.id]] = cols[layer[n.id]] || []).push(n));
  const keys = Object.keys(cols).map(Number).sort((a, b) => a - b);
  const cw = Math.max(200, W / keys.length); const pos = {}; let maxH = 0;
  keys.forEach((k, i) => { cols[k].sort((a, b) => a.table.localeCompare(b.table)).forEach((n, j) => { pos[n.id] = [i * cw + 10, j * 34 + 30]; maxH = Math.max(maxH, j * 34 + 70); }); });
  const NS = "http://www.w3.org/2000/svg"; const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", keys.length * cw + 20); svg.setAttribute("height", maxH);
  const el = (t, a) => { const x = document.createElementNS(NS, t); for (const k in a) x.setAttribute(k, a[k]); return x; };
  keys.forEach((k, i) => { const t = el("text", { x: i * cw + 10, y: 14 }); t.textContent = k < 0 ? `used by (${-k})` : k === 0 ? "selected" : k === 4 ? "other" : `depends on (${k})`; t.setAttribute("style", "fill:#8a97ab"); svg.append(t); });
  g.edges.forEach((e) => { const a = pos[e.source], b = pos[e.target]; if (!a || !b) return; const p = el("path", { class: "e", d: `M${a[0] + 170},${a[1] + 12} C${a[0] + 200},${a[1] + 12} ${b[0] - 30},${b[1] + 12} ${b[0]},${b[1] + 12}` }); const tt = document.createElementNS(NS, "title"); tt.textContent = e.attr; p.append(tt); svg.append(p); });
  nodes.forEach((n) => {
    const [x, y] = pos[n.id]; const gg = el("g", { class: "node" + (n.id === centerId ? " center" : ""), transform: `translate(${x},${y})` });
    gg.append(el("rect", { width: 170, height: 24, rx: 4 })); const t = el("text", { x: 6, y: 16 }); t.textContent = (n.name || n.label || n.id).slice(0, 24);
    const tt = document.createElementNS(NS, "title"); tt.textContent = `${n.table || n.kind}: ${n.name || n.label}`; gg.append(t, tt);
    const t2 = el("text", { x: 120, y: 16, style: "fill:#8a97ab;font-size:9px" }); t2.textContent = (n.table || n.kind || "").split(" ").pop().slice(0, 9); gg.append(t2);
    gg.addEventListener("click", () => (n.table ? (location.hash === "#graph" ? drawGraph(n.id) : openObject(n.id)) : null)); svg.append(gg);
  });
  return h("div", { style: "overflow:auto" }, svg);
}
let graphHost = null;
async function drawGraph(uid) {
  if (!graphHost) return;
  const g = await api(`/api/configs/${S.cid}/graph?uid=${encodeURIComponent(uid)}&depth=2`);
  put(graphHost, h("div", { class: "row" }, h("h2", { class: "grow" }, uid), refLink(uid, "inspect / impact ›")), g.truncated ? h("div", { class: "warn" }, "Large neighbourhood: showing depth 1 only.") : "", layeredSvg(g, uid));
}
V.graph = async () => {
  const inp = h("input", { placeholder: "object uid or name, e.g. port3 or firewall policy|10", style: "width:420px" });
  graphHost = h("div", { class: "panel" }, h("div", { class: "muted" }, "Pick an object. Left = objects that use it (impact), right = what it depends on. Click a node to re-centre."));
  const go = async () => {
    let v = inp.value.trim(); if (!v) return;
    if (!v.includes("|")) { const r = await api(`/api/configs/${S.cid}/search?q=${encodeURIComponent(v)}`); const ex = r.find((x) => x.key === v && x.uid) || r.find((x) => x.uid); if (!ex) return toast("No such object", true); v = ex.uid; }
    drawGraph(v);
  };
  inp.addEventListener("keydown", (e) => e.key === "Enter" && go());
  const broken = await cached("broken", () => api(`/api/configs/${S.cid}/broken`));
  setView(h("h1", {}, "Dependency graph"), h("div", { class: "row" }, inp, h("button", { onclick: go }, "Show")), graphHost,
    h("h2", {}, `Broken references (${broken.length})`), dataTable([{ k: "src", t: "Referencing object", f: (r) => refLink(r.src) }, { k: "attr", t: "Attribute" }, { k: "value", t: "Missing value" }, { k: "namespace", t: "Namespace" }, { k: "line", t: "Line" }, { k: "predefined_unknown", t: "Maybe predefined" }], broken));
};
V.topology = async () => {
  const t = await inv("topology");
  const col = (n) => n.kind === "zone" ? 0 : ["vlan", "tunnel", "loopback", "switch", "vdom-link"].includes(n.kind) ? 1 : ["physical", "aggregate", "redundant", "hard-switch"].includes(n.kind) ? 2 : 3;
  const NS = "http://www.w3.org/2000/svg"; const cols = [[], [], [], []]; t.nodes.forEach((n) => cols[col(n)].push(n));
  const pos = {}; const svg = document.createElementNS(NS, "svg"); let H = 0;
  cols.forEach((c, i) => c.forEach((n, j) => { pos[n.id] = [i * 270 + 10, j * 30 + 30]; H = Math.max(H, j * 30 + 60); }));
  svg.setAttribute("width", 1100); svg.setAttribute("height", H);
  const el = (tg, a) => { const x = document.createElementNS(NS, tg); for (const k in a) x.setAttribute(k, a[k]); return x; };
  ["Zones", "Logical (VLAN / tunnel)", "Physical / aggregate", "Subnets & routes"].forEach((l, i) => { const x = el("text", { x: i * 270 + 10, y: 14, style: "fill:#8a97ab" }); x.textContent = l; svg.append(x); });
  const colors = { connected: "#38c172", route: "#3d8bfd", "zone-member": "#f2b134", parent: "#8a97ab", over: "#ff6b3d", member: "#c08cff" };
  t.edges.forEach((e) => { const a = pos[e.source], b = pos[e.target]; if (!a || !b) return; const [l, r] = a[0] <= b[0] ? [a, b] : [b, a]; svg.append(el("path", { class: "e", style: `stroke:${colors[e.kind] || "#46546b"}`, d: `M${l[0] + 200},${l[1] + 11} C${l[0] + 240},${l[1] + 11} ${r[0] - 40},${r[1] + 11} ${r[0]},${r[1] + 11}` })); });
  t.nodes.forEach((n) => { const [x, y] = pos[n.id]; const g = el("g", { class: "node", transform: `translate(${x},${y})` }); const r = el("rect", { width: 200, height: 22, rx: 4 }); if (n.role === "wan") r.setAttribute("style", "stroke:#ff6b3d"); g.append(r); const tx = el("text", { x: 6, y: 15 }); tx.textContent = n.label.slice(0, 30); g.append(tx); if (!n.id.startsWith("net|")) g.addEventListener("click", () => openObject(n.id)); svg.append(g); });
  setView(h("h1", {}, "Network topology (derived from configuration)"), h("div", { class: "muted" }, "Green: connected subnet · Blue: static route · Amber: zone membership · Grey: VLAN parent · Orange: tunnel over WAN · Purple: aggregate member. WAN-role interfaces outlined orange."),
    h("div", { class: "panel", style: "overflow:auto" }, svg));
};

V.audit = async () => {
  const fs = await cached("findings", () => api(`/api/configs/${S.cid}/findings`));
  const fsev = h("select", {}, h("option", { value: "" }, "all severities"), SEV.map((s) => h("option", {}, s)));
  const fmod = h("select", {}, h("option", { value: "" }, "all modules"), [...new Set(fs.map((f) => f.module))].sort().map((m) => h("option", {}, m)));
  const fcls = h("select", {}, h("option", { value: "" }, "all classifications"), [...new Set(fs.map((f) => f.classification))].sort().map((m) => h("option", {}, m)));
  const frem = h("select", {}, h("option", { value: "" }, "any remediation"), ["auto-eligible", "assisted", "never"].map((m) => h("option", {}, m)));
  const fq = h("input", { placeholder: "text / object" });
  const list = h("div");
  const render = () => {
    const q = fq.value.toLowerCase();
    const sel = fs.filter((f) => (!fsev.value || f.severity === fsev.value) && (!fmod.value || f.module === fmod.value) && (!fcls.value || f.classification === fcls.value) &&
      (!frem.value || f.auto_remediation === frem.value) && (!q || (f.title + f.detail + f.objects.join(" ")).toLowerCase().includes(q)));
    put(list, h("div", { class: "muted" }, `${sel.length} findings`), SEV.map((s) => {
      const g = sel.filter((f) => f.severity === s); if (!g.length) return "";
      return h("div", {}, h("h2", {}, `${s.toUpperCase()} (${g.length})`), g.map((f) => h("details", { class: "finding " + f.severity },
        h("summary", {}, sev(f.severity), " ", h("b", {}, f.title), h("span", { class: "muted" }, `  ${f.classification} · ${f.confidence} confidence · module ${f.module}`)),
        h("p", {}, f.detail), h("p", {}, h("b", {}, "Recommendation: "), f.recommendation), f.impact ? h("p", {}, h("b", {}, "Operational impact: "), f.impact) : "",
        h("div", { class: "muted" }, `ID ${f.id} · rule ${f.rule} · evidence: ${f.evidence} · auto-remediation: ${f.auto_remediation}`),
        h("div", {}, "Objects: ", f.objects.map((o) => o.startsWith("line|") ? h("span", { class: "tag" }, o) : [refLink(o), " "])),
        f.source.length ? h("pre", {}, f.source.join("\n")) : "",
        f.changes.length ? h("div", {}, "Proposed changes: ", f.changes.map((c) => h("span", { class: "tag" }, `${c} (${f.change_status[c]})`)), " ", h("a", { class: "ref", onclick: () => (location.hash = "remediation") }, "open Remediation Center ›")) : "")));
    }));
  };
  [fsev, fmod, fcls, frem].forEach((x) => x.addEventListener("change", render)); fq.addEventListener("input", render);
  setView(h("h1", {}, "Configuration audit findings"), h("div", { class: "row panel" }, fsev, fmod, fcls, frem, fq), list); render();
};

V.remediation = async () => {
  const chs = await api(`/api/configs/${S.cid}/changes`);
  const mode = S.project.mode;
  const res = h("div");
  const decide = async (c, st) => { await api(`/api/configs/${S.cid}/changes/${c.id}/decision`, { method: "POST", json: { status: st } }); delete S.cache[S.cid + ":findings"]; V.remediation(); };
  const generate = async (auto) => {
    try {
      const r = await api(`/api/configs/${S.cid}/remediate`, { method: "POST", json: { mode: auto ? "auto" : "assisted", confirm: auto ? confirm("Apply ONLY auto-eligible low-risk changes to a new offline revision?") : false } });
      const v = r.validation;
      await loadProjects(S.pid, S.cid);
      put(res, h("div", { class: "panel " + (v.ok ? "good" : "bad") }, h("h3", {}, v.ok ? "✓ Corrected configuration generated and re-validated" : "✗ Validation found problems — review before use"),
        kv({ "Applied changes": r.applied.join(", "), "Parse errors after": v.parse_errors.length, "Targeted findings remaining": v.remaining_targeted_findings.join(", ") || "none",
          "New broken references": v.new_broken_references.length, "Unexpected object changes": v.unexpected_line_changes.length, "New findings": v.new_findings.map((f) => `${f.severity}: ${f.title}`).join(" | ") || "none",
          "Findings after": v.summary_after.total }),
        h("div", { class: "row", style: "margin-top:8px" }, h("a", { class: "btn", href: `/api/configs/${r.new_config_id}/download` }, "Download corrected configuration"),
          h("button", { class: "ghost", onclick: async () => { await loadProjects(S.pid, r.new_config_id); location.hash = "dashboard"; route(); } }, "Open revision & re-audit"),
          h("button", { class: "ghost", onclick: () => { location.hash = "diff"; S.diffPre = [S.cid, r.new_config_id]; } }, "Semantic diff vs original")),
        h("h3", {}, "Remediation script (with rollback)"), h("pre", {}, r.script)));
    } catch (e) { put(res, h("div", { class: "panel bad" }, e.message)); }
  };
  const approved = chs.filter((c) => c.status === "approved").length;
  setView(h("h1", {}, "Remediation Center"),
    h("div", { class: "panel" }, mode === "audit" ? h("div", { class: "warn" }, "Project is in Audit-only mode: no changes can be approved. Change the mode in Settings.") :
      h("div", { class: "row" }, h("button", { disabled: !approved, onclick: () => generate(false) }, `Generate corrected config from ${approved} approved change(s)`),
        h("button", { class: "ghost", disabled: mode !== "auto", title: "requires Controlled Auto-Remediation mode", onclick: () => generate(true) }, "Controlled auto-remediation (auto-eligible only)"),
        h("a", { class: "btn ghost", href: `/api/configs/${S.cid}/script` }, "Export approved commands")),
      h("div", { class: "muted", style: "margin-top:6px" }, "Nothing is ever sent to a device. Output is a new offline revision; the original import is kept unchanged as the backup.")),
    res,
    chs.length ? chs.map((c) => h("div", { class: "panel" },
      h("div", { class: "row" }, h("b", { class: "grow" }, c.title), h("span", { class: "pill" }, "risk " + c.risk), c.auto_eligible ? h("span", { class: "pill good" }, "auto-eligible") : h("span", { class: "pill" }, "requires approval"),
        h("span", { class: "pill " + (c.status === "approved" ? "good" : c.status === "rejected" ? "bad" : "") }, c.status),
        h("button", { disabled: mode === "audit", onclick: () => decide(c, "approved") }, "Approve"), h("button", { class: "ghost", disabled: mode === "audit", onclick: () => decide(c, "rejected") }, "Reject")),
      c.finding ? h("div", {}, sev(c.finding.severity), " ", c.finding.title) : "",
      h("p", {}, c.explanation), h("p", { class: "warn" }, "Side effects: " + c.side_effects), c.validation ? h("p", { class: "muted" }, "Validate: " + c.validation) : "",
      h("div", { class: "muted" }, "Affected: ", Object.entries(c.dependencies).map(([u, n]) => [refLink(u), ` (${n} dependents) `])),
      h("div", { class: "flex2" }, h("div", {}, h("h3", {}, "Before"), h("pre", {}, c.before)), h("div", {}, h("h3", {}, "After (patch)"), h("pre", {}, c.after))),
      h("div", { class: "flex2" }, h("div", {}, h("h3", {}, "CLI commands"), h("pre", {}, c.commands)), h("div", {}, h("h3", {}, "Rollback"), h("pre", {}, c.rollback))))) : h("div", { class: "empty" }, "No remediation proposals."));
};

V.diff = async () => {
  const [la, a] = configPicker("Original", S.diffPre ? S.diffPre[0] : null);
  const [lb, b] = configPicker("Modified", S.diffPre ? S.diffPre[1] : null);
  const out = h("div");
  const run = async () => {
    const r = await api(`/api/diff?a=${a.value}&b=${b.value}`);
    put(out, h("div", { class: "row" }, Object.entries(r.counts).map(([k, v]) => h("span", { class: "pill" }, `${k}: ${v}`))),
      dataTable([{ k: "type", t: "Change", f: (x) => h("b", { class: x.type === "added" ? "diffadd" : x.type === "removed" ? "diffdel" : "warn" }, x.type) }, { k: "table", t: "Table" }, { k: "key", t: "Object" },
        { k: "categories", t: "Behaviour impact", f: (x) => tags(x.categories) }, { k: "dependents", t: "Dependents", sort: (x) => x.dependents },
        { k: "changes", t: "Details", f: (x) => x.changes ? x.changes.map((c) => h("div", {}, h("b", {}, c.attr), ": ", h("span", { class: "diffdel" }, c.before ?? "∅"), " → ", h("span", { class: "diffadd" }, c.after ?? "∅"))) : x.moved ? "moved: " + x.moved.join(", ") : "" }], r.items));
  };
  setView(h("h1", {}, "Semantic configuration diff"), h("div", { class: "row panel" }, la, a, lb, b, h("button", { onclick: run }, "Compare")), out);
  if (S.diffPre) { run(); S.diffPre = null; }
};
V.reports = async () => {
  setView(h("h1", {}, "Reports"), h("div", { class: "panel" }, h("p", {}, "All reports are generated locally and redact passwords, PSKs, private keys, SNMP communities and certificates."),
    h("div", { class: "row" }, ["html", "pdf", "json", "csv"].map((f) => h("a", { class: "btn", href: `/api/configs/${S.cid}/report.${f}`, target: "_blank" }, f.toUpperCase())))),
    h("h2", {}, "Change log"), h("div", { id: "cl" }));
  const cl = await api(`/api/projects/${S.pid}/changelog`);
  put($("#cl"), dataTable([{ k: "at", t: "When" }, { k: "event", t: "Event" }, { k: "detail", t: "Detail" }, { k: "config_id", t: "Config" }], cl));
};
V.settings = async () => {
  const p = S.project;
  const ms = h("select", {}, [["audit", "Mode 1 — Audit only"], ["assisted", "Mode 2 — Assisted remediation"], ["auto", "Mode 3 — Controlled auto-remediation"]].map(([v, l]) => h("option", { value: v }, l)));
  ms.value = p.mode;
  const d = S.cid ? await cached("dash", () => api(`/api/configs/${S.cid}/dashboard`)) : null;
  const vd = h("select", {}, (d ? d.identity.vdoms : ["root"]).map((v) => h("option", {}, v))); if (d) vd.value = d.identity.active_vdom;
  setView(h("h1", {}, "Settings"),
    h("div", { class: "panel" }, h("h3", {}, "Operating mode"), ms, h("div", { class: "muted" }, "Controlled auto-remediation only ever applies changes flagged auto-eligible (zero-reference objects, verified by graph and full-text scan). Interfaces, routes, policies, NAT, VPN, admin, HA, certificates and management access always require explicit approval."),
      h("h3", {}, "VDOM to audit"), vd,
      h("div", { style: "margin-top:10px" }, h("button", { onclick: async () => { await api(`/api/projects/${p.id}/settings`, { method: "POST", json: { mode: ms.value, vdom: vd.value } }); S.cache = {}; await loadProjects(p.id); toast("Saved"); } }, "Save"))),
    h("div", { class: "panel" }, h("h3", {}, "Data & privacy"), h("p", {}, "Everything is stored locally (SQLite + backup copies with 0600 permissions). No network calls, no telemetry, no AI services."),
      h("button", { class: "danger", onclick: async () => { if (!confirm(`Permanently delete project "${p.name}", all imported configurations and backups?`)) return; await api(`/api/projects/${p.id}`, { method: "DELETE" }); S.pid = null; S.cid = null; S.cache = {}; await loadProjects(); route(); } }, "Delete project and all its data")));
};

// ---------------------------------------------------------------- router
function renderMenu(cur) {
  put($("#menu"), ...VIEWS.map(([k, l]) => h("a", { href: "#" + k, class: k === cur ? "active" : "" }, l)));
}
async function route() {
  const k = (location.hash || "#dashboard").slice(1);
  renderMenu(k);
  if (!S.pid) return setView(h("div", { class: "empty" }, h("h1", {}, "FortiAudit — FortiGate configuration intelligence"), h("p", {}, "Create a project and import a FortiGate CLI backup (System › Configuration › Backup). Everything stays on this machine.")));
  if (!S.cid && !["settings"].includes(k)) return setView(h("div", { class: "empty" }, "Import a configuration backup to begin."));
  try { await (V[k] || V.dashboard)(); } catch (e) { setView(h("div", { class: "panel bad" }, "Error: " + e.message)); }
}
window.addEventListener("hashchange", route);
loadProjects().then(route);
