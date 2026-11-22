"""Inventory views used by the UI and reports."""
from __future__ import annotations

from .model import iface_type
from .netutil import safe_ipmask


def _refs(ctx, uid):
    g = ctx.g.g
    return sorted({u for u, _ in g.in_edges(uid)}) if uid in g else []


def _fids(ctx, uid):
    return [f.id for f in ctx.findings if uid in f.objects]


def interfaces(ctx):
    m, rib = ctx.m, ctx.cache["rib"]
    zone_of = {i: z.key for z in m.entries("system zone") for i in (z.get("interface") or [])}
    out = []
    for e in m.entries("system interface"):
        refs = _refs(ctx, e.uid)
        ip = safe_ipmask(e.get("ip"))
        sec = []
        st = e.sub.get("secondaryip")
        for s in (st or []):
            si = safe_ipmask(s.get("ip"))
            if si:
                sec.append(str(si))
        out.append({
            "uid": e.uid, "name": e.key, "type": iface_type(e), "alias": e.first("alias", ""),
            "ip": str(ip) if ip and not ip.ip.is_unspecified else "", "secondary": sec, "parent": e.first("interface", ""),
            "vlanid": e.first("vlanid", ""), "status": e.first("status", "up"), "allowaccess": e.text("allowaccess"),
            "mtu": e.first("mtu", "1500") if e.first("mtu-override") == "enable" else "", "mode": e.first("mode", "static"),
            "role": e.first("role", "undefined"), "zone": zone_of.get(e.key, ""), "vdom": e.first("vdom", "root"),
            "members": e.get("member") or [],
            "policies": [r for r in refs if r.startswith("firewall policy")],
            "routes": [r for r in refs if r.startswith("router")],
            "vpn": [r for r in refs if r.startswith("vpn")],
            "dhcp": [r for r in refs if r.startswith("system dhcp")],
            "other_refs": [r for r in refs if not r.startswith(("firewall policy", "router", "vpn", "system dhcp"))],
            "line": e.node.line, "findings": _fids(ctx, e.uid)})
    return out


def zones(ctx):
    return [{"uid": z.uid, "name": z.key, "members": z.get("interface") or [], "intrazone": z.first("intrazone", "deny"),
             "policies": [r for r in _refs(ctx, z.uid) if r.startswith("firewall policy")], "line": z.node.line,
             "findings": _fids(ctx, z.uid)} for z in ctx.m.entries("system zone")]


def addresses(ctx):
    out = []
    for path in ("firewall address", "firewall address6", "firewall addrgrp", "firewall addrgrp6", "firewall vip"):
        for e in ctx.m.entries(path):
            typ = "group" if "grp" in path else ("vip" if "vip" in path else e.first("type", "ipmask"))
            if typ == "ipmask":
                ip = safe_ipmask(e.get("subnet"))
                val = str(ip.network) if ip else e.text("subnet")
            elif typ == "iprange":
                val = f"{e.first('start-ip')} - {e.first('end-ip')}"
            elif typ == "fqdn":
                val = e.first("fqdn", "")
            elif typ == "group":
                val = ", ".join(e.get("member") or [])
            elif typ == "vip":
                val = f"{e.text('extip')} -> {e.text('mappedip')}" + (f" {e.first('protocol','tcp')}/{e.first('extport')}->{e.first('mappedport')}"
                                                                       if e.first("portforward") == "enable" else " (1:1)")
            else:
                val = e.text("country") or e.text("ip6") or e.text("macaddr") or e.text("wildcard")
            refs = _refs(ctx, e.uid)
            out.append({"uid": e.uid, "table": path, "name": e.key, "type": typ, "value": val,
                        "interface": e.first("associated-interface", "") or e.first("extintf", ""), "refs": refs,
                        "ref_count": len(refs), "comment": e.first("comment", ""), "line": e.node.line,
                        "findings": _fids(ctx, e.uid)})
    return out


def policies(ctx):
    out = []
    order = 0
    for path in ("firewall policy", "firewall policy6"):
        for p in ctx.m.entries(path):
            order += 1
            prof = [f"{a}={p.first(a)}" for a in ("av-profile", "webfilter-profile", "application-list", "ips-sensor",
                                                  "dnsfilter-profile", "ssl-ssh-profile", "file-filter-profile", "profile-group")
                    if p.explicit(a)]
            fids = _fids(ctx, p.uid)
            sev = [f.severity for f in ctx.findings if f.id in fids]
            risk = next((s for s in ("critical", "high", "medium", "low", "info") if s in sev), "")
            out.append({"uid": p.uid, "table": path, "seq": order, "id": p.key, "name": p.first("name", ""),
                        "srcintf": p.text("srcintf"), "dstintf": p.text("dstintf"), "srcaddr": p.text("srcaddr"),
                        "dstaddr": p.text("dstaddr"), "service": p.text("service"), "schedule": p.first("schedule", ""),
                        "action": p.first("action", "deny"), "status": p.first("status", "enable"),
                        "nat": p.first("nat", "disable"), "poolname": p.text("poolname"), "profiles": prof,
                        "logtraffic": p.first("logtraffic", "utm"), "users": p.text("groups") or p.text("users"),
                        "comments": p.first("comments", ""), "line": p.node.line, "findings": fids, "risk": risk})
    return out


def routes(ctx):
    rib = ctx.cache["rib"]
    st = []
    for r in ctx.m.entries("router static"):
        d = safe_ipmask(r.get("dst"))
        st.append({"uid": r.uid, "id": r.key, "dst": str(d.network) if d else r.text("dst"), "gateway": r.first("gateway", ""),
                   "device": r.first("device", "") or r.text("sdwan-zone"), "distance": r.first("distance", "10"),
                   "priority": r.first("priority", "1"), "blackhole": r.first("blackhole", "disable"),
                   "status": r.first("status", "enable"), "comment": r.first("comment", ""), "line": r.node.line,
                   "findings": _fids(ctx, r.uid)})
    pbr = [{"uid": p.uid, "id": p.key, "input": p.text("input-device"), "src": p.text("src") or p.text("srcaddr"),
            "dst": p.text("dst") or p.text("dstaddr"), "protocol": p.first("protocol", "0"), "output": p.first("output-device", ""),
            "gateway": p.first("gateway", ""), "status": p.first("status", "enable"), "line": p.node.line,
            "findings": _fids(ctx, p.uid)} for p in ctx.m.entries("router policy")]
    return {"static": st, "policy_routes": pbr, "rib": [r.to_dict() for r in rib.routes], "incomplete": rib.incomplete}


def vpn(ctx):
    m, exp, rib = ctx.m, ctx.cache["exp"], ctx.cache["rib"]
    out = []
    for p1 in m.entries("vpn ipsec phase1-interface"):
        p2s = [p for p in m.entries("vpn ipsec phase2-interface") if p.first("phase1name") == p1.key]
        pols = [p for p in m.entries("firewall policy")
                if p1.key in (exp.intf(p.get("srcintf")) or set()) or p1.key in (exp.intf(p.get("dstintf")) or set())]
        pols = [p for p in pols]
        routes = [r for r in m.entries("router static") if r.first("device") == p1.key]
        addrs = sorted({a for p in pols for a in (p.get("srcaddr") or []) + (p.get("dstaddr") or [])})
        uids = {p1.uid, *(p.uid for p in p2s), *(p.uid for p in pols), *(r.uid for r in routes)}
        wan = m.entry("system interface", p1.first("interface", ""))
        if wan:
            uids.add(wan.uid)
        ti = m.entry("system interface", p1.key)
        if ti:
            uids.add(ti.uid)
        for a in addrs:
            e = ctx.r.resolve("address", a)
            if e and e != "predefined":
                uids.add(e.uid)
        out.append({"uid": p1.uid, "name": p1.key, "interface": p1.first("interface", ""), "remote_gw": p1.first("remote-gw", ""),
                    "type": p1.first("type", "static"), "ike": p1.first("ike-version", "1"), "proposal": p1.text("proposal"),
                    "dhgrp": p1.text("dhgrp"), "mode": p1.first("mode", "main"), "authmethod": p1.first("authmethod", "psk"),
                    "dpd": p1.first("dpd", "on-demand"), "nattraversal": p1.first("nattraversal", "enable"),
                    "phase2": [{"uid": p.uid, "name": p.key, "src": p.text("src-subnet") or p.text("src-name"),
                                "dst": p.text("dst-subnet") or p.text("dst-name"), "proposal": p.text("proposal"),
                                "pfs": p.first("pfs", "enable"), "dhgrp": p.text("dhgrp"), "line": p.node.line} for p in p2s],
                    "policies_in": [p.key for p in pols if p1.key in (exp.intf(p.get("srcintf")) or set())],
                    "policies_out": [p.key for p in pols if p1.key in (exp.intf(p.get("dstintf")) or set())],
                    "routes": [r.key for r in routes], "addresses": addrs, "line": p1.node.line,
                    "graph": ctx.g.subgraph_json(uids), "findings": _fids(ctx, p1.uid)})
    return out


def nat(ctx):
    m = ctx.m
    return {"central_nat": bool(ctx.cache.get("central_nat")),
            "vips": [a for a in addresses(ctx) if a["type"] == "vip"],
            "ippools": [{"uid": p.uid, "name": p.key, "type": p.first("type", "overload"), "start": p.first("startip"),
                         "end": p.first("endip"), "refs": _refs(ctx, p.uid), "line": p.node.line, "findings": _fids(ctx, p.uid)}
                        for p in m.entries("firewall ippool")],
            "snat": [{"uid": s.uid, "id": s.key, "srcintf": s.text("srcintf"), "dstintf": s.text("dstintf"),
                      "orig": s.text("orig-addr"), "dst": s.text("dst-addr"), "pool": s.text("nat-ippool"), "line": s.node.line}
                     for s in m.entries("firewall central-snat-map")]}


def dhcp(ctx):
    out = []
    for d in ctx.m.entries("system dhcp server"):
        rng = [f"{r.first('start-ip')}-{r.first('end-ip')}" for r in (d.sub.get("ip-range") or [])]
        res = [f"{r.first('ip')} {r.first('mac')}" for r in (d.sub.get("reserved-address") or [])]
        out.append({"uid": d.uid, "id": d.key, "interface": d.first("interface"), "gateway": d.first("default-gateway"),
                    "netmask": d.first("netmask"), "ranges": rng, "reserved": res, "dns": d.first("dns-service", "default"),
                    "status": d.first("status", "enable"), "line": d.node.line, "findings": _fids(ctx, d.uid)})
    dns = ctx.m.table("system dns")
    return {"servers": out, "dns": {"primary": dns.first("primary"), "secondary": dns.first("secondary")} if dns else {}}


def profiles(ctx):
    out = []
    for path in ("antivirus profile", "webfilter profile", "application list", "ips sensor", "dnsfilter profile",
                 "firewall ssl-ssh-profile", "file-filter profile", "dlp profile", "firewall profile-group"):
        for e in ctx.m.entries(path):
            out.append({"uid": e.uid, "table": path, "name": e.key, "used_by": _refs(ctx, e.uid), "line": e.node.line,
                        "findings": _fids(ctx, e.uid)})
    return out


def dashboard(ctx, result):
    m = ctx.m
    return {"identity": m.identity(), "counts": {
        "interfaces": len(m.entries("system interface")), "zones": len(m.entries("system zone")),
        "policies": len(m.entries("firewall policy")) + len(m.entries("firewall policy6")),
        "addresses": len(m.entries("firewall address")) + len(m.entries("firewall address6")),
        "address_groups": len(m.entries("firewall addrgrp")), "vips": len(m.entries("firewall vip")),
        "vpn_tunnels": len(m.entries("vpn ipsec phase1-interface")), "static_routes": len(m.entries("router static")),
        "policy_routes": len(m.entries("router policy")), "admins": len(m.entries("system admin")),
        "lines": len(m.pc.lines), "tables": len(m.all_tables())},
        "summary": result.summary(), "graph": ctx.g.stats(), "audit_seconds": round(result.duration, 3)}


def topology(ctx):
    """Nodes: interfaces/zones/tunnels/subnets; edges: membership, parent, tunnel-over, connected subnet, routes."""
    m, rib = ctx.m, ctx.cache["rib"]
    nodes, edges = [], []
    for e in m.entries("system interface"):
        t = iface_type(e)
        nodes.append({"id": e.uid, "label": e.key + (f" ({e.first('alias')})" if e.first("alias") else ""), "kind": t,
                      "role": e.first("role", "undefined")})
        if e.first("interface") and t in ("vlan", "tunnel"):
            pe = m.entry("system interface", e.first("interface"))
            if pe:
                edges.append({"source": e.uid, "target": pe.uid, "kind": "parent" if t == "vlan" else "over"})
        for mb in e.get("member") or []:
            me = m.entry("system interface", mb)
            if me:
                edges.append({"source": e.uid, "target": me.uid, "kind": "member"})
        for i in rib.connected.get(e.key, []):
            nid = f"net|{i.network}"
            nodes.append({"id": nid, "label": str(i.network), "kind": "subnet", "role": ""})
            edges.append({"source": e.uid, "target": nid, "kind": "connected"})
    for z in m.entries("system zone"):
        nodes.append({"id": z.uid, "label": z.key, "kind": "zone", "role": ""})
        for i in z.get("interface") or []:
            ie = m.entry("system interface", i)
            if ie:
                edges.append({"source": z.uid, "target": ie.uid, "kind": "zone-member"})
    for r in rib.routes:
        if r.kind in ("static", "sdwan", "ipsec-auto"):
            nid = f"net|{r.dst}"
            nodes.append({"id": nid, "label": str(r.dst) + (" (default)" if r.dst.prefixlen == 0 else ""), "kind": "route", "role": ""})
            for d in r.devices:
                ie = m.entry("system interface", d)
                if ie:
                    edges.append({"source": ie.uid, "target": nid, "kind": "route", "label": r.gateway or ""})
    seen, un = set(), []
    for n in nodes:
        if n["id"] not in seen:
            seen.add(n["id"])
            un.append(n)
    return {"nodes": un, "edges": edges}
