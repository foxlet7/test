from conftest import HEADER, cfg

from fortiaudit.model import load
from fortiaudit.parser import parse, serialize, tokenize


def test_roundtrip_fixture_lossless(fixture_text):
    pc = parse(fixture_text)
    assert serialize(pc) == fixture_text
    assert not [i for i in pc.issues if i.severity == "error"]


def test_roundtrip_crlf_and_no_trailing_newline():
    t = HEADER.replace("\n", "\r\n") + "config system global\r\n    set hostname \"X\"\r\nend"
    pc = parse(t)
    assert serialize(pc) == t


def test_header_identification():
    m = load(cfg("config system global\n    set hostname \"HQ\"\nend\n"))
    i = m.identity()
    assert (i["model"], i["version"], i["build"], i["hostname"]) == ("121G", "7.4.12", "2902", "HQ")
    assert i["baseline_match"]


def test_baseline_mismatch_warns():
    m = load("#config-version=FG100F-7.2.8-FW-build1639-240313:opmode=0:vdom=0:user=admin\nconfig system global\nend\n")
    assert len(m.identity()["warnings"]) == 3  # firmware, build, model


def test_tokenize_quotes_spaces_escapes():
    toks, q, ok = tokenize('set comments "say \\"hi\\" to C:\\\\tmp" unquoted \'single q\'')
    assert ok and toks == ["set", "comments", 'say "hi" to C:\\tmp', "unquoted", "single q"]
    assert q == [False, False, True, False, True]


def test_names_with_spaces_and_nested_tables():
    m = load(cfg('''
        config firewall address
            edit "My Server 01"
                set subnet 10.0.0.1 255.255.255.255
            next
        end
        config system interface
            edit "port1"
                set secondary-IP enable
                config secondaryip
                    edit 1
                        set ip 10.9.9.1 255.255.255.0
                    next
                end
            next
        end
    '''))
    assert m.entry("firewall address", "My Server 01") is not None
    p1 = m.entry("system interface", "port1")
    assert list(p1.sub["secondaryip"])[0].get("ip") == ["10.9.9.1", "255.255.255.0"]


def test_multiline_quoted_value():
    t = cfg('''
        config vpn certificate local
            edit "c1"
                set certificate "-----BEGIN CERTIFICATE-----
        MIIBszCCAVmgAwIBAgIU
        -----END CERTIFICATE-----"
            next
        end
    ''')
    pc = parse(t)
    assert serialize(pc) == t and not pc.issues
    e = load(t).entry("vpn certificate local", "c1")
    assert e.get("certificate")[0].count("\n") == 2


def test_empty_and_unset_and_append():
    m = load(cfg('''
        config firewall policy
            edit 1
                set comments ""
                set srcaddr "a"
                append srcaddr "b"
                unset schedule
            next
        end
    '''))
    e = m.entry("firewall policy", "1")
    assert e.get("comments") == [""]
    assert e.get("srcaddr") == ["a", "b"]
    assert e.attrs["schedule"].op == "unset" and not e.explicit("schedule")


def test_missing_next_and_end_reported_and_preserved():
    t = cfg('''
        config firewall address
            edit "a"
                set subnet 1.1.1.1 255.255.255.255
        end
        config firewall policy
            edit 1
                set action accept
    ''')
    pc = parse(t)
    msgs = " ".join(i.message for i in pc.issues)
    assert "not closed with 'next'" in msgs and "not closed before end of file" in msgs
    assert load(t).entry("firewall policy", "1").first("action") == "accept"


def test_unknown_command_preserved_and_flagged():
    t = cfg("config system global\n    frobnicate the thing\n    set hostname X\nend\n")
    pc = parse(t)
    assert serialize(pc) == t
    assert any("unrecognised" in i.message for i in pc.issues)


def test_stray_end_and_unterminated_quote():
    pc = parse(cfg('end\nconfig system global\n    set hostname "oops\nend\n'))
    msgs = [i.message for i in pc.issues]
    assert any("without matching 'config'" in x for x in msgs)
    assert any("unterminated" in x for x in msgs)


def test_duplicate_entries_and_repeated_tables():
    m = load(cfg('''
        config firewall address
            edit "a"
                set subnet 1.1.1.1 255.255.255.255
            next
            edit "a"
                set subnet 2.2.2.2 255.255.255.255
            next
        end
        config firewall address
            edit "b"
            next
        end
    '''))
    assert m.entry("firewall address", "a").get("subnet")[0] == "2.2.2.2"
    assert m.entry("firewall address", "b") is not None
    msgs = " ".join(i.message for i in m.issues)
    assert "duplicate entry" in msgs and "appears again" in msgs


def test_multi_vdom():
    m = load(HEADER + '''config vdom
edit root
next
edit DMZ
next
end
config global
config system global
    set hostname "MV"
end
end
config vdom
edit root
config firewall address
    edit "r1"
    next
end
next
edit DMZ
config firewall address
    edit "d1"
    next
end
next
end
''')
    assert m.multi_vdom and m.vdoms == ["root", "DMZ"] and m.hostname == "MV"
    assert m.entry("firewall address", "r1") and not m.entry("firewall address", "d1")
    m.active = "DMZ"
    assert m.entry("firewall address", "d1")


def test_large_configuration_performance():
    import time
    parts = ["config firewall address"]
    for i in range(3000):
        parts += [f'    edit "h{i}"', f"        set subnet 10.{i // 250}.{i % 250}.1 255.255.255.255", "    next"]
    parts += ["end", "config firewall policy"]
    for i in range(1500):
        parts += [f"    edit {i + 1}", '        set srcintf "port2"', '        set dstintf "port1"', f'        set srcaddr "h{i}"',
                  '        set dstaddr "all"', "        set action accept", '        set schedule "always"', '        set service "HTTPS"', "    next"]
    parts.append("end")
    t = HEADER + "\n".join(parts) + "\n"
    from fortiaudit.audit import run_audit
    t0 = time.time()
    m = load(t)
    assert serialize(m.pc) == t
    res = run_audit(m)
    assert time.time() - t0 < 60
    assert len(m.entries("firewall policy")) == 1500
