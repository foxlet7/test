"""Native FortiOS CLI configuration parser.

Produces a lossless AST. Nothing in the input is dropped: unknown lines become
``raw`` nodes and are reported as parse issues. ``serialize(parse(text))`` returns
``text`` unchanged when the tree has not been modified.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

LEAF_CMDS = {"set", "unset", "append", "select", "unselect", "delete", "rename", "move", "clear", "purge"}
_NEEDS_QUOTE = re.compile(r'[\s"\'\\#]|^$')


@dataclass
class Issue:
    line: int
    severity: str  # error | warning | info
    message: str

    def to_dict(self):
        return {"line": self.line, "severity": self.severity, "message": self.message}


@dataclass
class Node:
    kind: str  # root | config | edit | set | unset | ... | comment | blank | raw
    args: list[str] = field(default_factory=list)
    quoted: list[bool] = field(default_factory=list)
    line: int = 0  # first physical line (1-based)
    end_line: int = 0  # last physical line incl. closer for blocks
    raw: str = ""  # original text of the opening/leaf logical line (may contain \n)
    closer: str | None = None  # raw text of `next`/`end`; None if missing in source
    closer_line: int = 0
    children: list["Node"] = field(default_factory=list)
    parent: "Node | None" = field(default=None, repr=False)
    dirty: bool = False  # regenerate text instead of emitting raw

    @property
    def is_block(self) -> bool:
        return self.kind in ("config", "edit", "root")

    @property
    def name(self) -> str:
        return " ".join(self.args)

    def indent(self) -> str:
        m = re.match(r"[ \t]*", self.raw)
        return m.group(0) if m else ""

    def walk(self):
        yield self
        for c in self.children:
            yield from c.walk()


@dataclass
class ParsedConfig:
    root: Node
    lines: list[str]
    issues: list[Issue]
    header: dict
    eol: str = "\n"
    trailing_newline: bool = True

    @property
    def text(self) -> str:
        t = self.eol.join(self.lines)
        return t + (self.eol if self.trailing_newline else "")


def tokenize(s: str) -> tuple[list[str], list[bool], bool]:
    """Split one logical CLI line into tokens. Returns (tokens, quoted_flags, complete)."""
    toks: list[str] = []
    q: list[bool] = []
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c in " \t\r\n":
            i += 1
            continue
        if c in "\"'":
            quote = c
            i += 1
            buf = []
            closed = False
            while i < n:
                ch = s[i]
                if ch == "\\" and i + 1 < n and s[i + 1] in "\"'\\":
                    buf.append(s[i + 1])
                    i += 2
                    continue
                if ch == quote:
                    closed = True
                    break
                buf.append(ch)
                i += 1
            if not closed:
                return toks, q, False
            i += 1
            toks.append("".join(buf))
            q.append(True)
        else:
            j = i
            while j < n and s[j] not in " \t\r\n":
                j += 1
            toks.append(s[i:j])
            q.append(False)
            i = j
    return toks, q, True


def quote_value(v: str, force: bool = False) -> str:
    if force or _NEEDS_QUOTE.search(v):
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return v


HEADER_RE = re.compile(
    r"#config-version=(?P<platform>[A-Za-z0-9_]+)-(?P<version>\d+\.\d+\.\d+)-FW-build(?P<build>\d+)-(?P<builddate>\d+)"
    r"(?::opmode=(?P<opmode>\d+))?(?::vdom=(?P<vdom>\d+))?(?::user=(?P<user>[^:\s]+))?"
)


def parse_header(lines: list[str]) -> dict:
    hdr: dict = {}
    for ln in lines[:20]:
        s = ln.strip()
        if not s.startswith("#"):
            if s:
                break
            continue
        m = HEADER_RE.match(s)
        if m:
            hdr.update({k: v for k, v in m.groupdict().items() if v is not None})
            plat = hdr.get("platform", "")
            # FG121G / FGT121G -> 121G
            mm = re.match(r"(?:FGT|FG|FGVM|FWF)?(?P<m>[0-9A-Z]+)", plat)
            hdr["model"] = mm.group("m") if mm else plat
        elif "=" in s:
            for part in s[1:].split(":"):
                if "=" in part:
                    k, v = part.split("=", 1)
                    hdr.setdefault(k.strip(), v.strip())
    return hdr


def parse(text: str) -> ParsedConfig:
    if "\x00" in text:
        raise ValueError("binary content (NUL byte) - not a FortiOS text configuration")
    eol = "\r\n" if "\r\n" in text else "\n"
    body = text.replace("\r\n", "\n")
    trailing = body.endswith("\n")
    lines = body.split("\n")
    if trailing:
        lines = lines[:-1]
    issues: list[Issue] = []
    root = Node("root", line=1)
    stack: list[Node] = [root]
    i = 0
    n = len(lines)
    while i < n:
        start = i
        raw = lines[i]
        s = raw.strip()
        if not s:
            _add(stack[-1], Node("blank", raw=raw, line=i + 1, end_line=i + 1))
            i += 1
            continue
        if s.startswith("#"):
            _add(stack[-1], Node("comment", raw=raw, line=i + 1, end_line=i + 1))
            i += 1
            continue
        logical = raw
        toks, q, ok = tokenize(s)
        while not ok and i + 1 < n:
            i += 1
            logical += "\n" + lines[i]
            toks, q, ok = tokenize(logical.strip())
        if not ok:
            issues.append(Issue(start + 1, "error", "unterminated quoted string; consumed to end of file"))
        top = stack[-1]
        cmd = toks[0].lower() if toks else ""
        ln = start + 1
        endl = i + 1
        if cmd == "config":
            node = Node("config", toks[1:], q[1:], ln, endl, logical)
            if len(toks) < 2:
                issues.append(Issue(ln, "error", "'config' without table path"))
            if top.kind == "config":
                # a config directly inside a config (no edit) is legal for nested singleton tables
                pass
            _add(top, node)
            stack.append(node)
        elif cmd == "edit":
            node = Node("edit", toks[1:], q[1:], ln, endl, logical)
            if top.kind != "config":
                issues.append(Issue(ln, "error", "'edit' outside of a config block"))
                node.kind = "raw"
                _add(top, node)
            else:
                if len(toks) < 2:
                    issues.append(Issue(ln, "error", "'edit' without entry name"))
                _add(top, node)
                stack.append(node)
        elif cmd == "next":
            if top.kind == "edit":
                top.closer, top.closer_line, top.end_line = logical, ln, endl
                stack.pop()
            else:
                issues.append(Issue(ln, "error", "'next' without matching 'edit'"))
                _add(top, Node("raw", toks, q, ln, endl, logical))
        elif cmd == "end":
            while stack[-1].kind == "edit":
                e = stack.pop()
                e.end_line = ln - 1
                issues.append(Issue(e.line, "error", f"edit {e.name!r} not closed with 'next' before 'end' (line {ln})"))
            if stack[-1].kind == "config":
                c = stack.pop()
                c.closer, c.closer_line, c.end_line = logical, ln, endl
            else:
                issues.append(Issue(ln, "error", "'end' without matching 'config'"))
                _add(stack[-1], Node("raw", toks, q, ln, endl, logical))
        elif cmd in LEAF_CMDS:
            if top.kind == "root":
                issues.append(Issue(ln, "warning", f"'{cmd}' at top level (outside any config block)"))
            _add(top, Node(cmd, toks[1:], q[1:], ln, endl, logical))
        else:
            issues.append(Issue(ln, "warning", f"unrecognised command {toks[0]!r}; preserved verbatim, not analysed"))
            _add(top, Node("raw", toks, q, ln, endl, logical))
        i += 1
    while len(stack) > 1:
        b = stack.pop()
        b.end_line = n
        issues.append(Issue(b.line, "error", f"{b.kind} {b.name!r} not closed before end of file"))
    root.end_line = n
    return ParsedConfig(root, lines, issues, parse_header(lines), eol, trailing)


def _add(parent: Node, child: Node):
    child.parent = parent
    parent.children.append(child)


def render_node_lines(node: Node, base_indent: str | None = None) -> list[str]:
    """Render a node (and subtree) as text lines. Unmodified nodes emit original raw text."""
    out: list[str] = []
    ind = node.indent() if base_indent is None else base_indent
    if node.kind == "root":
        for c in node.children:
            out.extend(render_node_lines(c))
        return out
    if node.dirty or not node.raw:
        head = node.kind if node.kind != "raw" else ""
        parts = ([head] if head else []) + [
            quote_value(a, node.quoted[k] if k < len(node.quoted) else False) for k, a in enumerate(node.args)
        ]
        out.extend((ind + " ".join(parts)).split("\n"))
    else:
        out.extend(node.raw.split("\n"))
    if node.is_block:
        for c in node.children:
            out.extend(render_node_lines(c))
        if node.closer is not None:
            out.extend(node.closer.split("\n"))
        else:
            out.append(ind + ("next" if node.kind == "edit" else "end"))
    return out


def serialize(pc: ParsedConfig) -> str:
    lines = render_node_lines(pc.root)
    t = pc.eol.join(lines)
    return t + (pc.eol if pc.trailing_newline else "")
