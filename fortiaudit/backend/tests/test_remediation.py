import difflib

from conftest import audit

from fortiaudit import remediation as R
from fortiaudit.model import load


def _sel(r, pred):
    return [c for c in r.ctx.changes.values() if pred(c)]


def test_auto_eligible_only_low_risk_objects(fixture_text):
    m, r = audit(fixture_text)
    auto = _sel(r, lambda c: c.auto_eligible)
    assert auto
    for c in auto:
        assert c.risk == "low"
        assert all(op.path not in R.NEVER_AUTO_TABLES for op in c.ops)


def test_apply_changes_only_intended_lines(fixture_text):
    m, r = audit(fixture_text)
    sel = list(r.ctx.changes.values())
    new = R.apply_changes(m, sel)
    old_l, new_l = m.pc.lines, new.splitlines()
    removed = [l for l in difflib.ndiff(old_l, new_l) if l.startswith("- ")]
    added = [l for l in difflib.ndiff(old_l, new_l) if l.startswith("+ ")]
    # every added line is a set line produced by an op
    assert all(l[2:].strip().startswith("set ") for l in added)
    # deleted entries are fully gone, untouched objects still byte-identical
    nm = load(new)
    for c in sel:
        for op in c.ops:
            if op.kind == "delete_entry":
                assert nm.entry(op.path, op.key) is None
    for e in m.entries("firewall policy"):
        if not any(e.uid in c.affected for c in sel):
            ne = nm.entry("firewall policy", e.key)
            assert nm.pc.lines[ne.node.line - 1:ne.node.end_line] == m.pc.lines[e.node.line - 1:e.node.end_line]
    assert len(removed) >= 1


def test_validation_reparse_reaudit_and_no_regression(fixture_text):
    m, r = audit(fixture_text)
    sel = list(r.ctx.changes.values())
    new = R.apply_changes(m, sel)
    v = R.validate(m, new, sel, r.findings)
    assert v["ok"], v
    assert not v["remaining_targeted_findings"] and not v["new_broken_references"] and not v["parse_errors"]
    # second audit must not report the remediated findings
    _, r2 = audit(new)
    gone = {c.finding_id for c in sel}
    assert not gone & {f.id for f in r2.findings}
    # non-targeted configuration preserved: only changed objects differ semantically
    assert not v["unexpected_line_changes"]


def test_rollback_contains_original_and_restores_order(fixture_text):
    m, r = audit(fixture_text)
    ch = [c for c in r.ctx.changes.values() if c.ops[0].kind == "delete_entry"][0]
    e = m.entry(ch.ops[0].path, ch.ops[0].key)
    assert "delete" in ch.commands and f'edit "{e.key}"' in ch.rollback
    for k, a in e.attrs.items():
        assert f"set {k}" in ch.rollback
    pc = [c for c in r.ctx.changes.values() if "logging" in c.title][0]
    assert "set logtraffic disable" in pc.rollback and "set logtraffic all" in pc.commands


def test_conflicting_changes_rejected(fixture_text):
    m, r = audit(fixture_text)
    from fortiaudit.remediation import Op
    import pytest
    with pytest.raises(ValueError):
        R._patch_lines(m, m.pc.lines, [Op("delete_entry", "firewall policy", "20"),
                                        Op("set_attr", "firewall policy", "20", "logtraffic", ["all"], [False])])


def test_insert_attr_when_absent_keeps_indent(fixture_text):
    m, _ = audit(fixture_text)
    from fortiaudit.remediation import Op
    new = R._patch_lines(m, m.pc.lines, [Op("set_attr", "firewall policy", "30", "logtraffic", ["all"], [False])])
    nm = load("\n".join(new) + "\n")
    e = nm.entry("firewall policy", "30")
    assert e.get("logtraffic") == ["all"]
    assert nm.pc.lines[e.attrs["logtraffic"].line - 1].startswith("        set ")
