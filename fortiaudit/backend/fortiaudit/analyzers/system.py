"""Module A (system/admin/logging), J (security profiles), K (HA, single-member checks).

Nothing in these modules is ever auto-remediated: admin, certificate, management and HA settings are advisory only.
"""
from __future__ import annotations

from ..findings import CONFIRMED, FACT, INFERRED, OPTIMIZATION, POTENTIAL, RUNTIME, VERIFY, Ctx
from ..netutil import safe_ipmask


def _t(ctx, path):
    t = ctx.m.table(path)
    return t, (f"{path}|_", t.node.line) if t is not None else None


def system(ctx: Ctx, rib):
    m = ctx.m
    g, gref = _t(ctx, "system global")
    if g is None:
        ctx.add("SYS-NO-GLOBAL", "A", "medium", "No 'config system global' section", "The file lacks global system settings; it "
                "may be a partial export.", "Use a full configuration backup.", [], classification=VERIFY)
    else:
        hn = g.first("hostname")
        if not hn or hn.upper().startswith("FG") or hn.startswith("FortiGate"):
            ctx.add("SYS-HOSTNAME", "A", "info", "Hostname is missing or factory default",
                    f"hostname = {hn!r}.", "Set a descriptive hostname (HQ-FW-01 etc.).", [gref], classification=OPTIMIZATION)
        vers = g.get("admin-https-ssl-versions") or []
        weak = [v for v in vers if v in ("tlsv1-0", "tlsv1-1")]
        if weak:
            ctx.add("SYS-ADMIN-TLS", "A", "medium", f"Admin GUI allows legacy TLS ({', '.join(weak)})",
                    "TLS 1.0/1.1 are deprecated.", "Restrict admin-https-ssl-versions to tlsv1-2 tlsv1-3.", [gref])
        if g.first("strong-crypto") == "disable":
            ctx.add("SYS-STRONG-CRYPTO", "A", "medium", "strong-crypto is disabled", "Weak ciphers are allowed for HTTPS/SSH admin and some services.",
                    "Enable strong-crypto (check compatibility of old clients/peers).", [gref])
        try:
            to = int(g.first("admintimeout", "5"))
            if to > 30:
                ctx.add("SYS-ADMIN-TIMEOUT", "A", "low", f"Admin idle timeout is {to} minutes", "Long idle sessions increase session hijack exposure.",
                        "Use 5-15 minutes.", [gref])
        except ValueError:
            pass
        if g.first("admin-maintainer") == "enable" and g.explicit("admin-maintainer"):
            ctx.add("SYS-MAINTAINER", "A", "low", "Maintainer account is explicitly enabled",
                    "The maintainer login allows password reset with console access.", "Disable if physical security requires.", [gref],
                    classification=VERIFY)
        if not g.explicit("timezone"):
            ctx.add("SYS-TIMEZONE", "A", "info", "Timezone not explicitly set", "Default timezone may not match site; affects schedules and logs.",
                    "Set timezone explicitly.", [gref], classification=VERIFY)
    # admins
    admins = m.entries("system admin")
    supers = [a for a in admins if a.first("accprofile") == "super_admin"]
    wan_mgmt = any(f.rule == "INTF-ADMIN-WAN" for f in ctx.findings)
    for a in admins:
        th = [a.get(f"trusthost{i}") for i in range(1, 11)]
        th = [x for x in th if x and safe_ipmask(x) and safe_ipmask(x).network.prefixlen > 0]
        if not th and not a.explicit("ip6-trusthost1"):
            ctx.add("ADMIN-NO-TRUSTHOST", "A", "high" if wan_mgmt else "medium", f"Administrator '{a.key}' has no trusted hosts",
                    "The account can log in from any source address on any interface with admin access."
                    + (" Management is also exposed on a WAN interface." if wan_mgmt else ""),
                    "Configure trusthost entries for the admin networks. Admin access is never auto-modified.", [a])
        if a.first("accprofile") == "super_admin" and a.first("two-factor", "disable") == "disable" and not a.explicit("remote-auth"):
            ctx.add("ADMIN-NO-2FA", "A", "low", f"Super-admin '{a.key}' has no two-factor authentication",
                    "Local super-admin without 2FA.", "Enable FortiToken/email 2FA or use remote auth with MFA.", [a], classification=VERIFY)
    if any(a.key == "admin" for a in admins):
        ctx.add("ADMIN-DEFAULT-NAME", "A", "low", "Default 'admin' account exists", "A well-known username simplifies brute force.",
                "Create named admins and rename/disable 'admin' (manual; keep console recovery path).",
                [next(a for a in admins if a.key == "admin")], classification=VERIFY)
    if len(supers) > 3:
        ctx.add("ADMIN-MANY-SUPER", "A", "low", f"{len(supers)} super_admin accounts",
                "Many full-privilege accounts widen the attack surface.", "Apply least privilege with custom access profiles.", supers,
                classification=OPTIMIZATION)
    # NTP
    ntp, nref = _t(ctx, "system ntp")
    if ntp is None or ntp.first("ntpsync") == "disable":
        ctx.add("SYS-NTP", "A", "medium", "NTP synchronisation not enabled",
                "Accurate time is required for logs, certificates, schedules, FortiGuard and HA.", "Enable ntpsync with reliable servers.",
                [nref] if nref else [], classification=CONFIRMED if ntp is not None else VERIFY)
    # logging
    remote = False
    for p in ("log syslogd setting", "log syslogd2 setting", "log fortianalyzer setting", "log fortianalyzer-cloud setting",
              "log fortiguard setting"):
        t = m.table(p)
        if t is not None and t.first("status") == "enable":
            remote = True
    if not remote:
        ctx.add("LOG-NO-REMOTE", "A", "medium", "No remote log destination enabled",
                "Neither syslog nor FortiAnalyzer/FortiGuard logging is enabled in this file; local disk logs are limited and lost on failure.",
                "Send logs to FortiAnalyzer or syslog/SIEM.", [], classification=VERIFY, evidence=FACT)
    # SNMP
    for c in m.entries("system snmp community"):
        if c.first("status", "enable") != "enable":
            continue
        nm = (c.first("name") or "").lower()
        if nm in ("public", "private", "community", "fortinet"):
            ctx.add("SNMP-DEFAULT-COMMUNITY", "A", "high", f"SNMP community {c.key} uses a well-known community string",
                    "The community string (redacted) is a common default and is guessable.", "Use SNMPv3 with auth/priv.", [c])
        else:
            ctx.add("SNMP-V2C", "A", "low", f"SNMP v1/v2c community {c.key} enabled", "v1/v2c sends the community in clear text.",
                    "Prefer SNMPv3 (authPriv).", [c], classification=VERIFY)
        hosts = c.sub.get("hosts")
        for h in (hosts or []):
            ip = safe_ipmask(h.get("ip"))
            if ip and ip.network.prefixlen == 0:
                ctx.add("SNMP-ANY-HOST", "A", "medium", f"SNMP community {c.key} accepts queries from any host",
                        "Host 0.0.0.0/0 in the community host list.", "Restrict to NMS addresses.", [c])
    # local-in
    if wan_mgmt and not m.entries("firewall local-in-policy"):
        ctx.add("LOCALIN-NONE", "A", "medium", "Management is exposed on WAN and no local-in policies exist",
                "Local-in policies are the only per-source control besides trusted hosts for traffic to the FortiGate itself.",
                "Add local-in policies restricting admin/IKE/SSL-VPN sources.", [], classification=POTENTIAL, evidence=INFERRED)
    for s in m.entries("system automation-action"):
        if s.first("action-type") == "cli-script":
            ctx.add("AUTOMATION-CLI", "A", "medium", f"Automation action {s.key} runs a CLI script",
                    "Automation stitches with CLI scripts change configuration automatically when triggered.",
                    "Review the script, trigger and who can modify it.", [s], classification=VERIFY)


def security_profiles(ctx: Ctx):
    m = ctx.m
    for path, ns in (("antivirus profile", "av-profile"), ("webfilter profile", "webfilter-profile"),
                     ("application list", "application-list"), ("ips sensor", "ips-sensor"),
                     ("dnsfilter profile", "dnsfilter-profile"), ("firewall ssl-ssh-profile", "ssl-ssh-profile"),
                     ("file-filter profile", "file-filter-profile"), ("dlp profile", "dlp-profile")):
        for e in m.entries(path):
            if ctx.g.g.in_degree(e.uid) == 0 and e.key not in ctx.sc.PREDEFINED.get(ns, set()):
                ctx.add("PROFILE-UNUSED", "J", "info", f"Unused {path} '{e.key}'", "Not referenced by any policy or profile group.",
                        "Remove if obsolete (manual; security profiles are never auto-removed).", [e], classification=OPTIMIZATION)
    for p in m.entries("firewall policy"):
        if p.first("action") != "accept":
            continue
        ssl = p.first("ssl-ssh-profile", "no-inspection")
        content = [a for a in ("av-profile", "file-filter-profile", "dlp-profile") if p.explicit(a)]
        if content and ssl in ("no-inspection", "certificate-inspection"):
            ctx.add("PROFILE-NO-DEEP", "J", "info", f"Policy {p.key}: content inspection with {ssl}",
                    f"{', '.join(content)} cannot inspect encrypted (HTTPS/SMTPS...) payloads without deep inspection; most web "
                    "traffic is TLS.", "Consider deep inspection where legally/operationally acceptable.", [p],
                    classification=VERIFY, evidence=INFERRED)
    for d in m.entries("firewall DoS-policy"):
        pass
    wan = {e.key for e in m.entries("system interface") if e.first("role") == "wan"}
    if wan and not m.entries("firewall DoS-policy"):
        ctx.add("DOS-NONE", "J", "low", "No DoS policies on WAN interfaces", "DoS anomaly protection is not configured.",
                "Consider DoS policies with tuned thresholds (baseline traffic first).", [], classification=VERIFY)


def ha(ctx: Ctx):
    t, ref = _t(ctx, "system ha")
    if t is None:
        return
    mode = t.first("mode", "standalone")
    if mode == "standalone":
        ctx.add("HA-STANDALONE", "K", "info", "HA mode is standalone", "This unit is not configured as an HA member.",
                "If this is an HA pair member, the file may be from the wrong unit.", [ref], classification=VERIFY)
        return
    hb = (t.get("hbdev") or [])[::2]
    if len(hb) < 2:
        ctx.add("HA-ONE-HB", "K", "medium", f"Only one heartbeat interface ({', '.join(hb) or 'none'})",
                "A single heartbeat link failure causes split-brain (both units become primary).",
                "Configure two heartbeat interfaces on separate links. HA settings are never auto-remediated.", [ref])
    if not t.get("monitor"):
        ctx.add("HA-NO-MONITOR", "K", "medium", "No HA monitored interfaces",
                "Failover will not happen when a data interface fails.", "Monitor critical WAN/LAN interfaces.", [ref])
    if t.first("session-pickup", "disable") != "enable":
        ctx.add("HA-NO-SESSION-PICKUP", "K", "low", "HA session pickup disabled",
                "Existing sessions drop on failover.", "Enable session-pickup if stateful failover is required.", [ref],
                classification=VERIFY)
    if t.first("override") == "enable":
        ctx.add("HA-OVERRIDE", "K", "info", "HA override enabled",
                "The unit with the highest priority always becomes primary, causing a second failover when it returns.",
                "Confirm intended.", [ref], classification=VERIFY)
    for i in hb:
        if ctx.r.resolve("interface", i) is None:
            pass  # broken ref reported centrally
