from conftest import audit, cfg, rules

IFS = '''
config system interface
    edit "port1"
        set ip 203.0.113.2 255.255.255.248
        set role wan
    next
    edit "port2"
        set ip 10.10.0.1 255.255.255.0
    next
    edit "port3"
        set ip 10.20.0.1 255.255.255.0
    next
end
config firewall address
    edit "LAN"
        set subnet 10.10.0.0 255.255.255.0
    next
    edit "HOST5"
        set subnet 10.10.0.5 255.255.255.255
    next
    edit "SRV"
        set subnet 10.20.0.10 255.255.255.255
    next
    edit "FQ"
        set type fqdn
        set fqdn "x.example.com"
    next
end
config firewall service custom
    edit "WEB"
        set tcp-portrange 80 443
    next
    edit "HTTPS-ONLY"
        set tcp-portrange 443
    next
end
config router static
    edit 1
        set gateway 203.0.113.1
        set device "port1"
    next
end
'''


def pol(pid, **kw):
    d = dict(srcintf='"port2"', dstintf='"port1"', srcaddr='"LAN"', dstaddr='"all"', action="accept", schedule='"always"', service='"HTTPS"')
    d.update(kw)
    body = "\n".join(f"        set {k.replace('_', '-')} {v}" for k, v in d.items())
    return f"    edit {pid}\n{body}\n    next\n"


def run(*pols):
    return audit(cfg(IFS + "config firewall policy\n" + "".join(pols) + "end\n"))


def test_exact_duplicate():
    _, r = run(pol(1), pol(2))
    f = [f for f in r.findings if f.rule == "POLICY-DUPLICATE"][0]
    assert f.classification == "confirmed-duplicate" and f.objects[0] == "firewall policy|2"


def test_shadowed_by_broader_group_and_service():
    _, r = run(pol(1, service='"WEB"'), pol(2, srcaddr='"HOST5"', service='"HTTPS-ONLY"', action="deny"))
    f = [f for f in r.findings if f.rule == "POLICY-SHADOWED"][0]
    assert f.severity == "high" and f.classification == "confirmed-shadowed"


def test_exception_before_broad_rule_not_flagged():
    _, r = run(pol(1, srcaddr='"HOST5"', action="deny"), pol(2))
    assert not {"POLICY-SHADOWED", "POLICY-DUPLICATE"} & set(rules(r))
    assert "POLICY-OVERLAP" in rules(r)


def test_different_interfaces_never_shadow():
    _, r = run(pol(1, srcintf='"port3"'), pol(2))
    assert "POLICY-SHADOWED" not in rules(r) and "POLICY-DUPLICATE" not in rules(r)


def test_disabled_policy_cannot_shadow():
    _, r = run(pol(1, status="disable"), pol(2))
    assert "POLICY-DUPLICATE" not in rules(r)


def test_fqdn_makes_shadow_only_potential():
    _, r = run(pol(1, dstaddr='"FQ"'), pol(2, dstaddr='"FQ"', srcaddr='"HOST5"'))
    # same FQDN token on both: still fully provable
    assert "POLICY-SHADOWED" in rules(r)
    _, r = run(pol(1, dstaddr='"FQ"'), pol(2, dstaddr='"SRV"'))
    assert "POLICY-SHADOWED" not in rules(r)


def test_schedule_and_users_are_unknown():
    _, r = run(pol(1, schedule='"workhours"'), pol(2))
    assert "POLICY-SHADOWED" not in rules(r) and "POLICY-POTENTIAL-SHADOW" in rules(r)
    _, r = run(pol(1, groups='"VPNUSERS"'), pol(2))
    assert "POLICY-SHADOWED" not in rules(r)


def test_any_any_all_and_logging_and_nat_missing():
    _, r = run(pol(1, srcaddr='"all"', service='"ALL"', logtraffic="disable"))
    rs = rules(r)
    assert "POLICY-ANY-ANY-ALL" in rs and "POLICY-NO-LOG" in rs and "POLICY-NAT-MISSING" not in rs  # src all is not private
    _, r = run(pol(1))
    assert "POLICY-NAT-MISSING" in rules(r)


def test_dstintf_route_mismatch_and_rpf():
    _, r = run(pol(1, dstintf='"port2"', dstaddr='"SRV"'), pol(2, srcintf='"port3"', srcaddr='"LAN"', dstintf='"port1"'))
    rs = rules(r)
    assert "POLICY-DSTINTF-ROUTE" in rs and "POLICY-SRC-RPF" in rs
    assert all(f.classification == "potential" for f in r.findings if f.rule in ("POLICY-DSTINTF-ROUTE", "POLICY-SRC-RPF"))


def test_vip_conflict_and_exposure():
    t = cfg(IFS + '''
config firewall vip
    edit "V1"
        set extip 203.0.113.3
        set mappedip "10.20.0.10"
        set extintf "port1"
        set portforward enable
        set extport 443
        set mappedport 443
    next
    edit "V2"
        set extip 203.0.113.3
        set mappedip "10.20.0.11"
        set extintf "port1"
        set portforward enable
        set extport 443
        set mappedport 8443
    next
    edit "V3"
        set extip 203.0.113.4
        set mappedip "10.20.0.12"
        set extintf "port1"
    next
end
config firewall policy
''' + pol(1, srcintf='"port1"', dstintf='"port3"', srcaddr='"all"', dstaddr='"V3"', service='"ALL"') +
        pol(2, srcintf='"port1"', dstintf='"port2"', srcaddr='"all"', dstaddr='"V1"') + "end\n")
    _, r = audit(t)
    rs = rules(r)
    assert {"VIP-CONFLICT", "VIP-EXPOSED-ALL", "VIP-POLICY-DSTINTF"} <= set(rs)


def test_service_coverage_algebra():
    from fortiaudit.policy_engine import SvcSet, YES, NO
    a = SvcSet(); a.add("tcp", 1, 1000)
    b = SvcSet(); b.add("tcp", 443, 443); b.add("tcp", 80, 80)
    assert a.covers(b) == YES and b.covers(a) == NO
    c = SvcSet(); c.add("tcp", 1, 500); c.add("tcp", 501, 1000)
    assert c.covers(a) == YES
