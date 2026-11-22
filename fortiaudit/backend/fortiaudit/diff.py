"""Semantic configuration diff (object/attribute level, not line level) and HA member comparison."""
from __future__ import annotations

from .graph import DepGraph
from .model import ConfigModel, Entry
from .redact import is_sensitive

MATCH = {"srcintf", "dstintf", "srcaddr", "dstaddr", "service", "schedule", "users", "groups", "srcaddr-negate",
         "dstaddr-negate", "service-negate", "internet-service", "internet-service-name", "srcaddr6", "dstaddr6"}
PROFILES = {"av-profile", "webfilter-profile", "application-list", "ips-sensor", "dnsfilter-profile", "ssl-ssh-profile",
            "file-filter-profile", "profile-group", "dlp-profile", "utm-status", "inspection-mode"}


def classify(path: str, attr: str) -> str:
    if is_sensitive(path, attr):
        return "secret/credential changed (values redacted)"
    if path in ("firewall policy", "firewall policy6"):
        if attr in MATCH:
            return "policy matching behaviour"
        if attr == "action":
            return "allow/deny decision"
        if attr == "status":
            return "policy enabled/disabled"
        if attr in ("nat", "poolname", "ippool"):
            return "NAT behaviour"
        if attr in PROFILES:
            return "security enforcement"
        if attr in ("logtraffic", "logtraffic-start"):
            return "logging"
        if attr == "__order__":
            return "policy ordering (first-match outcome)"
        return "policy attribute"
    if path.startswith("router"):
        return "routing"
    if path.startswith("vpn"):
        return "VPN"
    if path == "system interface":
        return "interface addressing" if attr in ("ip", "secondaryip") else (
            "management access" if attr == "allowaccess" else "interface")
    if path == "system zone":
        return "zone membership"
    if path.startswith("firewall vip") or path.startswith("firewall ippool") or "snat" in path:
        return "NAT"
    if path.startswith("firewall addr") or path.startswith("firewall address"):
        return "address definition"
    if path in ("system admin", "system accprofile"):
        return "administrative access"
    if path == "system ha":
        return "high availability"
    if path.startswith("vpn certificate"):
        return "certificate"
    return "configuration"


def flatten(e: Entry, prefix="") -> dict:
    out = {}
    for k, a in e.attrs.items():
        out[prefix + k] = tuple(a.values) if a.op == "set" else ("<unset>",)
    for sname, st in e.sub.items():
        for se in st:
            out.update(flatten(se, f"{prefix}{sname}[{se.key}]."))
        for k, a in st.attrs.items():
            out[f"{prefix}{sname}.{k}"] = tuple(a.values)
    return out


def _tables(m: ConfigModel):
    return {t.path: t for t in m.all_tables()}


def semantic_diff(a: ConfigModel, b: ConfigModel, impact=True) -> dict:
    ta, tb = _tables(a), _tables(b)
    ga = DepGraph(a) if impact else None
    items = []
    for path in sorted(set(ta) | set(tb)):
        A, B = ta.get(path), tb.get(path)
        ea = {e.key: e for e in A} if A is not None else {}
        eb = {e.key: e for e in B} if B is not None else {}
        for k in ea.keys() - eb.keys():
            items.append(_item("removed", path, k, ea[k], None, ga))
        for k in eb.keys() - ea.keys():
            items.append(_item("added", path, k, None, eb[k], ga))
        for k in ea.keys() & eb.keys():
            fa, fb = flatten(ea[k]), flatten(eb[k])
            ch = []
            for attr in sorted(set(fa) | set(fb)):
                if fa.get(attr) != fb.get(attr):
                    sens = is_sensitive(path, attr.split(".")[-1])
                    ch.append({"attr": attr, "before": "<redacted>" if sens else _fmt(fa.get(attr)),
                               "after": "<redacted>" if sens else _fmt(fb.get(attr)),
                               "category": classify(path, attr.split(".")[-1].split("[")[0])})
            if ch:
                it = _item("modified", path, k, ea[k], eb[k], ga)
                it["changes"] = ch
                it["categories"] = sorted({c["category"] for c in ch})
                items.append(it)
        # table-level (singleton) attributes
        aa = {k: tuple(v.values) for k, v in (A.attrs.items() if A is not None else [])}
        bb = {k: tuple(v.values) for k, v in (B.attrs.items() if B is not None else [])}
        ch = []
        for attr in sorted(set(aa) | set(bb)):
            if aa.get(attr) != bb.get(attr):
                sens = is_sensitive(path, attr)
                ch.append({"attr": attr, "before": "<redacted>" if sens else _fmt(aa.get(attr)),
                           "after": "<redacted>" if sens else _fmt(bb.get(attr)), "category": classify(path, attr)})
        if ch:
            items.append({"type": "modified", "table": path, "key": "_", "uid": f"{path}|_", "changes": ch,
                          "categories": sorted({c["category"] for c in ch}),
                          "line_a": A.node.line if A is not None else None, "line_b": B.node.line if B is not None else None,
                          "dependents": 0})
        # ordering for order-sensitive tables
        if path in ("firewall policy", "firewall policy6", "router policy", "firewall local-in-policy",
                    "firewall central-snat-map") and A is not None and B is not None:
            common = [k for k in ea if k in eb]
            ob = [k for k in eb if k in ea]
            if common != ob:
                moved = [k for i, k in enumerate(common) if ob.index(k) != i]
                items.append({"type": "reordered", "table": path, "key": "__order__", "uid": f"{path}|__order__",
                              "categories": [classify(path, "__order__")], "moved": moved[:50],
                              "order_before": common[:200], "order_after": ob[:200], "dependents": 0})
    counts = {}
    for it in items:
        counts[it["type"]] = counts.get(it["type"], 0) + 1
    return {"items": items, "counts": counts}


def _fmt(v):
    return None if v is None else " ".join(v)


def _item(typ, path, key, ea, eb, ga):
    uid = f"{path}|{key}"
    dep = len(ga.dependents(uid)) if (ga is not None and ea is not None) else 0
    return {"type": typ, "table": path, "key": key, "uid": uid, "categories": [classify(path, "")],
            "line_a": ea.node.line if ea else None, "line_b": eb.node.line if eb else None, "dependents": dep}


# ---------------- HA comparison ----------------
EXPECTED_HA_DIFF = [
    (("system global", "hostname"), "Hostnames are per-unit and not synchronised."),
    (("system global", "alias"), "Alias is per-unit."),
    (("system ha", "priority"), "Device priority is per-unit and is expected to differ."),
    (("system ha", "override"), "Override is per-unit (but should normally be identical)."),
    (("system ha", "ha-mgmt-interfaces"), "Reserved HA management interface addressing is per-unit."),
    (("system ha", "ha-direct"), "Per-unit."),
    (("system interface", "__mgmt__"), "Dedicated/reserved management interface addressing is per-unit."),
    (("system central-management", "serial-number"), "Per-unit."),
    (("system snmp sysinfo", "description"), "Per-unit SNMP sysinfo."),
    (("vpn certificate local", "Fortinet_"), "Factory/built-in certificates are unique per unit."),
]
MUST_MATCH_HA = {"group-name", "group-id", "mode", "hbdev", "monitor", "session-pickup", "password",
                 "unicast-hb", "hb-interval", "hb-lost-threshold"}


def ha_compare(primary: ConfigModel, secondary: ConfigModel) -> dict:
    d = semantic_diff(primary, secondary, impact=True)
    mgmt_ifaces = set()
    for m in (primary, secondary):
        ha = m.table("system ha")
        if ha is not None:
            st = ha.sub.get("ha-mgmt-interfaces")
            for e in (st or []):
                if e.first("interface"):
                    mgmt_ifaces.add(e.first("interface"))
    out = []
    for it in d["items"]:
        verdict, reason = "concerning", "HA synchronises this configuration; a difference indicates the members are out of sync or one file is stale."
        t, k = it["table"], it["key"]
        attrs = [c["attr"] for c in it.get("changes", [])]
        if t == "vpn certificate local" and k.startswith("Fortinet_"):
            verdict, reason = "expected", "Factory certificates are unique per unit."
        elif t.startswith("vpn certificate"):
            verdict, reason = "review", ("Certificate/CA differences matter: VPN, SSL inspection and admin GUI may present "
                                         "a different certificate after failover. Verify which unit holds the correct one.")
        elif t == "system interface" and k in mgmt_ifaces:
            verdict, reason = "expected", "Reserved HA management interface; per-unit addressing."
        elif attrs and all(any((t, a.split("[")[0].split(".")[0]) == exp[0] or (exp[0][0] == t and a.startswith(exp[0][1]))
                               for exp in EXPECTED_HA_DIFF) for a in attrs):
            verdict, reason = "expected", "; ".join({r for exp, r in EXPECTED_HA_DIFF for a in attrs
                                                     if exp[0] == t and a.startswith(exp[1])})
        if t == "system ha":
            bad = [a for a in attrs if a.split(".")[0].split("[")[0] in MUST_MATCH_HA]
            if bad:
                verdict, reason = "critical", f"HA cluster parameters must match on all members: {', '.join(bad)}."
            elif verdict != "expected":
                verdict = "review"
        if any(c.get("category", "").startswith("secret") for c in it.get("changes", [])) and verdict == "concerning":
            verdict, reason = "review", ("Encrypted values differ. FortiOS encrypts secrets per export, so differing ENC "
                                         "strings do not prove different secrets - verify on the devices.")
        it["verdict"], it["reason"] = verdict, reason
        out.append(it)
    ia, ib = primary.identity(), secondary.identity()
    ident = []
    for f in ("model", "version", "build"):
        if ia.get(f) != ib.get(f):
            ident.append({"field": f, "primary": ia.get(f), "secondary": ib.get(f),
                          "verdict": "critical", "reason": "HA members must run the same model and firmware build."})
    summ = {}
    for it in out:
        summ[it["verdict"]] = summ.get(it["verdict"], 0) + 1
    return {"identity": {"primary": ia, "secondary": ib, "mismatches": ident}, "items": out, "summary": summ,
            "note": "Configuration-file comparison only. Use `diagnose sys ha checksum cluster` to verify live sync. "
                    "Never force synchronisation or reboot based solely on this report."}
