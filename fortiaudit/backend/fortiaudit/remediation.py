"""Remediation engine: minimal change sets, CLI + rollback generation, line-level patching, revalidation.

The engine never connects to a device. It only produces text.
"""
from __future__ import annotations

import difflib
import hashlib
from dataclasses import asdict, dataclass, field

from .parser import quote_value

LOW, MEDIUM, HIGH = "low", "medium", "high"

# change classes that may NEVER be auto-applied regardless of request (safety policy)
NEVER_AUTO_TABLES = {"system interface", "system zone", "router static", "router policy", "firewall vip",
                     "firewall ippool", "firewall central-snat-map", "vpn ipsec phase1-interface",
                     "vpn ipsec phase2-interface", "system admin", "system ha", "system global",
                     "vpn certificate local", "vpn certificate ca", "firewall policy", "system accprofile",
                     "firewall local-in-policy", "system sdwan"}


@dataclass
class Op:
    kind: str  # delete_entry | set_attr | unset_attr
    path: str
    key: str
    attr: str = ""
    values: list = field(default_factory=list)
    quoted: list = field(default_factory=list)


@dataclass
class Change:
    finding_id: str
    title: str
    risk: str
    ops: list
    explanation: str
    side_effects: str
    auto_eligible: bool = False
    affected: list = field(default_factory=list)
    validation: str = ""
    commands: str = ""
    rollback: str = ""
    before: str = ""
    after: str = ""
    id: str = ""

    def to_dict(self):
        d = asdict(self)
        return d


def _q(name: str) -> str:
    return name if name.isdigit() else quote_value(name, force=True)


def _scope_wrap(model, entry, body: list[str]) -> list[str]:
    if not model.multi_vdom:
        return body
    if entry.table.scope == "global":
        return ["config global"] + ["    " + b for b in body] + ["end"]
    return ["config vdom", f"edit {entry.table.scope}"] + ["    " + b for b in body] + ["next", "end"]


def _fmt_vals(vals, quoted):
    return " ".join(quote_value(v, quoted[i] if i < len(quoted) else False) for i, v in enumerate(vals))


def build_change(ctx, finding, title, risk, ops: list[Op], explanation, side_effects, auto_eligible=False,
                 validation="") -> Change:
    m = ctx.m
    cmds, rb, before, after = [], [], [], []
    affected = []
    for op in ops:
        e = m.entry(op.path, op.key)
        if e is None:
            raise ValueError(f"remediation target {op.path} {op.key} not found")
        if op.path in NEVER_AUTO_TABLES:
            auto_eligible = False
        affected.append(e.uid)
        orig = m.pc.lines[e.node.line - 1:e.node.end_line]
        before.extend(orig)
        if op.kind == "delete_entry":
            cmds += _scope_wrap(m, e, [f"config {op.path}", f"    delete {_q(op.key)}", "end"])
            body = _dedent(orig)
            siblings = list(e.table)
            nxt = siblings[e.index + 1].key if e.index + 1 < len(siblings) else None
            rbody = [f"config {op.path}"] + ["    " + x for x in body]
            if op.path == "firewall policy" and nxt is not None:
                rbody.append(f"    move {_q(op.key)} before {_q(nxt)}")
            rbody.append("end")
            rb += _scope_wrap(m, e, rbody)
            after.append(f"# {op.path} {op.key} deleted")
        else:
            a = e.attrs.get(op.attr)
            if op.kind == "set_attr":
                line = f"set {op.attr} {_fmt_vals(op.values, op.quoted)}"
            else:
                line = f"unset {op.attr}"
            cmds += _scope_wrap(m, e, [f"config {op.path}", f"    edit {_q(op.key)}", f"        {line}", "    next", "end"])
            if a is not None and a.op == "set":
                r = f"set {op.attr} {_fmt_vals(a.values, a.quoted)}"
            else:
                r = f"unset {op.attr}"
            rb += _scope_wrap(m, e, [f"config {op.path}", f"    edit {_q(op.key)}", f"        {r}", "    next", "end"])
    ch = Change(finding.id, title, risk, ops, explanation, side_effects, auto_eligible, affected, validation,
                "\n".join(cmds), "\n".join(rb), "\n".join(before), "\n".join(after))
    ch.id = "CH-" + hashlib.sha1((finding.id + repr([asdict(o) for o in ops])).encode()).hexdigest()[:10]
    if not ch.after or ops[0].kind != "delete_entry":
        ch.after = "\n".join(preview_after(m, ops))
    finding.changes.append(ch.id)
    ctx.changes[ch.id] = ch
    return ch


def _dedent(lines):
    import textwrap
    return textwrap.dedent("\n".join(lines)).split("\n")


def preview_after(m, ops):
    lines = list(m.pc.lines)
    patched = _patch_lines(m, lines, ops)
    out = []
    for op in ops:
        e = m.entry(op.path, op.key)
        out.append(f"# {op.path} {op.key}")
    return out + [l for l in difflib.unified_diff(lines, patched, lineterm="", n=1)][2:]


def _patch_lines(m, lines: list[str], ops: list[Op]) -> list[str]:
    """Apply ops as (start,end,replacement) line patches against the ORIGINAL line numbers."""
    patches = []  # (start_idx, end_idx_exclusive, new_lines)
    for op in ops:
        e = m.entry(op.path, op.key)
        if e is None:
            raise ValueError(f"target {op.path} {op.key} not found")
        if op.kind == "delete_entry":
            patches.append((e.node.line - 1, e.node.end_line, []))
            continue
        a = e.attrs.get(op.attr)
        if a is not None:
            ind = a.node.indent()
            new = [] if op.kind == "unset_attr" else [f"{ind}set {op.attr} {_fmt_vals(op.values, op.quoted)}"]
            patches.append((a.node.line - 1, a.node.end_line, new))
        elif op.kind == "set_attr":
            sib = next((c for c in e.node.children if c.kind == "set"), None)
            ind = sib.indent() if sib else e.node.indent() + "    "
            at = (e.node.closer_line or e.node.end_line) - 1
            patches.append((at, at, [f"{ind}set {op.attr} {_fmt_vals(op.values, op.quoted)}"]))
    patches.sort(key=lambda p: (p[0], p[1]))
    for a, b in zip(patches, patches[1:]):
        if b[0] < a[1]:
            raise ValueError("conflicting changes touch overlapping configuration lines")
    out = list(lines)
    for s, e, new in sorted(patches, key=lambda p: p[0], reverse=True):
        out[s:e] = new
    return out


def apply_changes(model, changes: list[Change]) -> str:
    ops = [op for c in changes for op in c.ops]
    new_lines = _patch_lines(model, list(model.pc.lines), ops)
    pc = model.pc
    return pc.eol.join(new_lines) + (pc.eol if pc.trailing_newline else "")


def script(changes: list[Change], model) -> str:
    ident = model.identity()
    hdr = [f"# FortiAudit remediation script - target {ident.get('hostname')} FortiOS {ident.get('version')} build {ident.get('build')}",
           "# REVIEW BEFORE USE. Generated offline; never applied automatically. Take a backup first.", ""]
    body, rb = [], ["# ===== ROLLBACK (apply in this order if needed) ====="]
    for c in changes:
        body += [f"# [{c.id}] {c.title} (risk: {c.risk}, finding {c.finding_id})", c.commands, ""]
    for c in reversed(changes):
        rb += [f"# rollback {c.id}", c.rollback, ""]
    return "\n".join(hdr + body + rb)


def _token_index(pc):
    idx = getattr(pc, "_tokidx", None)
    if idx is None:
        idx = {}
        for n in pc.root.walk():
            if n.kind in ("set", "append", "select", "unselect"):
                toks = n.args[1:]
            elif n.kind == "raw":
                toks = n.args
            else:
                continue
            for t in set(toks):
                idx.setdefault(t, []).append(n)
        pc._tokidx = idx
    return idx


def name_mentions(pc, name: str, exclude_node=None) -> list[int]:
    """Token-level scan of the entire file for a name (catches references outside the schema)."""
    return [n.line for n in _token_index(pc).get(name, []) if n is not exclude_node and n.parent is not exclude_node]


def validate(original_model, new_text: str, applied: list[Change], baseline_findings) -> dict:
    """Re-parse and re-audit the remediated configuration."""
    from .audit import run_audit
    from .model import load

    new_model = load(new_text)
    res = run_audit(new_model)
    new_ids = {f.id for f in res.findings}
    targeted = {c.finding_id for c in applied}
    still = sorted(targeted & new_ids)
    base_ids = {f.id for f in baseline_findings}
    introduced = [f.to_dict() for f in res.findings if f.id not in base_ids]
    old_broken = {(b.src, b.attr, b.value) for b in original_model_graph_broken(original_model)}
    new_broken = [b.to_dict() for b in res.ctx.g.broken if (b.src, b.attr, b.value) not in old_broken]
    # independent semantic check: every object that changed must belong to an applied change
    from .diff import semantic_diff
    sd = semantic_diff(original_model, new_model, impact=False)
    allowed = {u for c in applied for u in c.affected}
    unexpected = [{"type": it["type"], "uid": it["uid"]} for it in sd["items"] if it["uid"] not in allowed]
    touched = sd["items"]
    parse_errors = [i.to_dict() for i in new_model.issues if i.severity == "error"]
    blocking_new = [f for f in introduced if f["severity"] not in ("info", "low")]
    ok = not still and not new_broken and not unexpected and not parse_errors and not blocking_new
    return {"ok": ok, "blocking_new_findings": [f["id"] for f in blocking_new],"parse_errors": parse_errors, "remaining_targeted_findings": still,
            "new_findings": introduced, "new_broken_references": new_broken,
            "unexpected_line_changes": unexpected, "semantic_changes": [{"type": t["type"], "uid": t["uid"], "changes": t.get("changes", [])} for t in touched],
            "summary_after": res.summary()}


def original_model_graph_broken(model):
    from .graph import DepGraph
    return DepGraph(model).broken
