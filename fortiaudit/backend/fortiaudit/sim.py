"""Static network path simulation. This is a configuration-based reconstruction, not `diagnose firewall iprope lookup`."""
from __future__ import annotations

import ipaddress as ipa

from .netutil import range_to_nets
from .policy_engine import ANY, AddrSet, SvcSet, YES, NO, UNK, match_space

PROTO = {"tcp": 6, "udp": 17, "icmp": 1, "sctp": 132}


def _ingress(rib, src):
    """Expected ingress interface = interface that routes back to the source (reverse path)."""
    return rib.egress(src)


def _pbr(ctx, src, dst, proto, port, inif):
    exp = ctx.cache["exp"]
    for pr in ctx.m.entries("router policy"):
        if pr.first("status", "enable") != "enable":
            continue
        ins = pr.get("input-device") or []
        if ins and inif and not (set(ins) & inif):
            continue
        if not _pbr_addr(exp, pr, "src", "srcaddr", src) or not _pbr_addr(exp, pr, "dst", "dstaddr", dst):
            continue
        p = int(pr.first("protocol", "0") or 0)
        if p and p != PROTO.get(proto, -1):
            continue
        sp, ep = int(pr.first("start-port", "1")), int(pr.first("end-port", "65535"))
        if port is not None and proto in ("tcp", "udp", "sctp") and not sp <= port <= ep:
            continue
        return pr
    return None


def _pbr_addr(exp, pr, attr, objattr, ip):
    vals = pr.get(attr)
    objs = pr.get(objattr)
    if objs:
        s = exp.addr(objs)
        return any(ip in n for n in s.nets) or (not s.nets and bool(s.opaque))
    if not vals:
        return True
    toks = list(vals)
    nets = []
    i = 0
    while i < len(toks):
        t = toks[i]
        if "/" in t:
            nets.append(ipa.ip_network(t, strict=False)); i += 1
        elif i + 1 < len(toks) and toks[i + 1].count(".") == 3:
            nets.append(ipa.ip_network(f"{t}/{toks[i+1]}", strict=False)); i += 2
        else:
            i += 1
    return any(ip in n for n in nets) if nets else True


def simulate(ctx, src_ip: str, dst_ip: str, proto: str = "tcp", port: int | None = 443, src_intf: str | None = None) -> dict:
    rib = ctx.cache["rib"]
    exp = ctx.cache["exp"]
    src, dst = ipa.ip_address(src_ip), ipa.ip_address(dst_ip)
    steps, issues = [], []
    inferred_in = _ingress(rib, src)
    inif = {src_intf} if src_intf else inferred_in
    steps.append({"step": "ingress", "result": sorted(inif) or ["unknown"],
                  "note": "given" if src_intf else "inferred from the route back to the source (reverse path)"})
    if src_intf and inferred_in and src_intf not in inferred_in:
        issues.append(f"Reverse-path: routes to {src} point to {', '.join(sorted(inferred_in))}, not {src_intf}; "
                      "RPF check may drop the session.")
    # VIP DNAT (checked before routing in FortiOS)
    vip_hit = None
    for v in ctx.m.entries("firewall vip"):
        if v.first("type", "static-nat") != "static-nat":
            continue
        ext = (v.get("extip") or [""])[0]
        try:
            a, _, b = ext.partition("-")
            ext_nets = range_to_nets(a, b or a) if a else []
        except ValueError:
            continue
        if any(dst in n for n in ext_nets):
            ei = v.first("extintf", "any")
            if ei != "any" and inif and ei not in inif:
                continue
            if v.first("portforward") == "enable":
                if (v.first("protocol", "tcp") != proto) or port is None:
                    continue
                ep = v.first("extport", "0")
                lo, _, hi = ep.partition("-")
                if not int(lo) <= port <= int(hi or lo):
                    continue
            vip_hit = v
            break
    post_dst = dst
    if vip_hit is not None:
        mip = (vip_hit.get("mappedip") or ["0.0.0.0"])[0].split("-")[0]
        post_dst = ipa.ip_address(mip)
        steps.append({"step": "dnat", "result": f"VIP {vip_hit.key}: {dst} -> {post_dst}", "object": vip_hit.uid})
    pbr = _pbr(ctx, src, post_dst, proto, port, inif)
    if pbr is not None and pbr.first("output-device"):
        out = {pbr.first("output-device")}
        steps.append({"step": "policy-route", "result": f"seq {pbr.key} -> {pbr.first('output-device')} gw {pbr.first('gateway')}",
                      "object": pbr.uid})
    else:
        if pbr is not None:
            steps.append({"step": "policy-route", "result": f"seq {pbr.key} matched without output-device: stop PBR, use RIB",
                          "object": pbr.uid})
        rts = rib.lookup(post_dst)
        out = rib.egress(post_dst)
        steps.append({"step": "route-lookup", "result": [r.to_dict() for r in rts] or "no route",
                      "note": "longest prefix > distance > priority; " + ("ECMP" if len(rts) > 1 else "")})
        if not rts:
            issues.append(f"No route to {post_dst} in the static RIB (dynamic routes not modelled).")
        if "blackhole" in out:
            issues.append(f"Destination {post_dst} resolves to a blackhole route: traffic is dropped.")
    steps.append({"step": "egress", "result": sorted(out) or ["none"]})
    # policy lookup
    pkt_src = AddrSet([ipa.ip_network(f"{src}/{src.max_prefixlen}")])
    pkt_dst = AddrSet([ipa.ip_network(f"{post_dst}/{post_dst.max_prefixlen}")])
    if vip_hit is not None:
        pkt_dst.opaque["vip:" + vip_hit.key] = "vip"
    svc = SvcSet()
    if proto in ("tcp", "udp", "sctp"):
        svc.add(proto, port or 0, port or 0)
    elif proto == "icmp":
        svc.add("icmp", 8, 8)
    candidates = []
    first = None
    for p in ctx.m.entries("firewall policy"):
        ms = match_space(exp, p)
        if not ms.enabled:
            continue
        si = ms.srcintf == ANY or bool(ms.srcintf & inif)
        di = ms.dstintf == ANY or bool(ms.dstintf & out)
        if not (si and di):
            continue
        sa = ms.src.covers(pkt_src)
        if vip_hit is not None:
            da = YES if ("vip:" + vip_hit.key) in ms.dst.opaque or _vip_in_group(ctx, ms, vip_hit) else (UNK if ms.dst.is_any else NO)
        else:
            da = ms.dst.covers(pkt_dst)
        sv = ms.svc.covers(svc)
        res = [sa, da, sv]
        if ms.schedule != "always":
            res.append(UNK)
        if ms.users or ms.special:
            res.append(UNK)
        verdict = NO if NO in res else (UNK if UNK in res else YES)
        if verdict != NO:
            candidates.append({"policy": p.key, "name": p.first("name"), "action": ms.action, "verdict": verdict,
                               "nat": p.first("nat", "disable"), "poolname": p.get("poolname")})
            if verdict == YES and first is None:
                first = candidates[-1]
                break
    steps.append({"step": "policy-lookup", "result": candidates or "implicit deny",
                  "note": "first definite match wins; 'unknown' candidates earlier in the list may match at runtime"})
    if first is None:
        issues.append("No definite policy match: traffic hits the implicit deny unless an 'unknown' candidate matches at runtime.")
    elif first["action"] != "accept":
        issues.append(f"Policy {first['policy']} denies the traffic.")
    nat = None
    if first and first["action"] == "accept":
        if ctx.cache.get("central_nat"):
            nat = "central NAT: consult central-snat-map (not simulated)"
        elif first["nat"] == "enable":
            nat = f"SNAT to {'pool ' + ' '.join(first['poolname']) if first['poolname'] else 'egress interface IP'}"
        else:
            nat = "no source NAT"
        steps.append({"step": "nat", "result": nat})
        # return path
        back = rib.egress(src)
        steps.append({"step": "return-path", "result": sorted(back) or ["no route"],
                      "note": "route from the firewall back to the original source"})
        if inif and back and not (back & inif):
            issues.append(f"Asymmetric return path: replies to {src} would leave via {', '.join(sorted(back))} "
                          f"instead of {', '.join(sorted(inif))}.")
    return {"input": {"src": src_ip, "dst": dst_ip, "proto": proto, "port": port, "src_intf": src_intf},
            "steps": steps, "issues": issues, "verdict": (first or {}).get("action", "deny (implicit)"),
            "disclaimer": "Static configuration simulation. Confirm with `diagnose firewall iprope lookup` and "
                          "`get router info routing-table details <ip>` on the device.",
            "rib_incomplete": rib.incomplete}


def _vip_in_group(ctx, ms, vip):
    for tok in ms.dst.opaque:
        if tok.startswith("vip:"):
            g = ctx.m.entry("firewall vipgrp", tok[4:])
            if g is not None and vip.key in (g.get("member") or []):
                return True
    return False
