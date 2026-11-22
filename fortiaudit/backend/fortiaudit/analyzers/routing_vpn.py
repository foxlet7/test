"""Module F (routing) and module G (IPsec VPN)."""
from __future__ import annotations

import ipaddress as ipa
from collections import defaultdict

from ..findings import CONFIRMED, FACT, INFERRED, OPTIMIZATION, POTENTIAL, RUNTIME, VERIFY, Ctx
from ..netutil import ANY4, safe_ipmask
from ..policy_engine import ANY


def routing(ctx: Ctx, rib):
    m = ctx.m
    statics = m.entries("router static")
    seen = defaultdict(list)
    for r in statics:
        dst = safe_ipmask(r.get("dst"))
        if dst is None:
            ctx.add("ROUTE-DST-INVALID", "F", "high", f"Static route {r.key} has an invalid destination",
                    f"dst = {r.text('dst')}", "Correct the destination/mask.", [r])
            continue
        if dst.ip != dst.network.network_address:
            ctx.add("ROUTE-DST-HOSTBITS", "F", "low", f"Static route {r.key} destination {dst} has host bits",
                    f"Interpreted as {dst.network}.", f"Use {dst.network}.", [r], classification=POTENTIAL)
        if r.first("status", "enable") != "enable":
            ctx.add("ROUTE-DISABLED", "F", "info", f"Static route {r.key} ({dst.network}) is disabled", "Inactive route.",
                    "Remove if obsolete (manual).", [r], classification=VERIFY)
            continue
        if r.first("blackhole") == "enable":
            more_specific = [x for x in rib.routes if x.dst != dst.network and x.dst.subnet_of(dst.network) if x.dst.version == 4]
            ctx.add("ROUTE-BLACKHOLE", "F", "info", f"Blackhole route {r.key} for {dst.network} (distance {r.first('distance')})",
                    "Blackhole routes are commonly intentional (VPN fail-closed, RFC1918 leakage prevention). Listed for review; "
                    f"{len(more_specific)} more-specific routes take precedence inside it.",
                    "No action unless unintended.", [r], classification=VERIFY, evidence=FACT)
            seen[(str(dst.network), "blackhole")].append(r)
            continue
        dev = r.first("device")
        gw = r.first("gateway", "0.0.0.0")
        sdwan = r.explicit("sdwan-zone") or dev in ("virtual-wan-link", "sdwan")
        if not dev and not sdwan and not r.explicit("dstaddr"):
            ctx.add("ROUTE-NO-DEVICE", "F", "high", f"Static route {r.key} has no outgoing interface",
                    "A static route needs device (or SD-WAN zone).", "Set the device.", [r])
            continue
        if gw != "0.0.0.0" and dev and not sdwan and r.first("dynamic-gateway") != "enable":
            ie = m.entry("system interface", dev)
            p1 = m.entry("vpn ipsec phase1-interface", dev)
            if ie is not None and ie.first("type") != "tunnel" and p1 is None and ie.first("mode", "static") == "static":
                conn = rib.connected.get(dev, [])
                gip = ipa.ip_address(gw)
                if not any(gip in c.network for c in conn):
                    other = rib.iface_for_gateway(gw)
                    ctx.add("ROUTE-GW-UNREACHABLE", "F", "high",
                            f"Static route {r.key}: gateway {gw} is not on {dev}'s subnet",
                            f"{dev} has {', '.join(map(str, (c.network for c in conn))) or 'no address'}; FortiOS requires the "
                            f"gateway to be directly connected on the route's device."
                            + (f" The gateway is on {', '.join(other)}." if other else ""),
                            "Correct the device or gateway. Routing gateways are never auto-remediated.", [r])
        seen[(str(dst.network), dev or "sdwan", r.first("distance", "10"), r.first("priority", "1"))].append(r)
    for k, rs in seen.items():
        if len(rs) > 1 and k[1] != "blackhole":
            gws = {r.first("gateway") for r in rs}
            if len(gws) == 1:
                ctx.add("ROUTE-DUPLICATE", "F", "low", f"Duplicate static routes to {k[0]} via {k[1]}",
                        f"Routes {', '.join(r.key for r in rs)} are identical (dst/device/gateway/distance/priority).",
                        "Keep one (manual decision; routes are never auto-removed).", rs, classification=OPTIMIZATION)
            else:
                ctx.add("ROUTE-ECMP", "F", "info", f"ECMP static routes to {k[0]} via {k[1]}",
                        f"Routes {', '.join(r.key for r in rs)} share distance/priority with different gateways: traffic is load-balanced.",
                        "Confirm ECMP is intended; otherwise use distance/priority for failover.", rs, classification=VERIFY)
    # same destination, different distance → floating; same distance different device -> ECMP across interfaces
    by_dst = defaultdict(list)
    for r in statics:
        d = safe_ipmask(r.get("dst"))
        if d and r.first("status", "enable") == "enable" and r.first("blackhole") != "enable":
            by_dst[str(d.network)].append(r)
    for d, rs in by_dst.items():
        devs = {(r.first("device"), r.first("distance", "10"), r.first("priority", "1")) for r in rs}
        dist = defaultdict(set)
        for dev, di, pr in devs:
            dist[(di, pr)].add(dev)
        for (di, pr), ds in dist.items():
            if len(ds) > 1:
                ctx.add("ROUTE-CONFLICT", "F", "medium", f"Routes to {d} via different interfaces with equal distance/priority",
                        f"Interfaces {', '.join(sorted(map(str, ds)))} at distance {di}/priority {pr}: ECMP across different "
                        "paths can cause asymmetric routing and RPF drops.",
                        "Use distinct distance/priority for primary/backup or SD-WAN rules.", rs,
                        classification=POTENTIAL, evidence=INFERRED)
    has_dhcp_wan = any(e.first("mode") in ("dhcp", "pppoe") and e.first("defaultgw", "enable") == "enable"
                       for e in m.entries("system interface"))
    if not rib.has_default() and not has_dhcp_wan:
        ctx.add("ROUTE-NO-DEFAULT", "F", "medium", "No default route in the static configuration",
                "No 0.0.0.0/0 static/SD-WAN route and no DHCP/PPPoE interface providing one. A default may come from a "
                "dynamic protocol (BGP/OSPF) - verify with `get router info routing-table all`.",
                "Confirm how the default route is learned.", [], classification=VERIFY, evidence=RUNTIME)
    # policy routes
    for pr in m.entries("router policy"):
        if pr.first("status", "enable") != "enable":
            continue
        out = pr.first("output-device")
        gw = pr.first("gateway")
        if pr.first("action", "permit") == "permit" and not out and pr.first("action") != "deny":
            ctx.add("PBR-NO-OUTPUT", "F", "medium", f"Policy route {pr.key} has no output device",
                    "Without output-device the policy route only stops further policy-route evaluation (traffic falls to the RIB).",
                    "Confirm intent (this is a valid 'skip PBR' pattern) or set output-device.", [pr],
                    classification=VERIFY)
        if out and gw and gw != "0.0.0.0":
            conn = rib.connected.get(out, [])
            if conn and not any(ipa.ip_address(gw) in c.network for c in conn):
                ctx.add("PBR-GW-UNREACHABLE", "F", "high", f"Policy route {pr.key}: gateway {gw} not on {out}",
                        "Policy-route gateway must be on the output device subnet.", "Correct gateway or device.", [pr])
    # sdwan
    sd = m.table("system sdwan")
    if sd is not None and sd.first("status") == "enable":
        mem = m.entries("system sdwan > members")
        if not m.entries("system sdwan > health-check") and len(mem) > 1:
            ctx.add("SDWAN-NO-HC", "F", "medium", "SD-WAN has several members but no performance SLA / health-check",
                    "Without health checks dead links are only detected by link state.", "Configure health-checks.",
                    [("system sdwan|_", sd.node.line)])
    # BGP neighbours without auth (low)
    bgp = m.table("router bgp")
    if bgp is not None and bgp.sub.get("neighbor"):
        for n in bgp.sub["neighbor"]:
            if not n.explicit("password"):
                ctx.add("BGP-NO-AUTH", "F", "low", f"BGP neighbor {n.key} has no TCP-MD5 password",
                        "Session authentication protects against spoofed BGP resets/injection (mainly on shared segments).",
                        "Consider a neighbor password agreed with the peer.", [(f"router bgp > neighbor|{n.key}", n.node.line)],
                        classification=VERIFY)
            for attr, ns in (("route-map-in", "route-map"), ("route-map-out", "route-map"),
                             ("prefix-list-in", "prefix-list"), ("prefix-list-out", "prefix-list")):
                v = n.first(attr)
                if v and ctx.r.resolve(ns, v) is None:
                    ctx.add("REF-BROKEN", "F", "high", f"BGP neighbor {n.key}: {attr} references missing {ns} '{v}'",
                            "Missing route-map/prefix-list on a BGP session.", "Create it or fix the reference.",
                            [(f"router bgp > neighbor|{n.key}", n.node.line)])


def vpn(ctx: Ctx, rib, exp):
    m = ctx.m
    sc = ctx.sc
    p1s = m.entries("vpn ipsec phase1-interface")
    p2s = m.entries("vpn ipsec phase2-interface")
    by_p1 = defaultdict(list)
    for p2 in p2s:
        by_p1[p2.first("phase1name")].append(p2)
    pols = m.entries("firewall policy")
    remote = []
    gw_seen = defaultdict(list)
    for p1 in p1s:
        name = p1.key
        props = " ".join(p1.get("proposal") or [])
        _proposal_checks(ctx, p1, props, p1.get("dhgrp"), "phase1")
        if p1.first("mode", "main") == "aggressive" and p1.first("authmethod", "psk") == "psk" and p1.first("ike-version", "1") == "1":
            ctx.add("VPN-AGGR-PSK", "G", "medium", f"{name}: IKEv1 aggressive mode with PSK",
                    "Aggressive mode exposes a hash of the PSK to offline cracking.", "Prefer IKEv2 or main mode with certificates.", [p1])
        if p1.first("ike-version", "1") == "1":
            ctx.add("VPN-IKEV1", "G", "low", f"{name} uses IKEv1", "IKEv1 is legacy; IKEv2 is preferred.",
                    "Plan migration to IKEv2 together with the peer.", [p1], classification=VERIFY)
        if p1.first("dpd", "on-demand") == "disable":
            ctx.add("VPN-NO-DPD", "G", "low", f"{name}: dead peer detection disabled",
                    "Failed peers are not detected; routes via the tunnel stay installed.", "Enable DPD (on-idle/on-demand).", [p1])
        if p1.first("type", "static") == "static":
            gw_seen[(p1.first("remote-gw"), p1.first("interface"))].append(p1)
        if not by_p1.get(name):
            ctx.add("VPN-NO-PHASE2", "G", "high", f"Phase 1 {name} has no phase 2", "A tunnel without phase2 carries no traffic.",
                    "Add phase2 selectors or remove the unused phase1 (manual).", [p1])
        # policies both directions
        tun_members = {name}
        inb = [p for p in pols if name in exp.intf(p.get("srcintf")) if exp.intf(p.get("srcintf")) != ANY]
        outb = [p for p in pols if name in exp.intf(p.get("dstintf")) if exp.intf(p.get("dstintf")) != ANY]
        if not inb and not outb:
            ctx.add("VPN-NO-POLICY", "G", "medium", f"Tunnel {name} is not used by any firewall policy",
                    "No policy references the tunnel interface (directly or via zone). No traffic can traverse it.",
                    "Add policies or remove the tunnel (manual).", [p1], classification=POTENTIAL)
        elif not inb or not outb:
            ctx.add("VPN-ONE-DIRECTION", "G", "info", f"Tunnel {name} has policies in one direction only",
                    f"{'Outbound' if outb else 'Inbound'} policies exist; sessions can only be initiated from one side. "
                    "This is correct when only one side initiates (sessions are stateful).",
                    "Confirm the remote side does not need to initiate.", [p1], classification=VERIFY, evidence=INFERRED)
        for p2 in by_p1.get(name, []):
            _proposal_checks(ctx, p2, " ".join(p2.get("proposal") or []), p2.get("dhgrp"), "phase2")
            if p2.first("pfs", "enable") == "disable":
                ctx.add("VPN-NO-PFS", "G", "low", f"{p2.key}: PFS disabled", "Without PFS a compromised key exposes later SAs.",
                        "Enable PFS on both peers.", [p2])
            dst = _selector(ctx, exp, p2, "dst")
            src = _selector(ctx, exp, p2, "src")
            if dst is not None:
                for n in dst:
                    remote.append((p1, p2, n))
                    if n.prefixlen == 0:
                        continue
                    eg = rib.egress(n.network_address + (1 if n.num_addresses > 1 else 0))
                    if name not in eg:
                        ctx.add("VPN-ROUTE-MISSING", "G", "high" if eg else "medium",
                                f"Remote network {n} of {p2.key} is not routed into tunnel {name}",
                                f"Best static route goes to {', '.join(sorted(eg)) or 'nothing'}"
                                + (" (static tunnel: routes are not added automatically)" if p1.first("type", "static") == "static" else "")
                                + ". Traffic for the remote selector will not enter the tunnel.",
                                "Add a static route for the remote subnet via the tunnel interface (plus a blackhole with higher distance "
                                "for fail-closed behaviour). Routing changes need approval.", [p2, p1],
                                classification=POTENTIAL, evidence=INFERRED, confidence="medium")
            # policy address consistency
            if dst:
                for p in outb:
                    ms_dst = exp.addr(p.get("dstaddr"))
                    if ms_dst.nets and not ms_dst.is_any and not any(any(n.overlaps(x) for x in dst) for n in ms_dst.nets):
                        ctx.add("VPN-POLICY-SELECTOR", "G", "medium",
                                f"Policy {p.key} into {name} targets addresses outside the phase2 remote selectors",
                                f"dstaddr {p.text('dstaddr')} does not overlap any remote selector ({', '.join(map(str, dst))}) "
                                f"of {name}; that traffic will be dropped by the IPsec SA selection.",
                                "Align the address objects with the phase2 selectors.", [p, p2],
                                classification=POTENTIAL, evidence=INFERRED)
    for (gw, intf), lst in gw_seen.items():
        if len(lst) > 1 and gw and gw != "0.0.0.0":
            ids = {(x.first("localid"), x.first("peerid")) for x in lst}
            ctx.add("VPN-DUP-GW", "G", "medium" if len(ids) == 1 else "info",
                    f"Several phase1 tunnels to {gw} on {intf}: {', '.join(x.key for x in lst)}",
                    "Multiple tunnels to the same peer on the same interface need distinct IDs/proposals to be selectable."
                    + (" They have identical local/peer IDs." if len(ids) == 1 else " They use distinct IDs (likely intentional)."),
                    "Confirm the peer distinguishes them (localid/peerid, network-id for IKEv2).", lst,
                    classification=POTENTIAL if len(ids) == 1 else VERIFY)
    for i in range(len(remote)):
        for j in range(i + 1, len(remote)):
            a, b = remote[i], remote[j]
            if a[0] is b[0] or a[2].prefixlen == 0 or b[2].prefixlen == 0:
                continue
            if a[2].overlaps(b[2]):
                ctx.add("VPN-REMOTE-OVERLAP", "G", "medium",
                        f"Remote selectors overlap: {a[1].key} {a[2]} and {b[1].key} {b[2]}",
                        "Two different tunnels claim overlapping remote networks; only one can be the routed path at a time "
                        "(valid for redundant tunnels with distance-based failover).",
                        "Confirm redundancy design (distances/priorities) or fix the selectors.", [a[1], b[1]],
                        classification=VERIFY, evidence=INFERRED)


def _selector(ctx, exp, p2, side):
    t = p2.first(f"{side}-addr-type", "subnet")
    if t == "subnet":
        s = safe_ipmask(p2.get(f"{side}-subnet") or ["0.0.0.0", "0.0.0.0"])
        return [s.network] if s else None
    if t == "ip":
        ip = p2.first(f"{side}-start-ip")
        return [ipa.ip_network(ip + "/32")] if ip else None
    if t == "range":
        from ..netutil import range_to_nets
        try:
            return range_to_nets(p2.first(f"{side}-start-ip"), p2.first(f"{side}-end-ip"))
        except (ValueError, TypeError):
            return None
    if t == "name":
        s = exp.addr([p2.first(f"{side}-name", "")])
        return s.nets or None
    return None


def _proposal_checks(ctx, e, props, dh, phase):
    sc = ctx.sc
    if props:
        weak = []
        for p in props.split():
            enc, _, h = p.partition("-")
            if enc.lower() in sc.WEAK_ENC:
                weak.append(p)
            elif h.lower() in sc.WEAK_HASH:
                weak.append(p)
        if weak:
            ctx.add("VPN-WEAK-PROPOSAL", "G", "medium", f"{e.key} ({phase}) offers weak proposals: {', '.join(weak)}",
                    "DES/3DES/NULL encryption or MD5/SHA1 integrity are deprecated.",
                    "Use aes256gcm/aes256-sha256 (coordinate with the peer). VPN settings are never auto-remediated.", [e])
    else:
        ctx.add("VPN-PROPOSAL-DEFAULT", "G", "info", f"{e.key} ({phase}) uses the firmware default proposal",
                "No explicit proposal; the 7.4.12 default must be verified against the CLI reference.",
                "Verify the effective proposal (`show full-configuration`).", [e], classification=VERIFY, evidence=RUNTIME)
    if dh:
        weak = [g for g in dh if g in {"1", "2", "5"}]
        if weak:
            ctx.add("VPN-WEAK-DH", "G", "medium", f"{e.key} ({phase}) uses weak DH group(s) {', '.join(weak)}",
                    "MODP groups 1/2/5 (768-1536 bit) are considered breakable.", "Use DH 19/20/21 (ECP) or at least 14.", [e])
