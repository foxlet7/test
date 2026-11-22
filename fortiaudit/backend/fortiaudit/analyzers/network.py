"""Modules B (interfaces), C (zones), D (addresses), I (DHCP/DNS) + global reference integrity."""
from __future__ import annotations

import ipaddress as ipa
from collections import defaultdict

from ..findings import (CONFIRMED, CONFIRMED_DUP, FACT, INFERRED, OPTIMIZATION, POTENTIAL, REDUNDANCY, RUNTIME,
                        VERIFY, Ctx)
from ..model import iface_type
from ..netutil import is_unset_ip, mask_to_prefix, parse_ipmask, range_to_nets, safe_ipmask
from ..remediation import HIGH, LOW, MEDIUM, Op, build_change, name_mentions

FACTORY_ADDRESSES = {"FABRIC_DEVICE", "FIREWALL_AUTH_PORTAL_ADDRESS", "SSLVPN_TUNNEL_ADDR1", "none", "all",
                     "login.microsoftonline.com", "login.microsoft.com", "login.windows.net", "gmail.com",
                     "wildcard.google.com", "wildcard.dropbox.com", "EMS_ALL_UNKNOWN_CLIENTS", "EMS_ALL_UNMANAGEABLE_CLIENTS",
                     "G Suite", "Microsoft Office 365", "SSLVPN_TUNNEL_IPv6_ADDR1"}

FACTORY_OTHER = {"always", "none", "default-darrp-optimize", "Email Access", "Web Access", "Windows AD",
                 "Exchange Server"}

BROKEN_SEV = {"firewall policy": "high", "firewall policy6": "high", "router static": "high", "router policy": "high",
              "vpn ipsec phase2-interface": "high", "vpn ipsec phase1-interface": "high", "system zone": "high",
              "system interface": "high", "firewall vip": "high", "firewall local-in-policy": "high",
              "system dhcp server": "high", "firewall central-snat-map": "high"}


def references(ctx: Ctx):
    for b in ctx.g.broken:
        table = b.src.split("|", 1)[0]
        sev = BROKEN_SEV.get(table, "medium")
        if b.predefined_unknown:
            ctx.add("REF-UNRESOLVED", "Dependency", "low" if sev != "high" else "medium",
                    f"{b.src}: {b.attr} '{b.value}' is not defined in this file",
                    f"'{b.value}' is referenced by {b.attr} at line {b.line} but no {b.namespace} object of that name exists "
                    "in the configuration. It may be a FortiOS predefined/ISDB object that is not in this tool's "
                    "knowledge base, or a genuinely missing object.",
                    "Verify on the device (e.g. `show firewall service custom` / predefined list). If it truly does not "
                    "exist the device would have rejected the reference, so this most likely indicates a predefined "
                    "object; extend the schema module if so.",
                    [(b.src, b.line)], classification=VERIFY, confidence="low", evidence=RUNTIME)
        else:
            ctx.add("REF-BROKEN", "Dependency", sev, f"{b.src}: {b.attr} references nonexistent {b.namespace} '{b.value}'",
                    f"Line {b.line}: {b.attr} references '{b.value}', which is not defined in any {b.namespace} table "
                    f"({', '.join(ctx.sc.NAMESPACES.get(b.namespace, []))}). FortiOS normally prevents this, so the file "
                    "is inconsistent (manual edit, partial restore, or object removed in another VDOM).",
                    f"Either create the missing {b.namespace} object or correct the reference. Do not restore this file "
                    "to a device before resolving it: the restore may fail or silently drop the referencing object.",
                    [(b.src, b.line)], impact="Referencing object may be rejected on restore or not behave as intended.")


def interfaces(ctx: Ctx, rib):
    m = ctx.m
    ifs = m.entries("system interface")
    allow_overlap = (m.table("system settings").first("allow-subnet-overlap") == "enable") if m.table("system settings") else False
    by_ip = defaultdict(list)
    nets = []
    vlan_keys = defaultdict(list)
    for e in ifs:
        typ = iface_type(e)
        vd = e.first("vdom", "root")
        # VLAN checks
        if typ == "vlan" or e.explicit("vlanid"):
            vid = e.first("vlanid")
            if not e.explicit("interface"):
                ctx.add("VLAN-NO-PARENT", "B", "high", f"VLAN interface {e.key} has no parent interface",
                        "A VLAN sub-interface requires `set interface <parent>`.", "Set the correct parent interface.", [e])
            try:
                v = int(vid or 0)
                if not 1 <= v <= 4094:
                    raise ValueError
            except ValueError:
                ctx.add("VLAN-ID-INVALID", "B", "high", f"VLAN interface {e.key} has invalid VLAN ID {vid}",
                        "802.1Q VLAN IDs must be 1-4094.", "Correct the vlanid.", [e])
            else:
                vlan_keys[(e.first("interface"), v, vd)].append(e)
        # IP checks
        a = e.attrs.get("ip")
        if a and a.op == "set":
            try:
                ip = parse_ipmask(a.values)
            except ValueError as ex:
                ctx.add("INTF-IP-INVALID", "B", "high", f"Interface {e.key} has an invalid IP/mask",
                        f"`set ip {' '.join(a.values)}` cannot be interpreted: {ex}.", "Correct the address/mask.", [e])
                ip = None
            if ip and not is_unset_ip(ip):
                pl = ip.network.prefixlen
                if pl < 31 and typ not in ("tunnel", "loopback") and ip.ip in (ip.network.network_address, ip.network.broadcast_address):
                    ctx.add("INTF-IP-NETBCAST", "B", "high", f"Interface {e.key} uses the network/broadcast address {ip}",
                            f"{ip.ip} is the {'network' if ip.ip == ip.network.network_address else 'broadcast'} address of {ip.network}.",
                            "Assign a valid host address.", [e])
                by_ip[(str(ip.ip), vd)].append(e)
                nets.append((e, ip, vd))
        # admin access
        acc = set(e.get("allowaccess") or [])
        role = e.first("role", "undefined")
        is_wan = role == "wan" or e.key in _default_route_ifaces(rib)
        bad = acc & ctx.sc.INSECURE_ADMIN_ACCESS
        if bad:
            ctx.add("INTF-ADMIN-CLEARTEXT", "A", "high" if is_wan else "medium",
                    f"Clear-text management ({', '.join(sorted(bad))}) enabled on {e.key}",
                    f"allowaccess on {e.key} includes {', '.join(sorted(bad))}; credentials and sessions cross the network unencrypted."
                    + (" The interface is internet-facing (role wan or default-route egress)." if is_wan else ""),
                    "Remove http/telnet from allowaccess and use HTTPS/SSH. Confirm you still have an alternate management path before applying.",
                    [e], impact="Changing allowaccess can lock out administrators who rely on that path.",
                    auto_remediation="assisted")
            f = ctx.findings[-1]
            keep = [x for x in (e.get("allowaccess") or []) if x not in bad]
            build_change(ctx, f, f"Remove {', '.join(sorted(bad))} from {e.key} allowaccess", HIGH,
                         [Op("set_attr", "system interface", e.key, "allowaccess", keep, [False] * len(keep))
                          if keep else Op("unset_attr", "system interface", e.key, "allowaccess")],
                         "Management access change. Requires explicit approval; never auto-applied.",
                         "Administrators using HTTP/Telnet on this interface lose access.",
                         validation="After change: verify HTTPS/SSH admin access from the management network.")
        mgmt = acc & {"https", "ssh", "snmp", "fgfm", "radius-acct", "probe-response", "ftm"}
        if is_wan and mgmt & {"https", "ssh", "snmp"}:
            ctx.add("INTF-ADMIN-WAN", "A", "high", f"Administrative services ({', '.join(sorted(mgmt))}) exposed on WAN interface {e.key}",
                    "Management services on an internet-facing interface are reachable by anyone unless restricted by "
                    "admin trusted hosts or local-in policies. Exposure is inferred from role/default route.",
                    "Restrict management to an internal/OOB interface, or enforce trusted hosts and local-in policies. "
                    "Validate with `diagnose sys session filter` / external scan.",
                    [e], classification=POTENTIAL, evidence=INFERRED, confidence="medium")
        # unused/purpose
        if typ in ("physical", "vlan", "aggregate") and e.first("status", "up") == "up":
            used = ctx.g.g.in_degree(e.uid) > 0
            if not used and not name_mentions(m.pc, e.key, None):
                has_ip = a is not None and a.op == "set" and not is_unset_ip(safe_ipmask(a.values))
                ctx.add("INTF-UNUSED", "B", "low" if has_ip else "info",
                        f"Interface {e.key} is up but nothing references it",
                        "No policy, route, zone, VPN, DHCP or other object references this interface"
                        + (" although it has an IP address (it is still a connected route and admin target)." if has_ip else "."),
                        "Confirm purpose. If unused, set it administratively down (manual decision; not auto-remediated).",
                        [e], classification=VERIFY, evidence=RUNTIME, confidence="medium")
    for (ipstr, vd), es in by_ip.items():
        if len(es) > 1:
            ctx.add("INTF-DUP-IP", "B", "critical", f"Duplicate interface IP {ipstr} ({', '.join(x.key for x in es)})",
                    f"The same IP address is configured on {len(es)} interfaces in VDOM {vd}.",
                    "Assign unique addresses. Determine which interface is correct from cabling/ARP before changing.", es)
    for i in range(len(nets)):
        for j in range(i + 1, len(nets)):
            (e1, ip1, v1), (e2, ip2, v2) = nets[i], nets[j]
            if v1 != v2 or ip1.ip == ip2.ip:
                continue
            if ip1.network.prefixlen == 32 or ip2.network.prefixlen == 32:
                continue
            if ip1.network.overlaps(ip2.network):
                ctx.add("INTF-SUBNET-OVERLAP", "B", "medium" if allow_overlap else "high",
                        f"Connected subnets overlap: {e1.key} {ip1.network} / {e2.key} {ip2.network}",
                        "Overlapping connected subnets make routing ambiguous (traffic follows the more specific/first route)."
                        + (" `allow-subnet-overlap` is enabled, so FortiOS accepted it deliberately." if allow_overlap else
                           " FortiOS rejects this unless allow-subnet-overlap is enabled, so the file is inconsistent."),
                        "Re-address one interface or confirm the overlap is an intentional design.",
                        [e1, e2], classification=CONFIRMED if not allow_overlap else POTENTIAL)
    for (parent, vid, vd), es in vlan_keys.items():
        if len(es) > 1:
            ctx.add("VLAN-DUP-ID", "B", "high", f"VLAN ID {vid} used twice on parent {parent}",
                    f"{', '.join(x.key for x in es)} share VLAN {vid} on {parent} in VDOM {vd}.",
                    "Each VLAN ID must be unique per parent interface (per VDOM).", es)
    # aggregate/switch members carrying their own config
    for e in ifs:
        if e.first("type") in ("aggregate", "redundant"):
            for mbr in e.get("member") or []:
                me = m.entry("system interface", mbr)
                if me and ctx.g.g.in_degree(me.uid) > 1:
                    users = [u for u, _ in ctx.g.g.in_edges(me.uid) if u != e.uid]
                    ctx.add("AGG-MEMBER-USED", "B", "high", f"{mbr} is a member of {e.key} but is referenced elsewhere",
                            f"Aggregate/redundant members cannot be used independently; referenced by: {', '.join(users[:8])}.",
                            "Remove the independent references or the membership.", [e, me])
    # alias consistency
    named = [e for e in ifs if e.explicit("alias")]
    unnamed = [e for e in ifs if not e.explicit("alias") and e.first("type", "physical") in ("vlan", "aggregate")
               and e.explicit("ip")]
    if named and unnamed and len(named) >= len(unnamed):
        ctx.add("INTF-ALIAS-MISSING", "B", "info", f"{len(unnamed)} addressed logical interfaces have no alias",
                "Most interfaces carry an alias but these do not: " + ", ".join(e.key for e in unnamed[:20]),
                "Add descriptive aliases for consistent documentation (cosmetic).", unnamed, classification=OPTIMIZATION)


def _default_route_ifaces(rib):
    out = set()
    for r in rib.routes:
        if r.dst.prefixlen == 0:
            out |= set(r.devices)
    return out


def zones(ctx: Ctx):
    m = ctx.m
    member_of = defaultdict(list)
    for z in m.entries("system zone"):
        mem = z.get("interface") or []
        for i in mem:
            member_of[i].append(z)
        used = ctx.g.g.in_degree(z.uid) > 0
        if not mem:
            ctx.add("ZONE-EMPTY", "C", "medium" if used else "low", f"Zone {z.key} has no member interfaces",
                    "An empty zone matches no traffic." + (" It is referenced by policies, which therefore never match." if used else ""),
                    "Add the intended members or remove the zone and its references (manual decision).", [z])
        if z.first("intrazone", "deny") == "allow":
            ctx.add("ZONE-INTRAZONE-ALLOW", "C", "info", f"Zone {z.key} allows intra-zone traffic without policy",
                    "`intrazone allow` permits traffic between member interfaces with no policy, logging or inspection.",
                    "Confirm this is intended; otherwise set intrazone deny and add explicit policies.", [z],
                    classification=VERIFY, evidence=INFERRED)
    for i, zs in member_of.items():
        if len(zs) > 1:
            ctx.add("ZONE-MULTI-MEMBER", "C", "high", f"Interface {i} is a member of several zones",
                    f"{i} appears in zones {', '.join(z.key for z in zs)}; an interface can belong to only one zone.",
                    "Keep the interface in a single zone.", zs)
    # policy references member interface directly
    for path in ("firewall policy", "firewall policy6"):
        for p in m.entries(path):
            for attr in ("srcintf", "dstintf"):
                for i in p.get(attr) or []:
                    if i in member_of:
                        ctx.add("ZONE-MEMBER-DIRECT-REF", "C", "high",
                                f"Policy {p.key} references {i} directly although it is in zone {member_of[i][0].key}",
                                "FortiOS does not allow a zone member to be used directly in a policy; the file is inconsistent "
                                "and the policy may be rejected on restore.",
                                f"Reference zone {member_of[i][0].key} instead (review intent: the zone may contain more interfaces).",
                                [p, member_of[i][0]])


def addresses(ctx: Ctx, exp, rib):
    m = ctx.m
    groups = ("firewall addrgrp", "firewall addrgrp6")
    for c in ctx.g.cycles(set(groups)):
        ctx.add("ADDRGRP-CYCLE", "D", "high", "Circular address group nesting: " + " -> ".join(x.split('|')[1] for x in c),
                "Groups include each other; FortiOS does not permit this.", "Break the loop.", c)
    sigs = defaultdict(list)
    for e in m.entries("firewall address") + m.entries("firewall address6"):
        typ = e.first("type", "ipmask")
        try:
            if typ == "ipmask" and e.explicit("subnet"):
                sub = e.get("subnet")
                if len(sub) == 2 and mask_to_prefix(sub[1]) is None:
                    raise ValueError(f"non-contiguous mask {sub[1]} (use type wildcard)")
                ifc = parse_ipmask(sub)
                if ifc.ip != ifc.network.network_address:
                    ctx.add("ADDR-HOSTBITS", "D", "low", f"Address {e.key} has host bits set ({ifc})",
                            f"{ifc} is interpreted as network {ifc.network}; the configured value is ambiguous.",
                            f"Define the subnet as {ifc.network}.", [e], classification=POTENTIAL, evidence=INFERRED)
                val = str(ifc.network)
            elif typ == "iprange":
                range_to_nets(e.first("start-ip", "0.0.0.0"), e.first("end-ip", "0.0.0.0"))
                val = f"{e.first('start-ip')}-{e.first('end-ip')}"
            elif typ == "fqdn":
                if not e.first("fqdn"):
                    raise ValueError("empty fqdn")
                val = e.first("fqdn").lower()
            elif typ == "geography":
                val = e.first("country")
            else:
                val = e.text("ip6") or e.text("macaddr") or e.text("sdn") or e.text("wildcard") or e.key
        except ValueError as ex:
            ctx.add("ADDR-INVALID", "D", "high", f"Address {e.key} has an invalid definition",
                    str(ex), "Correct the address definition.", [e])
            continue
        sigs[(e.path, typ, val, e.first("associated-interface", ""))].append(e)
        # interface association sanity
        ai = e.first("associated-interface")
        if ai and typ == "ipmask" and e.path == "firewall address":
            net = parse_ipmask(e.get("subnet")).network
            if net.prefixlen > 0:
                eg = rib.egress(net.network_address)
                members = exp.intf_members(ai)
                if eg and not (eg & members) and "blackhole" not in eg:
                    ctx.add("ADDR-INTF-MISMATCH", "D", "medium",
                            f"Address {e.key} is bound to {ai} but {net} routes via {', '.join(sorted(eg))}",
                            "The associated-interface restricts where the object can be used; the static RIB says the "
                            "subnet lives behind another interface. Policies using it may be built on the wrong interface pair.",
                            "Confirm where the subnet really lives; fix the associated interface or the routing.",
                            [e], classification=POTENTIAL, evidence=INFERRED, confidence="medium")
    for (path, typ, val, ai), es in sigs.items():
        if len(es) > 1:
            used = {x.key: ctx.g.g.in_degree(x.uid) for x in es}
            ctx.add("ADDR-DUPLICATE", "D", "low", f"{len(es)} address objects define the same {typ} {val}",
                    f"Objects {', '.join(f'{k} ({v} refs)' for k, v in used.items())} have identical type/value/interface. "
                    "They may still carry different meaning (naming, ownership, fabric sync).",
                    "Consolidate only after confirming they represent the same thing: repoint references to one object, then delete the rest.",
                    es, classification=REDUNDANCY, confidence="high")
    # groups
    for g in m.entries("firewall addrgrp") + m.entries("firewall addrgrp6"):
        mem = g.get("member") or []
        if not mem or mem == ["none"]:
            used = ctx.g.g.in_degree(g.uid) > 0
            f = ctx.add("ADDRGRP-EMPTY", "D", "medium" if used else "low", f"Address group {g.key} is empty",
                        "An empty group matches nothing." + (" It is referenced, so referencing rules match nothing for this group." if used else ""),
                        "Populate or remove the group.", [g])
            if not used and not name_mentions(m.pc, g.key, g.node):
                f.auto_remediation = "auto-eligible"
                build_change(ctx, f, f"Delete empty unused group {g.key}", LOW,
                             [Op("delete_entry", g.path, g.key)],
                             "Group is empty and has zero references anywhere in the file (graph + token scan).",
                             "None expected from configuration; external tools (FortiManager, scripts) might refer to it by name.",
                             auto_eligible=True)
        bad = [x for x in mem if ctx.r.resolve("address6" if g.path.endswith("6") else "address", x) is None]
        if bad and len(bad) < len(mem):
            f = next((x for x in ctx.findings if x.rule == "REF-BROKEN" and g.uid in x.objects), None)
            if f:
                f.auto_remediation = "assisted"
                keep = [x for x in mem if x not in bad]
                build_change(ctx, f, f"Remove dangling member(s) {', '.join(bad)} from {g.key}", MEDIUM,
                             [Op("set_attr", g.path, g.key, "member", keep, [True] * len(keep))],
                             "Removes references to objects that do not exist.",
                             "If the missing object was meant to exist, its hosts are no longer matched (they were not matched before either).")
    # unused objects
    for path in ("firewall address", "firewall address6", "firewall addrgrp", "firewall addrgrp6", "firewall service custom",
                 "firewall service group", "firewall schedule recurring", "firewall schedule onetime", "firewall ippool",
                 "firewall vip"):
        for e in m.entries(path):
            if ctx.g.g.in_degree(e.uid) > 0 or e.key in FACTORY_ADDRESSES or e.key in FACTORY_OTHER:
                continue
            if path.startswith("firewall service") and (e.key in ctx.sc.PREDEFINED_SERVICES or e.explicit("category")):
                continue  # factory-default service definitions are printed in backups
            if path.startswith("firewall addrgrp") and (e.get("member") or ["none"]) == ["none"]:
                continue  # handled as empty group
            hits = name_mentions(m.pc, e.key, e.node)
            if hits:
                continue
            sensitive = path in ("firewall vip", "firewall ippool")
            fabric = e.first("fabric-object") == "enable"
            f = ctx.add("OBJ-UNUSED", "D" if "addr" in path else ("H" if sensitive else "D"), "info",
                        f"Unused {path.replace('firewall ', '')} '{e.key}'",
                        "No reference in the dependency graph and no token match anywhere else in the file."
                        + (" Object is a Security Fabric shared object (may be used on other members)." if fabric else ""),
                        "Remove if it is not needed by external tooling (FortiManager, scripts, other fabric members)."
                        + (" NAT objects are never auto-removed." if sensitive else ""),
                        [e], classification=OPTIMIZATION, confidence="high")
            if not sensitive and not fabric:
                f.auto_remediation = "auto-eligible"
                build_change(ctx, f, f"Delete unused {path} {e.key}", LOW, [Op("delete_entry", path, e.key)],
                             "Zero references (graph and full-file token scan).",
                             "None within this configuration. Verify external tooling does not reference it.", auto_eligible=True)


def dhcp(ctx: Ctx, rib):
    m = ctx.m
    ranges = []
    for d in m.entries("system dhcp server"):
        if d.first("status", "enable") != "enable":
            continue
        iname = d.first("interface")
        ie = m.entry("system interface", iname or "")
        ifc = safe_ipmask(ie.get("ip")) if ie else None
        if ie is None:
            continue  # broken ref already reported
        if ifc is None or is_unset_ip(ifc):
            ctx.add("DHCP-IF-NOIP", "I", "high", f"DHCP server {d.key} on {iname} which has no static IP",
                    "A DHCP server needs a static interface address in the served subnet.", "Assign an IP to the interface.", [d, ie])
            continue
        net = ifc.network
        gw = d.first("default-gateway")
        if gw and gw != "0.0.0.0" and ipa.ip_address(gw) not in net:
            ctx.add("DHCP-GW-OUTSIDE", "I", "high", f"DHCP server {d.key}: default gateway {gw} outside {net}",
                    "Clients will receive an unreachable default gateway.", "Use the interface IP or a gateway inside the subnet.", [d])
        nm = d.first("netmask")
        if nm and mask_to_prefix(nm) != net.prefixlen:
            ctx.add("DHCP-MASK-MISMATCH", "I", "medium", f"DHCP server {d.key}: netmask {nm} differs from {iname} /{net.prefixlen}",
                    "Clients would compute a different on-link subnet than the firewall.", "Align the netmask.", [d])
        st = d.sub.get("ip-range")
        for r in (st or []):
            try:
                rn = range_to_nets(r.first("start-ip"), r.first("end-ip"))
            except (ValueError, TypeError) as ex:
                ctx.add("DHCP-RANGE-INVALID", "I", "high", f"DHCP server {d.key} range {r.key} invalid", str(ex), "Fix the range.", [d])
                continue
            if not all(x.subnet_of(net) for x in rn):
                ctx.add("DHCP-RANGE-OUTSIDE", "I", "high",
                        f"DHCP server {d.key} range {r.first('start-ip')}-{r.first('end-ip')} is outside {net}",
                        f"The scope is not inside the subnet of {iname}.", "Correct the range.", [d], extra_lines=[r.node.line])
            if any(ifc.ip in x for x in rn):
                ctx.add("DHCP-RANGE-HAS-IFIP", "I", "high", f"DHCP server {d.key} range includes interface IP {ifc.ip}",
                        "The firewall's own address could be leased to a client (FortiOS normally avoids it, but other statics "
                        "may conflict).", "Exclude the interface address from the range.", [d])
            ranges.append((d, r, rn))
        if ie.first("dhcp-relay-service") == "enable":
            ctx.add("DHCP-SERVER-AND-RELAY", "I", "medium", f"{iname} has both a DHCP server and DHCP relay",
                    "Two DHCP services on the same interface lead to unpredictable lease assignment.",
                    "Keep one DHCP mechanism.", [d, ie])
    for i in range(len(ranges)):
        for j in range(i + 1, len(ranges)):
            a, b = ranges[i], ranges[j]
            if a[0] is b[0]:
                continue
            if any(x.overlaps(y) for x in a[2] for y in b[2]):
                ctx.add("DHCP-RANGE-OVERLAP", "I", "high", f"DHCP scopes overlap: {a[0].key} and {b[0].key}",
                        "Two servers hand out addresses from the same pool.", "Make the ranges disjoint.", [a[0], b[0]])
    for ie in m.entries("system interface"):
        if ie.first("dhcp-relay-service") == "enable":
            for ip in ie.get("dhcp-relay-ip") or []:
                try:
                    if not rib.lookup(ip):
                        ctx.add("DHCP-RELAY-NOROUTE", "I", "medium", f"No route to DHCP relay server {ip} from {ie.key}",
                                "The static RIB has no route (and no default route) to the relay target.",
                                "Add a route or correct the relay IP.", [ie], classification=POTENTIAL, evidence=INFERRED)
                except ValueError:
                    pass


def dns(ctx: Ctx):
    t = ctx.m.table("system dns")
    if t is None:
        return
    p, s = t.first("primary"), t.first("secondary")
    if p and p == s:
        ctx.add("DNS-SAME", "I", "low", "Primary and secondary system DNS are identical",
                "No DNS redundancy for FortiGuard, FQDN objects and logging.", "Configure a distinct secondary DNS.",
                [(f"system dns|_", t.node.line)])
