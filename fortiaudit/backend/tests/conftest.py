import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "synthetic_fg121g_7412.conf"
HEADER = "#config-version=FG121G-7.4.12-FW-build2902-251001:opmode=0:vdom=0:user=admin\n"


def cfg(body: str) -> str:
    import textwrap
    return HEADER + textwrap.dedent(body).lstrip("\n")


def audit(text):
    from fortiaudit.audit import run_audit
    from fortiaudit.model import load
    m = load(text)
    return m, run_audit(m)


def rules(res):
    return [f.rule for f in res.findings]


@pytest.fixture
def fixture_text():
    return FIXTURE.read_text()
