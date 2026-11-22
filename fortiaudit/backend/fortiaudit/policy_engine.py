"""Policy match-space algebra for first-match analysis (duplicate / shadow / overlap).

Tri-state logic: YES (provable from config), NO (provably not), UNKNOWN (depends on runtime
resolution: FQDN, geo, dynamic, VIP semantics, negation, non-trivial schedules, unknown services).
"""
from __future__ import annotations

import ipaddress as ipa
from dataclasses import dataclass, field

from .netutil import ANY4, ANY6, covers as net_covers, overlaps as net_overlaps, parse_ipmask, range_to_nets, safe_ipmask

YES, NO, UNK = "yes", "no", "unknown"
ANY = "*ANY*"


def tri_and(*vals):
    if NO in vals:
        return NO
    if UNK in vals:
        return UNK
    return YES


@dataclass
class AddrSet:
    nets: list = field(default_factory=list)
    opaque: dict = field(default_factory=dict)  # token -> kind (fqdn, geography, vip, dynamic, unresolved...)

    @property
    def is_any(self):
        return any(n.prefixlen == 0 for n in self.nets)

    def collapsed(self):
        c = self.__dict__.get("_c")
        if c is None or self.__dict__.get("_n") != len(self.nets):
            from .netutil import collapse
            c = collapse(self.nets)
            iv = {4: [], 6: []}
            for n in c:
                lo, hi = int(n.network_address), int(n.broadcast_address)
                L = iv[n.version]
                if L and lo <= L[-1][1] + 1:
                    L[-1] = (L[-1][0], max(L[-1][1], hi))
                else:
                    L.append((lo, hi))
            self.__dict__.update(_c=c, _n=len(self.nets), _iv=iv, _starts={k: [a for a, _ in v] for k, v in iv.items()})
        return c

    def intervals(self):
        self.collapsed()
        return self.__dict__["_iv"], self.__dict__["_starts"]

    def covers(self, other: "AddrSet") -> str:
        if other.nets and not _cov_iv(self.intervals(), other.intervals()[0]):
            # maybe partially; check if 'any'
            return NO if not self.opaque else UNK
        res = YES
        for tok, kind in other.opaque.items():
            if tok in self.opaque:
                continue
            if self.is_any and kind not in ("vip", "unresolved", "negated", "exclude"):
                continue
            res = UNK
        if self.opaque and res == YES and other.nets and not self.nets:
            res = UNK
        return res

    def intersects(self, other: "AddrSet") -> str:
        if net_overlaps(self.collapsed(), other.collapsed()):
            return YES
        if self.opaque or other.opaque:
            return UNK
        return NO


def _cov_iv(outer, inner_iv):
    import bisect
    oiv, ostarts = outer
    for ver, L in inner_iv.items():
        O, S = oiv[ver], ostarts[ver]
        for lo, hi in L:
            i = bisect.bisect_right(S, lo) - 1
            if i < 0 or O[i][1] < hi:
                return False
    return True


def _cov_collapsed(outer, inner):
    for n in inner:
        if not any(o.version == n.version and o.prefixlen <= n.prefixlen and n.subnet_of(o) for o in outer):
            return False
    return True


@dataclass
class SvcSet:
    all: bool = False
    ranges: dict = field(default_factory=dict)  # proto -> list[(lo,hi)]
    opaque: set = field(default_factory=set)
    approx: bool = False  # e.g. source-port restrictions not modelled

    def add(self, proto, lo, hi):
        self.ranges.setdefault(proto, []).append((int(lo), int(hi)))

    def _cov(self, proto, lo, hi):
        rs = sorted(self.ranges.get(proto, []))
        cur = lo
        for a, b in rs:
            if a <= cur <= b:
                cur = b + 1
                if cur > hi:
                    return True
        return cur > hi

    def covers(self, other: "SvcSet") -> str:
        if self.all:
            return UNK if self.approx else YES
        if other.all:
            return NO
        for p, rs in other.ranges.items():
            for lo, hi in rs:
                if not self._cov(p, lo, hi):
                    return NO
        if not other.opaque <= self.opaque:
            return UNK
        return UNK if (self.approx or other.approx) else YES

    def intersects(self, other: "SvcSet") -> str:
        if self.all or other.all:
            return YES
        for p, rs in other.ranges.items():
            for lo, hi in rs:
                for a, b in self.ranges.get(p, []):
                    if a <= hi and lo <= b:
                        return YES
        if self.opaque & other.opaque:
            return YES
        return UNK if (self.opaque or other.opaque) else NO

    def describe(self):
        if self.all:
            return "ALL"
        parts = [f"{p}/{lo}" + (f"-{hi}" if hi != lo else "") for p, rs in self.ranges.items() for lo, hi in rs]
        return ", ".join(parts + sorted(self.opaque))


class Expander:
    def __init__(self, ctx):
        self.ctx = ctx
        self.m = ctx.m
        self.r = ctx.r
        self._addr_cache = {}
        self._svc_cache = {}

    # ---------- interfaces ----------
    def intf(self, names: list[str]):
        out = set()
        for n in names or []:
            if n == "any":
                return ANY
            out |= self.intf_members(n)
        return frozenset(out)

    def intf_members(self, n: str) -> set[str]:
        e = self.r.resolve("interface", n)
        if e is None or e == "predefined":
            if n in ("virtual-wan-link", "sdwan"):
                return {x.first("interface") for x in self.m.entries("system sdwan > members") if x.first("interface")} or {n}
            return {n}
        if e.path == "system zone":
            return set(e.get("interface") or [])
        if e.path == "system sdwan > zone":
            return {x.first("interface") for x in self.m.entries("system sdwan > members")
                    if x.first("zone", "virtual-wan-link") == n and x.first("interface")} or {n}
        return {n}

    # ---------- addresses ----------
    def addr(self, names: list[str], v6=False) -> AddrSet:
        s = AddrSet()
        for n in names or []:
            sub = self._addr1(n, v6, frozenset())
            s.nets += sub.nets
            s.opaque.update(sub.opaque)
        return s

    def _addr1(self, n, v6, seen) -> AddrSet:
        key = (n, v6)
        if key in self._addr_cache:
            return self._addr_cache[key]
        s = AddrSet()
        ns = "address6" if v6 else "address"
        if n == "all":
            s.nets.append(ANY6 if v6 else ANY4)
        elif n == "none":
            pass
        elif n in seen:
            s.opaque["loop:" + n] = "unresolved"
        else:
            e = self.r.resolve(ns, n)
            if e is None or e == "predefined":
                s.opaque[n] = "unresolved"
            elif e.path in ("firewall addrgrp", "firewall addrgrp6"):
                if e.first("exclude") == "enable":
                    s.opaque["grp-exclude:" + n] = "exclude"
                for mbr in e.get("member") or []:
                    sub = self._addr1(mbr, v6, seen | {n})
                    s.nets += sub.nets
                    s.opaque.update(sub.opaque)
            elif e.path in ("firewall vip", "firewall vip6", "firewall vipgrp", "firewall vipgrp6"):
                s.opaque["vip:" + n] = "vip"
            else:
                self._addr_entry(e, s, v6)
        self._addr_cache[key] = s
        return s

    def addr_entry_nets(self, e):
        s = AddrSet()
        self._addr_entry(e, s, e.path.endswith("6"))
        return s

    def _addr_entry(self, e, s: AddrSet, v6):
        typ = e.first("type", "ipmask" if not v6 else "ipprefix")
        try:
            if typ in ("ipmask", "ipprefix"):
                if v6:
                    s.nets.append(ipa.ip_network(e.first("ip6", "::/0"), strict=False))
                else:
                    iface = parse_ipmask(e.get("subnet") or ["0.0.0.0", "0.0.0.0"])
                    s.nets.append(iface.network)
            elif typ == "iprange":
                s.nets += range_to_nets(e.first("start-ip", "0.0.0.0"), e.first("end-ip", "0.0.0.0"))
            elif typ == "interface-subnet":
                ie = self.m.entry("system interface", e.first("interface", ""))
                ifc = safe_ipmask(ie.get("ip")) if ie else None
                if ifc:
                    s.nets.append(ifc.network)
                else:
                    s.opaque["ifsubnet:" + e.key] = "dynamic"
            else:
                s.opaque[f"{typ}:{e.key}"] = typ
        except ValueError:
            s.opaque["invalid:" + e.key] = "unresolved"

    # ---------- services ----------
    def svc(self, names: list[str]) -> SvcSet:
        s = SvcSet()
        for n in names or []:
            self._svc1(n, s, frozenset())
        return s

    def _svc1(self, n, s: SvcSet, seen):
        if n in seen:
            s.opaque.add("loop:" + n)
            return
        e = self.r.resolve("service", n)
        if isinstance(e, type(None)) or e == "predefined":
            p = self.m.schema.PREDEFINED_SERVICES.get(n)
            if p == "ALL":
                s.all = True
            elif p:
                for proto, lo, hi in p:
                    s.add(proto, lo, hi)
            else:
                s.opaque.add(n)
            return
        if e.path == "firewall service group":
            for mbr in e.get("member") or []:
                self._svc1(mbr, s, seen | {n})
            return
        proto = (e.first("protocol", "TCP/UDP/SCTP") or "").upper()
        if proto in ("TCP/UDP/SCTP", "TCP/UDP/UDP-LITE/SCTP"):
            any_rng = False
            for attr, p in (("tcp-portrange", "tcp"), ("udp-portrange", "udp"), ("sctp-portrange", "sctp")):
                for tok in e.get(attr) or []:
                    any_rng = True
                    dst, _, src = tok.partition(":")
                    if src and src not in ("0-65535", "1-65535"):
                        s.approx = True
                    lo, _, hi = dst.partition("-")
                    try:
                        s.add(p, int(lo), int(hi or lo))
                    except ValueError:
                        s.opaque.add(n)
            if not any_rng:
                s.opaque.add(n)
        elif proto in ("ICMP", "ICMP6"):
            t = e.first("icmptype")
            p = proto.lower()
            if t is None:
                s.add(p, 0, 255)
            else:
                s.add(p, int(t), int(t))
                if e.first("icmpcode") is not None:
                    s.approx = True
        elif proto == "IP":
            num = int(e.first("protocol-number", "0") or 0)
            if num == 0:
                s.all = True
            else:
                s.add("ip", num, num)
        else:
            s.opaque.add(n)


@dataclass
class MatchSpace:
    pid: str
    entry: object
    srcintf: object
    dstintf: object
    src: AddrSet
    dst: AddrSet
    svc: SvcSet
    schedule: str
    users: frozenset
    special: list  # reasons the match space is not fully modelled
    enabled: bool
    action: str
    v6: bool = False

    def covers(self, o: "MatchSpace") -> str:
        parts = []
        for fn in (lambda: _intf_cov(self.srcintf, o.srcintf), lambda: _intf_cov(self.dstintf, o.dstintf),
                   lambda: self._sched_cov(o), lambda: self._users_cov(o), lambda: self.svc.covers(o.svc),
                   lambda: self.src.covers(o.src), lambda: self.dst.covers(o.dst)):
            v = fn()
            if v == NO:
                return NO
            parts.append(v)
        if self.special or o.special:
            parts.append(UNK)
        return tri_and(*parts)

    def intersects(self, o: "MatchSpace") -> str:
        parts = [_intf_int(self.srcintf, o.srcintf), _intf_int(self.dstintf, o.dstintf),
                 self.src.intersects(o.src), self.dst.intersects(o.dst), self.svc.intersects(o.svc)]
        if self.schedule != o.schedule and "always" not in (self.schedule, o.schedule):
            parts.append(UNK)
        if self.special or o.special or self.users or o.users:
            parts.append(UNK)
        return tri_and(*parts)

    def _sched_cov(self, o):
        if self.schedule == "always" or self.schedule == o.schedule:
            return YES
        if self.schedule == "none":
            return NO
        return UNK

    def _users_cov(self, o):
        if not self.users:
            return YES
        if not o.users:
            return NO
        return YES if o.users <= self.users else UNK


def _intf_cov(a, b):
    if a == ANY:
        return YES
    if b == ANY:
        return NO
    return YES if b <= a else NO


def _intf_int(a, b):
    if a == ANY or b == ANY:
        return YES
    return YES if a & b else NO


SPECIAL_ATTRS = ["internet-service", "internet-service-src", "srcaddr-negate", "dstaddr-negate", "service-negate",
                 "ztna-status", "src-vendor-mac", "fsso-groups", "device-ownership"]


def match_space(exp: Expander, e, v6=False) -> MatchSpace:
    special = []
    for a in SPECIAL_ATTRS:
        v = e.first(a)
        if v and v not in ("disable", "") and e.explicit(a):
            special.append(a)
    for a in ("internet-service-name", "internet-service-id", "internet-service-src-name", "dstaddr6", "srcaddr6"):
        if e.explicit(a) and not v6:
            if a in ("dstaddr6", "srcaddr6"):
                continue  # dual-stack policies in 7.4: v6 part analysed separately
            special.append(a)
    users = frozenset((e.get("users") or []) + (e.get("groups") or []))
    return MatchSpace(
        pid=e.key, entry=e, srcintf=exp.intf(e.get("srcintf")), dstintf=exp.intf(e.get("dstintf")),
        src=exp.addr(e.get("srcaddr"), v6), dst=exp.addr(e.get("dstaddr"), v6), svc=exp.svc(e.get("service")),
        schedule=e.first("schedule", "none"), users=users, special=special,
        enabled=e.first("status", "enable") == "enable", action=e.first("action", "deny"), v6=v6)


# attributes that change what an *accepted* session gets, but not whether it matches
BEHAVIOUR_ATTRS = ["action", "nat", "poolname", "ippool", "av-profile", "webfilter-profile", "application-list",
                   "ips-sensor", "dnsfilter-profile", "ssl-ssh-profile", "file-filter-profile", "profile-group",
                   "utm-status", "logtraffic", "inspection-mode", "traffic-shaper", "fixedport", "profile-type"]


def behaviour_signature(e) -> tuple:
    return tuple((a, tuple(e.get(a) or [])) for a in BEHAVIOUR_ATTRS)


MATCH_ATTRS = ["srcintf", "dstintf", "srcaddr", "dstaddr", "service", "schedule", "users", "groups",
               "srcaddr-negate", "dstaddr-negate", "service-negate", "internet-service", "internet-service-name",
               "srcaddr6", "dstaddr6"]


def match_signature(e) -> tuple:
    return tuple((a, tuple(sorted(e.get(a) or []))) for a in MATCH_ATTRS)
