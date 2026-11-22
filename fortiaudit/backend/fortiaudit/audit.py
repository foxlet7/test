"""Audit orchestrator."""
from __future__ import annotations

import time
from dataclasses import dataclass

from .analyzers import network, policy, routing_vpn, system
from .findings import SEV_WEIGHT, SEVERITIES, Ctx
from .model import ConfigModel
from .policy_engine import Expander
from .routing import RIB

LIMITATIONS = [
    "Static configuration audit only: no runtime state (sessions, hit counts, tunnel/HA/BGP status) was observed.",
    "FQDN, geography, dynamic/SDN, ISDB and VIP matching are treated as 'unknown' in policy comparisons.",
    "Dynamic routes (BGP/OSPF/RIP/DHCP/PPPoE) are not part of the reconstructed RIB.",
    "FortiOS 7.4 schema/defaults were authored from engineering knowledge and are marked unverified until reconciled with the 7.4.12 CLI reference.",
    "Peer-side VPN configuration, upstream NAT and external management tooling are outside the file.",
    "A clean audit does not mean the firewall is healthy; it means no issue was detected by these checks.",
]


@dataclass
class AuditResult:
    ctx: Ctx
    rib: RIB
    duration: float

    @property
    def findings(self):
        return self.ctx.findings

    def summary(self) -> dict:
        by = {s: 0 for s in SEVERITIES}
        for f in self.findings:
            by[f.severity] += 1
        penalty = sum(SEV_WEIGHT[f.severity] for f in self.findings if f.classification not in ("optimization",))
        score = max(0, round(100 - min(100, penalty * 100 / (penalty + 150)))) if penalty else 100
        return {"total": len(self.findings), "by_severity": by,
                "optimizations": sum(1 for f in self.findings if f.classification == "optimization"),
                "health_score": score, "health_note": "Static-configuration indicator only; not a runtime health statement.",
                "changes": len(self.ctx.changes),
                "auto_eligible_changes": sum(1 for c in self.ctx.changes.values() if c.auto_eligible)}


def run_audit(model: ConfigModel) -> AuditResult:
    t0 = time.time()
    ctx = Ctx(model)
    rib = RIB(ctx)
    exp = Expander(ctx)
    ctx.cache["rib"] = rib
    ctx.cache["exp"] = exp
    for iss in model.issues:
        if iss.severity in ("error", "warning"):
            ctx.add("PARSE-" + ("ERROR" if iss.severity == "error" else "WARN"), "Parser",
                    "high" if iss.severity == "error" else "low", f"Parse issue at line {iss.line}", iss.message,
                    "Review the configuration text at this line; affected section is only partially analysed.",
                    [(f"line|{iss.line}", iss.line)], classification="requires-verification")
    for w in model.identity()["warnings"]:
        ctx.add("BASELINE-MISMATCH", "Parser", "medium", "Configuration does not match the authoritative baseline", w,
                "Results rely on FortiOS 7.4.12 semantics; validate findings manually for this firmware/model.", [],
                classification="requires-verification")
    if model.multi_vdom and len(model.vdoms) > 1:
        ctx.add("MULTI-VDOM", "Parser", "info", f"Multi-VDOM configuration: analysing VDOM '{model.active}' (+global)",
                f"VDOMs present: {', '.join(model.vdoms)}. Other VDOMs are parsed and preserved but not audited in this run.",
                "Select another VDOM in project settings to audit it.", [], classification="requires-verification")
    network.references(ctx)
    network.interfaces(ctx, rib)
    network.zones(ctx)
    network.addresses(ctx, exp, rib)
    network.dhcp(ctx, rib)
    network.dns(ctx)
    policy.policies(ctx, exp, rib)
    policy.nat(ctx, rib)
    routing_vpn.routing(ctx, rib)
    routing_vpn.vpn(ctx, rib, exp)
    system.system(ctx, rib)
    system.security_profiles(ctx)
    system.ha(ctx)
    order = {s: i for i, s in enumerate(SEVERITIES)}
    ctx.findings.sort(key=lambda f: (order[f.severity], f.module, f.rule))
    return AuditResult(ctx, rib, time.time() - t0)


def coverage(model: ConfigModel) -> dict:
    sc = model.schema
    tabs = model.all_tables()
    analysed, other = [], []
    for t in tabs:
        base = t.path.split(" > ")[0]
        (analysed if base in sc.ANALYZED_TABLES else other).append({"path": t.path, "entries": len(t), "line": t.node.line})
    unknown_lines = [i.line for i in model.issues if "unrecognised" in i.message]
    return {"analysed_tables": analysed, "parsed_not_analysed": other, "unrecognised_lines": unknown_lines,
            "note": "Parsed-but-not-analysed tables are preserved verbatim and included in round-trip output."}
