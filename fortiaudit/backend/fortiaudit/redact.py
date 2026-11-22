"""Redaction of secrets for display, reports and API output."""
from __future__ import annotations

import re

from .parser import tokenize
from .schema import fos74 as sc

_PEM = re.compile(r"-----BEGIN [A-Z ]+-----.*?-----END [A-Z ]+-----", re.S)


def is_sensitive(path: str, attr: str) -> bool:
    base = path.split(" > ")[0]
    if (base, attr) in sc.NON_SENSITIVE_OVERRIDE:
        return False
    if (base, attr) in sc.SENSITIVE_TABLE_ATTRS:
        return True
    if attr in sc.SENSITIVE_ATTRS:
        return attr != "certificate" or base.startswith("vpn certificate")
    if base == "system snmp community" and attr == "name":
        return True
    return False


def redact_line(line: str, path: str = "") -> str:
    """Redact one CLI line. ENC blobs and sensitive attribute values are replaced."""
    s = line.strip()
    if not s.startswith("set "):
        return _PEM.sub("<redacted PEM>", line)
    toks, _, _ = tokenize(s)
    if len(toks) >= 2 and (is_sensitive(path, toks[1]) or (len(toks) >= 3 and toks[2] == "ENC") or "-----BEGIN" in line):
        ind = line[: len(line) - len(line.lstrip())]
        return f"{ind}set {toks[1]} <redacted>"
    return line


def redact_lines(lines: list[str], model=None) -> list[str]:
    """Redact a list of physical lines, tracking the current table path for context."""
    out = []
    stack = []
    in_pem = False
    for ln in lines:
        s = ln.strip()
        if in_pem:
            if "-----END" in s or s.endswith('"'):
                in_pem = False
            out.append("<redacted>")
            continue
        if s.startswith("config "):
            stack.append(s[7:].strip())
        elif s == "end" and stack:
            stack.pop()
        path = " > ".join(stack[-2:]) if stack else ""
        base = stack[0] if stack else ""
        r = redact_line(ln, base if base not in ("vdom", "global") else (stack[1] if len(stack) > 1 else ""))
        if r != ln and s.count('"') % 2 == 1:
            in_pem = True  # multi-line quoted secret starts here
        out.append(r)
    return out
