"""Module E (firewall policies, matching, flows) and module H (NAT / VIP / IP pools)."""
from __future__ import annotations

import ipaddress as ipa
from collections import defaultdict

from ..findings import (CONFIRMED, CONFIRMED_DUP, CONFIRMED_SHADOW, EXCEPTION, FACT, INFERRED, OVERLAP, POTENTIAL,
                        RUNTIME, VERIFY, Ctx)
from ..netutil import range_to_nets, safe_ipmask
from ..policy_engine import ANY, NO, UNK, YES, behaviour_signature, match_signature, match_space
from ..remediation import HIGH, MEDIUM, Op, build_change

UTM_ATTRS = ["av-profile", "webfilter-profile", "application-list", "ips-sensor", "dnsfilter-profile",
             "file-filter-profile", "dlp-profile", "profile-group", "emailfilter-profile"]


def wan_ifaces(ctx, rib):
    out = {e.key for e in ctx.m.entries("system interface") if e.first("role") == "wan"}
    for r in rib.routes:
        if r.dst.prefixlen == 0:
            out |= set(r.devices)
    return out


def _uses_wan(intfset, wan):
    return intfset != ANY and bool(intfset & wan)


def policies(ctx: Ctx, exp, rib):
    m = ctx.m
    wan = wan_ifaces(ctx, rib)
    central = (m.table("system settings").first("central-nat") == "enable") if m.table("system settings") else False
    ctx.cache["central_nat"] = central
    for path, v6 in (("firewall policy", False), ("firewall policy6", True)):
        ents = m.entries(path)
        spaces = []
        for p in ents:
            ms = match_space(exp, p, v6)
            spaces.append(ms)
            act = ms.action
            if not ms.enabled:
                ctx.add("POLICY-DISABLED", "E", "info", f"Policy {p.key} is disabled",
                        "Disabled policies do not match traffic.", "Remove if obsolete (manual decision; check change records).", [p],
                        classification=VERIFY, evidence=FACT)
                continue
            srv = p.get("service") or []
            src_all = ms.src.is_any and not ms.src.opaque
            dst_all = ms.dst.is_any and not ms.dst.opaque
            if act == "accept":
                if src_all and dst_all and ms.svc.all:
                    ctx.add("POLICY-ANY-ANY-ALL", "E", "high", f"Policy {p.key} accepts any source to any destination on ALL services",
                            f"{_desc(p)}. This is equivalent to no filtering between these interfaces.",
                            "Restrict sources, destinations and services to what is required; use traffic logs (FortiAnalyzer) to derive them.",
                            [p], impact="Tightening will block traffic that currently relies on this rule.")
                elif ms.svc.all:
                    ctx.add("POLICY-SERVICE-ALL", "E", "medium", f"Policy {p.key} allows ALL services",
                            f"{_desc(p)}. Every protocol/port is permitted for the matched addresses.",
                            "Replace ALL with the required services (derive from logs).", [p], classification=VERIFY, evidence=INFERRED)
                elif src_all and dst_all:
                    ctx.add("POLICY-ANY-ANY", "E", "medium", f"Policy {p.key} allows any source to any destination",
                            _desc(p), "Restrict source and/or destination addresses.", [p], classification=VERIFY)
                lt = p.first("logtraffic", "utm")
                if lt == "disable":
                    f = ctx.add("POLICY-NO-LOG", "E", "medium", f"Accept policy {p.key} has traffic logging disabled",
                                "`logtraffic disable`: allowed sessions leave no audit trail; troubleshooting and incident response are impaired.",
                                "Set logtraffic all (or utm at minimum). Consider log volume/storage.", [p],
                                auto_remediation="assisted")
                    build_change(ctx, f, f"Enable traffic logging on policy {p.key}", MEDIUM,
                                 [Op("set_attr", path, p.key, "logtraffic", ["all"], [False])],
                                 "Logging-only change; does not alter allow/deny behaviour.",
                                 "Increased log volume (disk/FortiAnalyzer quota).",
                                 validation="Generate test traffic and confirm logs appear (Log & Report > Forward Traffic).")
                if _uses_wan(ms.dstintf, wan) and not any(p.explicit(a) for a in UTM_ATTRS):
                    ctx.add("POLICY-NO-UTM", "J", "low", f"Internet-bound accept policy {p.key} has no security profiles",
                            "Traffic to a WAN interface is accepted without AV/IPS/Web/DNS/App inspection. This may be "
                            "intentional (trusted servers, performance), so it is not a confirmed error.",
                            "Review business need; apply at least IPS/AV/DNS filtering where appropriate.", [p],
                            classification=VERIFY, confidence="medium", evidence=INFERRED)
                if p.first("nat") == "enable" and p.first("ippool") == "enable" and not p.get("poolname"):
                    ctx.add("POLICY-IPPOOL-MISSING", "H", "high", f"Policy {p.key} enables IP pool NAT without a pool",
                            "`ippool enable` but no poolname.", "Select a pool or disable ippool.", [p])
                if not central and p.first("nat", "disable") != "enable" and _uses_wan(ms.dstintf, wan) and ms.src.nets \
                        and all(n.is_private for n in ms.src.nets) and not ms.src.opaque:
                    ctx.add("POLICY-NAT-MISSING", "H", "medium", f"Policy {p.key}: private sources to WAN without NAT",
                            f"Sources ({', '.join(map(str, ms.src.nets[:4]))}) are RFC1918 and the destination is a WAN interface, "
                            "but NAT is disabled. Return traffic will not route back unless the upstream does NAT.",
                            "Confirm upstream NAT; otherwise enable NAT on the policy.", [p],
                            classification=POTENTIAL, evidence=INFERRED, confidence="medium")
                if central and p.first("nat") == "enable" and p.explicit("nat"):
                    ctx.add("POLICY-NAT-CENTRAL", "H", "info", f"Policy {p.key} sets nat enable while central NAT is enabled",
                            "With central-nat enabled, SNAT is decided by central-snat-map; the policy nat setting is not used.",
                            "Remove the setting to avoid confusion.", [p], classification=VERIFY)
            else:
                if any(p.explicit(a) for a in UTM_ATTRS):
                    ctx.add("POLICY-DENY-UTM", "J", "info", f"Deny policy {p.key} carries security profiles",
                            "Profiles have no effect on denied traffic.", "Remove the profiles for clarity.", [p])
            si, di = ms.srcintf, ms.dstintf
            if si != ANY and di != ANY and si == di and act == "accept":
                ctx.add("POLICY-SAME-INTF", "E", "info", f"Policy {p.key} has identical source and destination interfaces",
                        "Intra-interface (hairpin) policy; valid for some designs (e.g. VIP hairpin, branch-to-branch over the same tunnel).",
                        "Confirm the design intent.", [p], classification=EXCEPTION)
            if not v6:
                _flow_checks(ctx, rib, p, ms, exp)
        _shadow(ctx, path, spaces)


def _desc(p):
    return (f"srcintf={p.text('srcintf')} dstintf={p.text('dstintf')} src={p.text('srcaddr')} "
            f"dst={p.text('dstaddr')} service={p.text('service')} action={p.first('action', 'deny')}")


def _shadow(ctx: Ctx, path, spaces):
    enabled = [s for s in spaces if s.enabled]
    for j, b in enumerate(enabled):
        reported = False
        pot = None
        ovl = None
        for a in enabled[:j]:
            if not _intf_possible(a, b):
                continue
            c = a.covers(b)
            if c == YES:
                pa, pb = a.entry, b.entry
                if match_signature(pa) == match_signature(pb) and behaviour_signature(pa) == behaviour_signature(pb):
                    f = ctx.add("POLICY-DUPLICATE", "E", "medium", f"Policy {pb.key} is an exact duplicate of earlier policy {pa.key}",
                                f"Same match criteria and same action/NAT/profiles/logging. {pb.key} can never match because {pa.key} is evaluated first.",
                                f"Remove {pb.key} after confirming hit count is 0 (`diagnose firewall iprope show 100004 {pb.key}` or Policy view).",
                                [pb, pa], classification=CONFIRMED_DUP, auto_remediation="assisted")
                    build_change(ctx, f, f"Disable duplicate policy {pb.key}", MEDIUM,
                                 [Op("set_attr", path, pb.key, "status", ["disable"], [False])],
                                 "Disabling (not deleting) keeps the change trivially reversible; delete later once confirmed.",
                                 "None expected: the policy is unreachable.",
                                 validation="Confirm policy hit counters stay at 0 before and after.")
                else:
                    diff_action = a.action != b.action
                    f = ctx.add("POLICY-SHADOWED", "E", "high" if diff_action else "medium",
                                f"Policy {pb.key} is fully shadowed by earlier policy {pa.key}",
                                f"Every packet that could match {pb.key} matches {pa.key} first (FortiOS first-match, table order). "
                                + (f"{pb.key}'s action ({b.action}) never takes effect; {pa.key} {a.action}s the traffic."
                                   if diff_action else f"Differences in NAT/profiles/logging of {pb.key} never apply."),
                                f"Decide which behaviour is intended. If {pb.key} expresses an exception, move it above {pa.key}; "
                                f"otherwise remove it. Check hit counters first.",
                                [pb, pa], classification=CONFIRMED_SHADOW, auto_remediation="assisted",
                                impact="Moving the policy changes effective access; removing it changes nothing at runtime.")
                    if not diff_action:
                        build_change(ctx, f, f"Disable unreachable policy {pb.key}", MEDIUM,
                                     [Op("set_attr", path, pb.key, "status", ["disable"], [False])],
                                     "Unreachable policy; disabling does not change matching.",
                                     "None expected. If the intent was an exception, reorder instead (manual).")
                reported = True
                break
            if c == UNK and pot is None and a.intersects(b) != NO:
                pot = a
            if c == NO and ovl is None and a.action != b.action and a.intersects(b) == YES:
                ovl = a
        if not reported and pot is not None:
            reasons = sorted(set(pot.special + b.special + [k for k in pot.src.opaque.values()] + [k for k in pot.dst.opaque.values()]
                                 + [k for k in b.src.opaque.values()] + [k for k in b.dst.opaque.values()]))
            if pot.svc.opaque or b.svc.opaque or pot.svc.approx or b.svc.approx:
                reasons.append("service-not-fully-modelled")
            if pot.schedule != "always":
                reasons.append(f"schedule:{pot.schedule}")
            ctx.add("POLICY-POTENTIAL-SHADOW", "E", "low", f"Policy {b.entry.key} may be shadowed by {pot.entry.key}",
                    f"{pot.entry.key} covers {b.entry.key} on every dimension that can be evaluated statically; the rest depends on "
                    f"runtime data ({', '.join(reasons) or 'unmodelled attributes'}).",
                    "Verify with hit counters / policy lookup (`diagnose firewall iprope lookup`).",
                    [b.entry, pot.entry], classification=VERIFY, confidence="low", evidence=RUNTIME)
        elif not reported and ovl is not None:
            ctx.add("POLICY-OVERLAP", "E", "info",
                    f"Policies {ovl.entry.key} ({ovl.action}) and {b.entry.key} ({b.action}) partially overlap",
                    f"Some traffic matches both; {ovl.entry.key} wins for the overlap because it is earlier. Usually an intended exception.",
                    "No action unless the overlap is unintended.", [b.entry, ovl.entry], classification=OVERLAP, confidence="high")


def _intf_possible(a, b):
    for x, y in ((a.srcintf, b.srcintf), (a.dstintf, b.dstintf)):
        if x != ANY and y != ANY and not (x & y):
            return False
    return True


def _best_prefix(rib, ip):
    r = rib.lookup(ip)
    return r[0].dst.prefixlen if r else -1


def _flow_checks(ctx, rib, p, ms, exp):
    if ms.action != "accept":
        return
    low_conf = bool([x for x in rib.incomplete if "dynamic" in x or "learned" in x])
    conf = "low" if low_conf else "medium"
    if ms.dstintf != ANY:
        for n in ms.dst.nets[:16]:
            if n.prefixlen == 0:
                continue
            ip = n.network_address if n.num_addresses == 1 else n.network_address + 1
            eg = rib.egress(ip)
            if eg and "blackhole" not in eg and not (eg & ms.dstintf):
                ctx.add("POLICY-DSTINTF-ROUTE", "E", "medium",
                        f"Policy {p.key}: destination {n} routes via {', '.join(sorted(eg))}, not {p.text('dstintf')}",
                        "FortiOS selects the egress interface from routing before policy lookup. Traffic to this destination "
                        "leaves via a different interface, so this policy cannot match it (static-RIB inference).",
                        "Fix the routing, or the policy's dstintf/dstaddr.", [p], classification=POTENTIAL,
                        evidence=INFERRED, confidence=conf)
                break
        for tok, kind in ms.dst.opaque.items():
            if kind == "vip":
                v = ctx.r.resolve("address", tok[4:])
                if v and v != "predefined" and v.path == "firewall vip":
                    mip = (v.get("mappedip") or [""])[0].split("-")[0]
                    try:
                        eg = rib.egress(mip)
                    except ValueError:
                        continue
                    if eg and "blackhole" not in eg and not (eg & ms.dstintf):
                        ctx.add("VIP-POLICY-DSTINTF", "H", "medium",
                                f"Policy {p.key}: VIP {v.key} maps to {mip} which routes via {', '.join(sorted(eg))}",
                                f"VIP policies must use the interface toward the mapped (real) server as dstintf; the policy uses {p.text('dstintf')}.",
                                "Set dstintf to the interface where the mapped server lives.", [p, v],
                                classification=POTENTIAL, evidence=INFERRED, confidence=conf)
    if ms.srcintf != ANY:
        for n in ms.src.nets[:16]:
            if n.prefixlen == 0:
                continue
            ip = n.network_address if n.num_addresses == 1 else n.network_address + 1
            if _best_prefix(rib, ip) <= 0:
                continue
            eg = rib.egress(ip)
            if eg and "blackhole" not in eg and not (eg & ms.srcintf):
                ctx.add("POLICY-SRC-RPF", "E", "medium",
                        f"Policy {p.key}: source {n} is routed via {', '.join(sorted(eg))}, not via {p.text('srcintf')}",
                        "Return traffic toward the source uses a different interface (asymmetric path). FortiOS reverse-path "
                        "check may drop the session at creation, or the policy srcintf is wrong.",
                        "Align routing for the source subnet with the ingress interface, or correct the policy srcintf.",
                        [p], classification=POTENTIAL, evidence=INFERRED, confidence=conf)
                break


def nat(ctx: Ctx, rib):
    m = ctx.m
    vips = m.entries("firewall vip")
    seen = defaultdict(list)
    if_ips = {}
    for e in m.entries("system interface"):
        ip = safe_ipmask(e.get("ip"))
        if ip:
            if_ips[str(ip.ip)] = e
    for v in vips:
        typ = v.first("type", "static-nat")
        if typ not in ("static-nat",):
            continue
        ext = (v.get("extip") or [""])[0]
        mapped = v.get("mappedip") or []
        if not mapped:
            ctx.add("VIP-NO-MAPPED", "H", "high", f"VIP {v.key} has no mapped IP", "Static NAT VIP without mappedip.",
                    "Define mappedip.", [v])
        for mp in mapped:
            try:
                a, _, b = mp.partition("-")
                range_to_nets(a, b or a)
            except ValueError as ex:
                ctx.add("VIP-MAPPED-INVALID", "H", "high", f"VIP {v.key} mapped IP {mp} invalid", str(ex), "Correct mappedip.", [v])
        pf = v.first("portforward", "disable") == "enable"
        proto = v.first("protocol", "tcp")
        key_port = (proto, v.first("extport", "")) if pf else ("*", "*")
        seen[(ext, v.first("extintf", "any"))].append((v, key_port))
        if v.first("extintf", "any") == "any":
            ctx.add("VIP-EXTINTF-ANY", "H", "low", f"VIP {v.key} answers on any interface",
                    "extintf any: the VIP is matched (and ARP-replied for, if arp-reply enabled) on every interface.",
                    "Bind the VIP to the external interface it is published on.", [v], classification=VERIFY, evidence=INFERRED)
        if not pf and ext in if_ips:
            ctx.add("VIP-STATIC-ON-IFIP", "H", "high", f"VIP {v.key} statically maps the interface address {ext} (all ports)",
                    f"{ext} is the IP of {if_ips[ext].key}. A full 1:1 VIP on the interface IP forwards all ports, including "
                    "management and IKE, to {', '.join(mapped)}.".replace("{', '.join(mapped)}", ", ".join(mapped)),
                    "Use port forwarding for the required ports only. Public IP mappings require explicit approval to change.",
                    [v, if_ips[ext]])
        if not pf:
            for u, _, d in ctx.g.g.in_edges(v.uid, data=True):
                pe = next((x for x in m.entries("firewall policy") if x.uid == u), None)
                if pe and pe.first("action") == "accept" and "ALL" in (pe.get("service") or []):
                    ctx.add("VIP-EXPOSED-ALL", "H", "high", f"Server behind VIP {v.key} exposed on ALL services by policy {pe.key}",
                            f"1:1 VIP {ext} -> {', '.join(mapped)} with an accept policy on service ALL exposes every port of the server to the source.",
                            "Restrict the policy service to the published ports.", [pe, v], classification=CONFIRMED)
    for (ext, intf), lst in seen.items():
        by = defaultdict(list)
        for v, kp in lst:
            by[kp].append(v)
        wild = by.get(("*", "*"), [])
        for kp, vs in by.items():
            if len(vs) > 1 or (wild and kp != ("*", "*")):
                group = vs + ([w for w in wild if w not in vs] if kp != ("*", "*") else [])
                if len(group) > 1:
                    ctx.add("VIP-CONFLICT", "H", "high", f"Conflicting VIP mappings for {ext} ({', '.join(x.key for x in group)})",
                            f"Same external IP/interface and overlapping protocol/port ({kp[0]}/{kp[1]}). Only one mapping can win.",
                            "Make the external mappings unique. Public IP mappings require explicit approval.", group)
    pools = []
    for p in m.entries("firewall ippool"):
        try:
            nets = range_to_nets(p.first("startip", "0.0.0.0"), p.first("endip", "0.0.0.0"))
        except ValueError as ex:
            ctx.add("IPPOOL-INVALID", "H", "high", f"IP pool {p.key} invalid", str(ex), "Fix the range.", [p])
            continue
        pools.append((p, nets))
    for i in range(len(pools)):
        for j in range(i + 1, len(pools)):
            if any(x.overlaps(y) for x in pools[i][1] for y in pools[j][1]):
                ctx.add("IPPOOL-OVERLAP", "H", "medium", f"IP pools {pools[i][0].key} and {pools[j][0].key} overlap",
                        "Overlapping SNAT pools can produce port/IP allocation conflicts and ARP ambiguity.",
                        "Make pool ranges disjoint unless intentionally shared.", [pools[i][0], pools[j][0]], classification=POTENTIAL)
    if ctx.cache.get("central_nat") and not m.entries("firewall central-snat-map"):
        ctx.add("CNAT-EMPTY", "H", "medium", "Central NAT enabled but no central SNAT rules",
                "With central-nat enabled and an empty central-snat-map, no source NAT is performed.",
                "Add SNAT rules or confirm no SNAT is needed.", [("system settings|_", m.table("system settings").node.line)],
                classification=POTENTIAL)
