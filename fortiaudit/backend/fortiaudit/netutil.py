"""IPv4/IPv6 helpers for FortiOS value formats."""
from __future__ import annotations

import ipaddress as ipa

ANY4 = ipa.ip_network("0.0.0.0/0")
ANY6 = ipa.ip_network("::/0")


def mask_to_prefix(mask: str) -> int | None:
    """255.255.255.0 -> 24 ; returns None for non-contiguous / invalid masks."""
    try:
        m = int(ipa.IPv4Address(mask))
    except ValueError:
        return None
    inv = (~m) & 0xFFFFFFFF
    if inv & (inv + 1):
        return None
    return 32 - inv.bit_length()


def parse_ipmask(vals: list[str] | None):
    """Parse ['10.0.0.1','255.255.255.0'] or ['10.0.0.1/24'] -> IPv4Interface. Raises ValueError on invalid."""
    if not vals:
        raise ValueError("empty")
    if len(vals) == 1:
        v = vals[0]
        if "/" in v:
            return ipa.ip_interface(v)
        return ipa.ip_interface(v + "/32")
    ip, mask = vals[0], vals[1]
    if "." in mask:
        p = mask_to_prefix(mask)
        if p is None:
            raise ValueError(f"non-contiguous or invalid netmask {mask}")
        return ipa.ip_interface(f"{ip}/{p}")
    return ipa.ip_interface(f"{ip}/{mask}")


def safe_ipmask(vals):
    try:
        return parse_ipmask(vals)
    except (ValueError, TypeError):
        return None


def range_to_nets(start: str, end: str) -> list:
    a, b = ipa.ip_address(start), ipa.ip_address(end)
    if b < a:
        raise ValueError(f"range start {a} greater than end {b}")
    return list(ipa.summarize_address_range(a, b))


def is_unset_ip(iface) -> bool:
    return iface is None or (iface.ip.is_unspecified and iface.network.prefixlen == 0)


def net_contains(outer, inner) -> bool:
    return inner.version == outer.version and inner.subnet_of(outer)


def collapse(nets):
    v4 = [n for n in nets if n.version == 4]
    v6 = [n for n in nets if n.version == 6]
    return list(ipa.collapse_addresses(v4)) + list(ipa.collapse_addresses(v6))


def covers(outer_nets, inner_nets) -> bool:
    """Every inner network is contained in the union of outer networks."""
    outer = collapse(outer_nets)
    for n in collapse(inner_nets):
        if not any(net_contains(o, n) for o in outer):
            # could be covered by several outers jointly; collapse handles adjacency already
            return False
    return True


def overlaps(a_nets, b_nets) -> bool:
    return any(x.version == y.version and x.overlaps(y) for x in a_nets for y in b_nets)
