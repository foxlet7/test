from conftest import cfg

from fortiaudit.diff import ha_compare, semantic_diff
from fortiaudit.model import load

A = '''
config system global
    set hostname "FW-A"
end
config system ha
    set group-name "C"
    set mode a-p
    set hbdev "port5" 50 "port6" 50
    set priority 200
end
config firewall address
    edit "x"
        set subnet 10.0.0.0 255.255.255.0
    next
end
config vpn certificate local
    edit "Fortinet_Factory"
        set certificate "AAA"
    next
    edit "corp-cert"
        set certificate "C1"
    next
end
config firewall policy
    edit 1
        set srcaddr "x"
        set action accept
    next
    edit 2
        set action deny
    next
end
'''


def test_semantic_diff_categories_and_order():
    b = A.replace('set srcaddr "x"', 'set srcaddr "all"').replace("    edit 1\n        set srcaddr \"all\"\n        set action accept\n    next\n    edit 2\n        set action deny\n    next\n",
                                                                    "    edit 2\n        set action deny\n    next\n    edit 1\n        set srcaddr \"all\"\n        set action accept\n    next\n")
    d = semantic_diff(load(cfg(A)), load(cfg(b)))
    mod = [i for i in d["items"] if i["uid"] == "firewall policy|1"][0]
    assert mod["changes"][0]["category"] == "policy matching behaviour"
    assert any(i["type"] == "reordered" for i in d["items"])


def test_ha_expected_vs_concerning_vs_certificates():
    b = (A.replace('"FW-A"', '"FW-B"').replace("set priority 200", "set priority 100")
         .replace("10.0.0.0 255.255.255.0", "10.0.1.0 255.255.255.0").replace('"AAA"', '"BBB"').replace('"C1"', '"C2"'))
    r = ha_compare(load(cfg(A)), load(cfg(b)))
    v = {(i["table"], i["key"]): i["verdict"] for i in r["items"]}
    assert v[("system global", "_")] == "expected"
    assert v[("system ha", "_")] == "expected"
    assert v[("firewall address", "x")] == "concerning"
    assert v[("vpn certificate local", "Fortinet_Factory")] == "expected"
    assert v[("vpn certificate local", "corp-cert")] == "review"
    # certificate values are redacted in the output
    cc = [i for i in r["items"] if i["key"] == "corp-cert"][0]
    assert cc["changes"][0]["before"] == "<redacted>"


def test_ha_cluster_param_mismatch_critical():
    b = A.replace('set group-name "C"', 'set group-name "D"')
    r = ha_compare(load(cfg(A)), load(cfg(b)))
    assert [i for i in r["items"] if i["table"] == "system ha"][0]["verdict"] == "critical"
    b2 = A
    r2 = ha_compare(load(cfg(A)), load(cfg(b2).replace("7.4.12", "7.4.11")))
    assert r2["identity"]["mismatches"]
