"""Static RIB reconstruction and lookups (configuration-based, NOT a runtime FIB)."""
from __future__ import annotations

import ipaddress as ipa
from dataclasses import dataclass

from .netutil import ANY4, is_unset_ip, safe_ipmask


@dataclass
class Route:
    kind: str  # connected | static | blackhole | sdwan
    dst: object
    gateway: str | None
    devices: list[str]
    distance: int
    priority: int
    source: str  # uid
    line: int
    enabled: bool = True

    def to_dict(self):
        return {"kind": self.kind, "dst": str(self.dst), "gateway": self.gateway, "devices": self.devices,
                "distance": self.distance, "priority": self.priority, "source": self.source, "line": self.line}


class RIB:
    def __init__(self, ctx):
        self.ctx = ctx
        m = ctx.m
        self.routes: list[Route] = []
        self.incomplete: list[str] = []
        self.connected: dict[str, list] = {}  # ifname -> [IPv4Interface]
        for e in m.entries("system interface"):
            ifs = []
            ip = safe_ipmask(e.get("ip"))
            if ip and not is_unset_ip(ip):
                ifs.append(ip)
            st = e.sub.get("secondaryip")
            if st and e.first("secondary-IP") == "enable":
                for s in st:
                    sip = safe_ipmask(s.get("ip"))
                    if sip:
                        ifs.append(sip)
            mode = e.first("mode", "static")
            if mode in ("dhcp", "pppoe"):
                self.incomplete.append(f"{e.key}: address/default route learned via {mode} at runtime")
            self.connected[e.key] = ifs
            if e.first("status", "up") == "up":
                for i in ifs:
                    if i.network.prefixlen < 32 or e.first("type") in ("tunnel", "loopback"):
                        self.routes.append(Route("connected", i.network, None, [e.key], 0, 0, e.uid, e.node.line))
        sdwan_members = {}
        for mb in m.entries("system sdwan > members"):
            sdwan_members.setdefault(mb.first("zone", "virtual-wan-link"), []).append(mb.first("interface"))
        for e in m.entries("router static"):
            if e.first("status", "enable") != "enable":
                continue
            dst = safe_ipmask(e.get("dst") or ["0.0.0.0", "0.0.0.0"])
            if dst is None:
                continue
            net = dst.network
            dist = int(e.first("distance", "10"))
            pri = int(e.first("priority", "1"))
            if e.first("blackhole") == "enable":
                self.routes.append(Route("blackhole", net, None, [], dist, pri, e.uid, e.node.line))
                continue
            if e.explicit("dstaddr"):
                self.incomplete.append(f"static route {e.key} uses address object {e.first('dstaddr')}")
            if e.explicit("sdwan-zone") or e.first("device") in ("virtual-wan-link", "sdwan"):
                zones = e.get("sdwan-zone") or ["virtual-wan-link"]
                devs = [d for z in zones for d in sdwan_members.get(z, [])]
                self.routes.append(Route("sdwan", net, None, devs, dist, pri, e.uid, e.node.line))
                continue
            gw = e.first("gateway", "0.0.0.0")
            self.routes.append(Route("static", net, None if gw == "0.0.0.0" else gw,
                                     [e.first("device")] if e.first("device") else [], dist, pri, e.uid, e.node.line))
        for proto in ("router bgp", "router ospf", "router rip", "router isis"):
            t = m.table(proto)
            if t is not None and (t.attrs or t.sub):
                if proto == "router bgp" and not (t.first("as") and t.first("as") != "0"):
                    continue
                if proto == "router ospf" and not t.get("router-id") and not t.sub.get("area"):
                    continue
                if proto == "router rip" and not t.sub.get("network"):
                    continue
                self.incomplete.append(f"{proto} configured: dynamically learned routes are not modelled")
        if m.entries("vpn ipsec phase1-interface"):
            self.incomplete.append("IPsec add-route / dynamic tunnel routes are only modelled from phase2 selectors")
        for p1 in m.entries("vpn ipsec phase1-interface"):
            # add-route only applies to dial-up (type dynamic) phase1; static tunnels need explicit routes
            if p1.first("add-route", "enable") == "enable" and p1.first("type", "static") == "dynamic":
                for p2 in m.entries("vpn ipsec phase2-interface"):
                    if p2.first("phase1name") == p1.key and p2.first("dst-addr-type", "subnet") == "subnet":
                        d = safe_ipmask(p2.get("dst-subnet"))
                        if d and d.network.prefixlen > 0:
                            self.routes.append(Route("ipsec-auto", d.network, None, [p1.key], 15, 1, p2.uid, p2.node.line))

    def lookup(self, ip) -> list[Route]:
        """Best routes for destination ip (longest prefix, then distance, then priority). ECMP -> several."""
        ip = ipa.ip_address(ip)
        cands = [r for r in self.routes if r.dst.version == ip.version and ip in r.dst]
        if not cands:
            return []
        best_len = max(r.dst.prefixlen for r in cands)
        cands = [r for r in cands if r.dst.prefixlen == best_len]
        bd = min(r.distance for r in cands)
        cands = [r for r in cands if r.distance == bd]
        bp = min(r.priority for r in cands)
        return [r for r in cands if r.priority == bp]

    def egress(self, ip) -> set[str]:
        out = set()
        for r in self.lookup(ip):
            out |= set(r.devices) or ({"blackhole"} if r.kind == "blackhole" else set())
        return out

    def iface_for_gateway(self, gw: str) -> list[str]:
        g = ipa.ip_address(gw)
        return [n for n, ifs in self.connected.items() for i in ifs if g in i.network]

    def has_default(self) -> bool:
        return any(r.dst == ANY4 for r in self.routes)
