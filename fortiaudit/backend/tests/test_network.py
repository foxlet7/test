from conftest import audit, cfg, rules

BASE_IF = '''
config system interface
    edit "port1"
        set ip 203.0.113.2 255.255.255.248
        set role wan
    next
    edit "port2"
        set ip 10.10.0.1 255.255.255.0
    next
'''


def test_duplicate_ip_and_overlap():
    _, r = audit(cfg(BASE_IF + '''
    edit "port3"
        set ip 10.10.0.1 255.255.255.0
    next
    edit "port4"
        set ip 10.10.0.129 255.255.255.128
    next
end
'''))
    rs = rules(r)
    assert "INTF-DUP-IP" in rs
    ov = [f for f in r.findings if f.rule == "INTF-SUBNET-OVERLAP"]
    assert ov and ov[0].classification == "confirmed"


def test_overlap_allowed_is_potential_only():
    _, r = audit(cfg('''
config system settings
    set allow-subnet-overlap enable
end
''' + BASE_IF + '''
    edit "port3"
        set ip 10.10.0.2 255.255.0.0
    next
end
'''))
    f = [f for f in r.findings if f.rule == "INTF-SUBNET-OVERLAP"][0]
    assert f.classification == "potential" and f.severity == "medium"


def test_vlans_on_same_parent_are_legitimate_but_bad_parent_and_id_flagged():
    _, r = audit(cfg(BASE_IF + '''
    edit "v10"
        set interface "port2"
        set vlanid 10
        set ip 10.1.10.1 255.255.255.0
    next
    edit "v20"
        set interface "port2"
        set vlanid 20
        set ip 10.1.20.1 255.255.255.0
    next
    edit "vbad"
        set interface "port99"
        set vlanid 0
    next
    edit "vdup"
        set interface "port2"
        set vlanid 10
    next
end
'''))
    rs = rules(r)
    assert "VLAN-ID-INVALID" in rs and "VLAN-DUP-ID" in rs
    br = [f for f in r.findings if f.rule == "REF-BROKEN"]
    assert any("port99" in f.title for f in br)
    assert not any(f.rule == "INTF-SUBNET-OVERLAP" for f in r.findings)


def test_wan_cleartext_admin_and_change_is_never_auto():
    _, r = audit(cfg('''
config system interface
    edit "port1"
        set ip 203.0.113.2 255.255.255.248
        set allowaccess ping https http telnet
        set role wan
    next
end
'''))
    f = [f for f in r.findings if f.rule == "INTF-ADMIN-CLEARTEXT"][0]
    assert f.severity == "high"
    ch = r.ctx.changes[f.changes[0]]
    assert not ch.auto_eligible and ch.risk == "high"
    assert "set allowaccess ping https" in ch.commands


def test_zone_checks():
    _, r = audit(cfg(BASE_IF + '''
    edit "port3"
        set ip 10.30.0.1 255.255.255.0
    next
end
config system zone
    edit "Z1"
        set interface "port2" "port3"
    next
    edit "Z2"
        set interface "port3" "ghost"
    next
    edit "Z3"
    next
end
config firewall policy
    edit 1
        set srcintf "port2"
        set dstintf "port1"
        set srcaddr "all"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "HTTPS"
    next
end
'''))
    rs = rules(r)
    assert {"ZONE-MULTI-MEMBER", "ZONE-MEMBER-DIRECT-REF", "ZONE-EMPTY"} <= set(rs)
    assert any(f.rule == "REF-BROKEN" and "ghost" in f.title for f in r.findings)


def test_address_groups_broken_circular_empty_and_unused():
    m, r = audit(cfg('''
config firewall address
    edit "a"
        set subnet 10.0.0.0 255.255.255.0
    next
    edit "a2"
        set subnet 10.0.0.0 255.255.255.0
    next
    edit "badmask"
        set subnet 10.0.0.0 255.0.255.0
    next
end
config firewall addrgrp
    edit "g1"
        set member "a" "nope"
    next
    edit "gx"
        set member "gy"
    next
    edit "gy"
        set member "gx"
    next
    edit "gempty"
        set member "none"
    next
end
config firewall policy
    edit 1
        set srcintf "any"
        set dstintf "any"
        set srcaddr "g1"
        set dstaddr "all"
        set action deny
        set schedule "always"
        set service "ALL"
    next
end
'''))
    rs = rules(r)
    assert {"ADDRGRP-CYCLE", "ADDRGRP-EMPTY", "ADDR-DUPLICATE", "ADDR-INVALID"} <= set(rs)
    broken = [f for f in r.findings if f.rule == "REF-BROKEN" and "nope" in f.title][0]
    assert broken.changes, "dangling member removal should be proposed"
    unused = {f.objects[0] for f in r.findings if f.rule == "OBJ-UNUSED"}
    assert "firewall address|a2" in unused and "firewall address|a" not in unused
    # unused-but-mentioned-elsewhere must not be auto-eligible
    assert all(r.ctx.changes[c].auto_eligible for f in r.findings if f.rule == "OBJ-UNUSED" for c in f.changes)


def test_object_used_outside_policy_is_not_unused():
    _, r = audit(cfg('''
config firewall address
    edit "vpnlocal"
        set subnet 10.0.0.0 255.255.255.0
    next
    edit "routeobj"
        set subnet 10.5.0.0 255.255.255.0
    next
end
config vpn ipsec phase2-interface
    edit "p2"
        set phase1name "nonexist"
        set src-addr-type name
        set src-name "vpnlocal"
    next
end
config router static
    edit 1
        set dstaddr "routeobj"
        set device "port1"
    next
end
'''))
    unused = {f.objects[0] for f in r.findings if f.rule == "OBJ-UNUSED"}
    assert "firewall address|vpnlocal" not in unused and "firewall address|routeobj" not in unused


def test_dhcp_checks():
    _, r = audit(cfg(BASE_IF + '''
end
config system dhcp server
    edit 1
        set default-gateway 10.99.0.1
        set netmask 255.255.0.0
        set interface "port2"
        config ip-range
            edit 1
                set start-ip 10.10.0.100
                set end-ip 10.10.1.20
            next
        end
    next
    edit 2
        set default-gateway 10.10.0.1
        set netmask 255.255.255.0
        set interface "port2"
        config ip-range
            edit 1
                set start-ip 10.10.0.150
                set end-ip 10.10.0.160
            next
        end
    next
end
'''))
    assert {"DHCP-GW-OUTSIDE", "DHCP-MASK-MISMATCH", "DHCP-RANGE-OUTSIDE", "DHCP-RANGE-OVERLAP"} <= set(rules(r))


def test_dependency_impact_of_interface():
    m, r = audit(cfg(BASE_IF + '''
end
config system zone
    edit "Z"
        set interface "port2"
    next
end
config firewall policy
    edit 7
        set srcintf "Z"
        set dstintf "port1"
        set srcaddr "all"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "HTTPS"
    next
end
config router static
    edit 1
        set gateway 203.0.113.1
        set device "port1"
    next
end
'''))
    imp = r.ctx.g.impact("system interface|port2")
    assert "system zone" in imp["by_table"] and "firewall policy" in imp["by_table"]
    pol = imp["by_table"]["firewall policy"][0]
    assert not pol["direct"] and pol["via"] == ["system interface|port2", "system zone|Z", "firewall policy|7"]
    imp1 = r.ctx.g.impact("system interface|port1")
    assert {"firewall policy", "router static"} <= set(imp1["by_table"])
