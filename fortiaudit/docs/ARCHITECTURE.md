# FortiAudit – Architecture & Safety Design (FortiOS 7.4.12 baseline)

## 1. Technical architecture
```
frontend/ (static SPA, no build step, no CDN)  ──HTTP/JSON──►  backend/fortiaudit/api.py (FastAPI, 127.0.0.1 only)
                                                                │
   parser.py ─► model.py ─► graph.py ─► analyzers/* ─► findings ─► remediation.py ─► patched config
   (AST, lossless)  (typed tables,   (NetworkX      (modules A–K)    (change sets,      (line-level patch,
                     schema-aware)    dependency)                     rollback, revalidate) re-parse, re-audit)
   policy_engine.py (match-space algebra) · routing.py (RIB/PBR) · sim.py (path sim) · diff.py · ha.py · reports.py · store.py (SQLite)
```
The engine (`fortiaudit.*`) has **no web/UI imports** and is tested without the API. The API is a thin layer.
Everything is deterministic Python; no LLM is involved in parsing, validation, IP maths or policy analysis.

## 2. Parser strategy
Hand-written tokenizer + stack parser for native CLI (`config/edit/set/unset/append/select/unselect/delete/rename/move/next/end`,
quoted + escaped + multi-line quoted values, comments, blank lines). Output is a lossless AST (`Node`): every node keeps
line range, raw text, indent. Unknown lines become `raw` nodes (never dropped) and are reported as parse issues.
Unclosed `config`/`edit`, stray `end`/`next`, unterminated quotes are reported with line numbers.
`serialize(ast)` reproduces the input byte-for-byte for unmodified trees (tested). VDOM scopes (`config vdom/edit X`, `config global`) are tracked.

## 3. Object schema
`model.py` turns the AST into `Table` (path, scope, entries, table-level attrs, nested sub-tables) and `Entry`
(key, ordered attrs with `explicit` flag, line numbers). `schema/fos74.py` is the version module: known tables,
reference attributes (attr → namespace), defaults, predefined objects, predefined services. It is data, replaceable per
firmware/model via `schema/__init__.py` registry. Entries not in the schema are retained and listed as *unanalysed*.
**Honesty note:** the 7.4 schema was authored from engineer knowledge, not machine-extracted from the CLI reference
(no internet at build time); every default/enum is flagged `verified=False` until diffed against the 7.4.12 CLI reference.

## 4. Dependency graph
NetworkX `MultiDiGraph`; node = `"<table>|<name>"`, edge = reference (attr, source line). Builder walks every schema ref
attribute, resolves against namespaces (interface ⊃ interface/zone/sdwan-zone/tunnel; address ⊃ address/group/vip; …),
records unresolved refs as broken references. Queries: forward deps, reverse deps (impact), transitive closure, orphans,
cycles (group loops), per-object usage report, “what is affected if I change X”.

## 5. Policy matching & shadow detection
Each policy → *match space*: srcintf/dstintf (zones expanded to members), src/dst IPv4 network sets (groups expanded,
ranges summarised, `all`=0/0), service set (proto → port intervals; predefined table), schedule, user/group, negate flags.
`covers(A,B)` returns tri-state yes/no/unknown. Unknown arises from FQDN/geo/dynamic/VIP/negation/schedule/unrecognised
predefined services/source-port restrictions. Order = table order (FortiOS first-match; ID is not order).
- exact duplicate: identical match space + identical action/NAT/profiles
- confirmed shadowed: earlier enabled A covers B = *yes*
- potential shadowed/overlap: *unknown* or partial intersection with differing action
Nothing is deleted automatically; remediation for shadowed = `set status disable` (reversible), never merge.

## 6. Routing & VPN analysis
`routing.py` builds a static RIB (connected + static + SD-WAN zones) and policy-route list; dynamic protocols are inventoried and the
RIB is marked incomplete. `sim.py` = static path simulation (PBR → longest prefix/distance/priority → egress → candidate policies →
NAT → reverse-path check). VPN: phase1↔phase2↔tunnel interface↔routes↔policies (both directions)↔addresses; proposal strength;
selector overlaps; auto-route (`add-route`) respected. Tunnel *state* is never inferred from config.

## 7. Remediation safety model
Modes: audit-only (no changes) · assisted (per-change approve/reject) · controlled-auto (only `auto_eligible` changes:
deterministic, zero references in the whole file incl. raw-text scan, non-production-sensitive classes).
Never auto: WAN IPs, gateways, default routes, interfaces, zones, allow/deny, NAT/VIP, VPN, certificates, admins, HA, mgmt access, security profiles.
Every change = minimal CLI + rollback CLI + line-level patch on the original text. Pipeline: backup (sha256) → apply patches →
re-parse → reference revalidation (no new broken refs) → re-audit (finding gone, no new findings) → unified diff must touch only intended lines.
The tool never connects to a device.

## 8. Limits / requires live verification
Tunnel/HA/BGP/OSPF runtime state, dynamic routes, FQDN/geo/ISDB resolution, certificate validity, hit counts (shadow ≠ unused),
SD-WAN rule runtime selection, UTM signature state, FortiGuard licence, predefined objects not in the schema, firmware defaults not verified,
traffic logs (needed to confirm “unused”), peer-side VPN config.

## 9. Phases
1 Foundation (parser/model/explorer/import) → 2 Network intelligence (interfaces/zones/addresses/graph) → 3 Firewall (policy engine/NAT)
→ 4 Routing/VPN/sim → 5 Security/HA/diff → 6 Remediation → 7 Reports/packaging/hardening. All implemented in this repo; see README for status.

## 10. First milestone acceptance
Import → header says FortiOS 7.4.12 build 2902 / model 121G; parse with zero unknown lines; `serialize(parse(x)) == x`;
explorer tree with source lines; graph answers “what depends on port3”; baseline-mismatch warning if not 7.4.12.
