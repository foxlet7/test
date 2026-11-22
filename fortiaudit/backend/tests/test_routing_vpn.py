from conftest import audit, cfg, rules

from fortiaudit.sim import simulate

T = '''
config system interface
    edit "port1"
        set ip 203.0.113.2 255.255.255.248
        set role wan
    next
    edit "port2"
        set ip 10.10.0.1 255.255.255.0
    next
    edit "tun1"
        set type tunnel
        set interface "port1"
    next
end
config firewall address
    edit "LAN"
        set subnet 10.10.0.0 255.255.255.0
    next
    edit "REMOTE"
        set subnet 172.16.1.0 255.255.255.0
    next
end
config vpn ipsec phase1-interface
    edit "tun1"
        set interface "port1"
        set ike-version 2
        set proposal aes128-sha1 aes256gcm-prfsha384
        set dhgrp 2 20
        set remote-gw 198.51.100.1
        set psksecret ENC abc
    next
end
config vpn ipsec phase2-interface
    edit "tun1-p2"
        set phase1name "tun1"
        set proposal aes256gcm
        set src-subnet 10.10.0.0 255.255.255.0
        set dst-subnet 172.16.1.0 255.255.255.0
    next
end
config firewall policy
    edit 1
        set srcintf "port2"
        set dstintf "tun1"
        set srcaddr "LAN"
        set dstaddr "REMOTE"
        set action accept
        set schedule "always"
        set service "ALL"
    next
    edit 2
        set srcintf "port2"
        set dstintf "port1"
        set srcaddr "LAN"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "HTTPS"
        set nat enable
    next
end
'''


def test_vpn_route_missing_and_weak_crypto():
    _, r = audit(cfg(T + '''
config router static
    edit 1
        set gateway 203.0.113.1
        set device "port1"
    next
end
'''))
    rs = rules(r)
    assert {"VPN-ROUTE-MISSING", "VPN-WEAK-PROPOSAL", "VPN-WEAK-DH", "VPN-ONE-DIRECTION"} <= set(rs)
    f = [f for f in r.findings if f.rule == "VPN-ROUTE-MISSING"][0]
    assert "port1" in f.detail  # default route would carry the traffic to the internet


def test_vpn_route_present_and_blackhole_failclosed():
    _, r = audit(cfg(T + '''
config router static
    edit 1
        set gateway 203.0.113.1
        set device "port1"
    next
    edit 2
        set dst 172.16.1.0 255.255.255.0
        set device "tun1"
    next
    edit 3
        set dst 172.16.1.0 255.255.255.0
        set blackhole enable
        set distance 254
    next
end
'''))
    rs = rules(r)
    assert "VPN-ROUTE-MISSING" not in rs and "ROUTE-BLACKHOLE" in rs
    assert [f for f in r.findings if f.rule == "ROUTE-BLACKHOLE"][0].severity == "info"
    sim = simulate(r.ctx, "10.10.0.20", "172.16.1.5", "tcp", 22)
    assert sim["verdict"] == "accept"
    assert [s for s in sim["steps"] if s["step"] == "egress"][0]["result"] == ["tun1"]
    sim2 = simulate(r.ctx, "10.10.0.20", "8.8.8.8", "tcp", 443)
    assert sim2["verdict"] == "accept" and "SNAT" in [s for s in sim2["steps"] if s["step"] == "nat"][0]["result"]
    sim3 = simulate(r.ctx, "10.10.0.20", "8.8.8.8", "udp", 53)
    assert sim3["verdict"].startswith("deny")


def test_route_gateway_unreachable_duplicate_and_no_default():
    _, r = audit(cfg('''
config system interface
    edit "port2"
        set ip 10.10.0.1 255.255.255.0
    next
end
config router static
    edit 1
        set dst 192.168.0.0 255.255.0.0
        set gateway 10.99.0.1
        set device "port2"
    next
    edit 2
        set dst 192.168.5.0 255.255.255.0
        set gateway 10.10.0.254
        set device "port2"
    next
    edit 3
        set dst 192.168.5.0 255.255.255.0
        set gateway 10.10.0.254
        set device "port2"
    next
end
'''))
    rs = rules(r)
    assert {"ROUTE-GW-UNREACHABLE", "ROUTE-DUPLICATE", "ROUTE-NO-DEFAULT"} <= set(rs)


def test_rib_longest_prefix_distance_priority():
    from fortiaudit.findings import Ctx
    from fortiaudit.model import load
    from fortiaudit.routing import RIB
    m = load(cfg('''
config system interface
    edit "a"
        set ip 10.0.1.1 255.255.255.0
    next
    edit "b"
        set ip 10.0.2.1 255.255.255.0
    next
end
config router static
    edit 1
        set gateway 10.0.1.254
        set device "a"
    next
    edit 2
        set dst 8.8.8.0 255.255.255.0
        set gateway 10.0.2.254
        set device "b"
        set distance 20
    next
    edit 3
        set dst 8.8.8.0 255.255.255.0
        set gateway 10.0.1.254
        set device "a"
        set distance 10
        set priority 5
    next
end
'''))
    rib = RIB(Ctx(m))
    assert rib.egress("9.9.9.9") == {"a"}
    assert rib.egress("8.8.8.8") == {"a"}
    assert rib.egress("10.0.2.7") == {"b"}
