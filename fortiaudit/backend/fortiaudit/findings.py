"""Finding model and analysis context."""
from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field

from .graph import DepGraph
from .model import ConfigModel, Entry

SEVERITIES = ["critical", "high", "medium", "low", "info"]
SEV_WEIGHT = {"critical": 25, "high": 10, "medium": 4, "low": 1, "info": 0}

# classification vocabulary
CONFIRMED = "confirmed"            # configuration fact proven by the file
CONFIRMED_DUP = "confirmed-duplicate"
CONFIRMED_SHADOW = "confirmed-shadowed"
POTENTIAL = "potential"            # inferred; plausible but not provable from config alone
OVERLAP = "potential-overlap"
REDUNDANCY = "potential-redundancy"
EXCEPTION = "intentional-exception"
VERIFY = "requires-verification"   # needs runtime / traffic-log / peer verification
OPTIMIZATION = "optimization"
INFO = "informational"

# evidence basis
FACT, INFERRED, RUNTIME = "configuration-fact", "inferred-behaviour", "runtime-verification-required"


@dataclass
class Finding:
    rule: str
    module: str
    severity: str
    title: str
    detail: str
    recommendation: str
    objects: list[str]
    lines: list[int]
    classification: str = CONFIRMED
    confidence: str = "high"
    evidence: str = FACT
    impact: str = ""
    why: str = ""
    auto_remediation: str = "never"  # never | assisted | auto-eligible
    changes: list[str] = field(default_factory=list)
    id: str = ""

    def __post_init__(self):
        if not self.id:
            h = hashlib.sha1((self.rule + "\x00" + "\x00".join(sorted(self.objects))).encode()).hexdigest()[:10]
            self.id = f"FA-{self.rule}-{h}"

    @property
    def fingerprint(self) -> str:
        return self.id

    def to_dict(self):
        return asdict(self) | {"id": self.id}


class Ctx:
    def __init__(self, model: ConfigModel, graph: DepGraph | None = None):
        self.m = model
        self.sc = model.schema
        self.g = graph or DepGraph(model)
        self.r = self.g.r
        self.findings: list[Finding] = []
        self.changes: dict = {}  # change_id -> Change (remediation)
        self.notes: list[str] = []
        self.cache: dict = {}

    def add(self, rule, module, severity, title, detail, recommendation, objs, **kw) -> Finding:
        uids, lines = [], []
        for o in objs:
            if isinstance(o, Entry):
                uids.append(o.uid)
                lines.append(o.node.line)
            elif isinstance(o, tuple):  # (uid, line)
                uids.append(o[0])
                lines.append(o[1])
            else:
                uids.append(str(o))
        extra_lines = kw.pop("extra_lines", [])
        f = Finding(rule, module, severity, title, detail, recommendation, uids, sorted(set(lines + extra_lines)), **kw)
        if any(x.id == f.id for x in self.findings):
            return next(x for x in self.findings if x.id == f.id)
        self.findings.append(f)
        return f
