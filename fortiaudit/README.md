# FortiAudit — FortiGate configuration intelligence, audit and safe remediation

A local, offline engineering workstation for FortiGate CLI configuration backups. The baseline is **FortiOS 7.4.12 build 2902 on a FortiGate 121G**.

- **Offline.** No cloud calls, no telemetry and no AI services. The server binds to `127.0.0.1` only.
- **No device access.** It never connects to a firewall and never runs imported commands.
- **Deterministic.** Parsing, IP maths, dependency resolution and policy analysis are plain Python logic.

Design and safety model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Run

```bash
./run.sh            # Linux/macOS: creates .venv on first run, then serves http://127.0.0.1:8765
run.bat             # Windows
```
Options: `--port 8765` and `--data <dir>`. The data directory defaults to `~/.fortiaudit`: a SQLite database plus immutable backups, all with 0600 permissions.

Workflow:
1. Create a project.
2. **Import config** (choose the role: Primary, Secondary, Revision or Modified).
3. Review the Dashboard, the inventories and the Audit.
4. In the **Remediation Center**, approve or reject each change, then *Generate corrected config*. You get a new revision that has been re-parsed, re-audited and semantically diffed, plus the CLI script with rollback.
5. Open the revision to re-audit it, or diff it against the original.
6. For HA, import both members and open **HA Comparison**.

## Tests
```bash
cd backend && python -m pytest -q        # 50 tests: parser, network, policy, routing/VPN, remediation, diff/HA, API, redaction
```

## What is implemented

| Area | Status |
|---|---|
| Parser (all CLI verbs, quoting/escapes, multi-line values, VDOMs, malformed input) | Lossless round trip, tested byte for byte. Unknown lines are kept and flagged. |
| Identification | Model, firmware and build from `#config-version`. Warns if the file does not match the baseline. |
| Dependency graph | Forward and reverse dependencies, transitive impact with reference chains, broken references, orphans, cycles |
| A System/admin | Trusted hosts, 2FA, cleartext or WAN management, TLS, NTP, remote logging, SNMP, local-in policies, automation scripts |
| B Interfaces | Duplicate IPs, overlapping subnets (honours `allow-subnet-overlap`), VLAN ID/parent/duplicates, network/broadcast addresses, aggregate misuse, unused interfaces, aliases, full dependency view |
| C Zones | Empty zones, interfaces in several zones, members referenced directly by policies, intra-zone allow |
| D Addresses | Invalid objects, host bits, duplicates, circular or empty groups, dangling members, wrong interface association, unused objects (graph check plus whole-file token scan) |
| E Policies | First-match algebra with yes/no/unknown answers. Finds exact duplicates, confirmed and potential shadows, overlaps, any/any/ALL rules, missing logging, missing security profiles, dstintf that disagrees with routing, reverse-path (RPF) problems, hairpins. |
| F Routing | Static RIB reconstruction, unreachable gateways, duplicates, ECMP and conflicts, blackholes (informational), missing default, policy-based routes, SD-WAN health checks, BGP references |
| G IPsec | Proposals and DH groups, aggressive mode, IKEv1, DPD, PFS, phase 1 without phase 2, policies in each direction, missing routes to remote selectors, policy vs selector mismatch, duplicate peers, overlapping remotes, per-tunnel dependency diagram |
| H NAT | VIP conflicts, full 1:1 VIP on an interface IP, VIP exposed on ALL services, VIP dstintf mismatch, `extintf any`, IP pool overlap, central NAT consistency |
| I DHCP/DNS | Range outside subnet, gateway outside subnet, mask mismatch, overlapping scopes, interface IP inside the range, server and relay on one interface, relay with no route |
| J Profiles | Unused profiles, content inspection without deep SSL inspection, deny policies carrying profiles, no DoS policy |
| K HA | Single heartbeat, no monitored interfaces, session pickup, override. Two-member comparison classes each difference as expected, review, concerning or critical. |
| Path simulation | VIP DNAT, then policy routes, then RIB, then egress, then first-match policy, then NAT, then return-path check |
| Remediation | 3 modes. Minimal line-level patches, CLI plus rollback (including policy `move`), and post-apply checks: re-parse, re-audit, no new broken references, semantic diff limited to the intended objects |
| Diff | Semantic, at object and attribute level, with behaviour categories, reorder detection and dependents count |
| Reports | HTML, PDF, JSON and CSV, all redacted |
| Security | Localhost and Host-header checks, a CSRF header on mutations, CSP, upload validation, redaction, full project deletion |

## Known gaps and deviations (read before relying on results)
1. **No real configuration has been tested yet.** The fixture `fixtures/synthetic_fg121g_7412.conf` is hand-written in 7.4 syntax with planted defects. It proves the detectors work. It does not prove production compatibility.
2. **The FortiOS 7.4 schema module (`schema/fos74.py`) has not been checked against the 7.4.12 CLI reference.** It was written from engineering knowledge; there was no internet access during the build. It is flagged `VERIFIED=False`, and findings that depend only on a default value are marked *requires-verification*.
3. **The frontend is a dependency-free single-page app, not Next.js/shadcn/React Flow/TanStack.** This keeps it fully offline with no build step. The JSON API is a clean boundary, so a Next.js frontend can replace it later.
4. **Only one VDOM is audited per run.** Choose which in Settings. Other VDOMs are parsed and preserved. IPv6 policies get matching analysis; the IPv6 routing checks are minimal.
5. **Some tables are parsed but not analysed.** Examples: proxy policies, wireless, switch-controller, dynamic routing internals. They are listed on the Dashboard under *Parsed but not analysed* and are preserved verbatim.
