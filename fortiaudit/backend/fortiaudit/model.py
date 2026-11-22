"""Typed configuration model built from the lossless AST."""
from __future__ import annotations

from dataclasses import dataclass, field

from . import schema as schema_registry
from .parser import Issue, Node, ParsedConfig, parse


@dataclass
class Attr:
    name: str
    values: list[str]
    quoted: list[bool]
    node: Node
    op: str = "set"  # set | unset | append ...

    @property
    def line(self) -> int:
        return self.node.line


@dataclass
class Entry:
    key: str
    node: Node
    table: "Table"
    attrs: dict[str, Attr] = field(default_factory=dict)
    sub: dict[str, "Table"] = field(default_factory=dict)
    index: int = 0

    @property
    def path(self) -> str:
        return self.table.path

    @property
    def uid(self) -> str:
        return f"{self.table.path}|{self.key}"

    def explicit(self, name: str) -> bool:
        a = self.attrs.get(name)
        return a is not None and a.op == "set"

    def get(self, name: str, default=None) -> list[str] | None:
        a = self.attrs.get(name)
        if a is not None and a.op == "set":
            return a.values
        d = self.table.model.schema.DEFAULTS.get(self.table.base_path, {}).get(name)
        if d is not None:
            return d.split(" ") if " " in d and name in ("ip", "subnet", "dst", "src-subnet", "dst-subnet") else [d]
        return default

    def first(self, name: str, default: str | None = None) -> str | None:
        v = self.get(name)
        return v[0] if v else default

    def text(self, name: str, default: str = "") -> str:
        v = self.get(name)
        return " ".join(v) if v else default

    @property
    def lines(self) -> tuple[int, int]:
        return self.node.line, self.node.end_line


@dataclass
class Table:
    path: str  # e.g. "firewall policy", "system sdwan > zone", "system interface > secondaryip"
    scope: str
    node: Node
    model: "ConfigModel"
    entries: dict[str, Entry] = field(default_factory=dict)
    attrs: dict[str, Attr] = field(default_factory=dict)
    sub: dict[str, "Table"] = field(default_factory=dict)
    owner: Entry | None = None

    @property
    def base_path(self) -> str:
        return self.path

    def get(self, name, default=None):
        a = self.attrs.get(name)
        if a is not None and a.op == "set":
            return a.values
        d = self.model.schema.DEFAULTS.get(self.path, {}).get(name)
        return [d] if d is not None else default

    def first(self, name, default=None):
        v = self.get(name)
        return v[0] if v else default

    def explicit(self, name):
        a = self.attrs.get(name)
        return a is not None and a.op == "set"

    def __bool__(self):
        return True

    def __iter__(self):
        return iter(self.entries.values())

    def __len__(self):
        return len(self.entries)


class ConfigModel:
    def __init__(self, pc: ParsedConfig):
        self.pc = pc
        self.header = pc.header
        self.schema, self.schema_exact = schema_registry.for_version(pc.header.get("version"))
        self.issues: list[Issue] = list(pc.issues)
        self.tables: dict[tuple[str, str], Table] = {}
        self.vdoms: list[str] = []
        self.multi_vdom = False
        self._build()
        self.active = "root" if (not self.vdoms or "root" in self.vdoms) else self.vdoms[0]

    # ---------- construction ----------
    def _build(self):
        for c in self.pc.root.children:
            if c.kind != "config":
                continue
            path = " ".join(c.args)
            if path == "vdom":
                self.multi_vdom = True
                for e in c.children:
                    if e.kind == "edit":
                        name = e.name
                        if name not in self.vdoms:
                            self.vdoms.append(name)
                        for cc in e.children:
                            if cc.kind == "config":
                                self._table(cc, name, None)
            elif path == "global":
                self.multi_vdom = True
                for cc in c.children:
                    if cc.kind == "config":
                        self._table(cc, "global", None)
            else:
                self._table(c, "root", None)

    def _table(self, node: Node, scope: str, owner: Entry | None, prefix: str = "") -> Table:
        path = (prefix + " > " if prefix else "") + " ".join(node.args)
        t = Table(path, scope, node, self, owner=owner)
        key = (scope, path)
        if owner is None:
            if key in self.tables:
                # repeated table: FortiOS merges; keep entries in order but report
                prev = self.tables[key]
                self.issues.append(Issue(node.line, "info", f"table '{path}' appears again (also at line {prev.node.line}); merged"))
                t = prev
            else:
                self.tables[key] = t
        idx = len(t.entries)
        for ch in node.children:
            if ch.kind == "edit":
                e = Entry(ch.name, ch, t, index=idx)
                idx += 1
                self._fill(e.attrs, e.sub, ch, scope, e, path)
                if e.key in t.entries:
                    self.issues.append(Issue(ch.line, "warning", f"duplicate entry {e.key!r} in '{path}' (first at line {t.entries[e.key].node.line}); later definition overrides"))
                    del t.entries[e.key]
                t.entries[e.key] = e
            elif ch.kind == "config":
                st = self._table(ch, scope, owner, path)
                t.sub[" ".join(ch.args)] = st
                if owner is None:
                    self.tables[(scope, st.path)] = st
            else:
                self._leaf(t.attrs, ch)
        return t

    def _fill(self, attrs, sub, node: Node, scope, entry, path):
        for ch in node.children:
            if ch.kind == "config":
                st = self._table(ch, scope, entry, path)
                sub[" ".join(ch.args)] = st
            else:
                self._leaf(attrs, ch)

    @staticmethod
    def _leaf(attrs, ch: Node):
        if ch.kind in ("set", "unset", "append", "select", "unselect") and ch.args:
            name = ch.args[0]
            vals, q = ch.args[1:], ch.quoted[1:]
            if ch.kind in ("append", "select") and name in attrs and attrs[name].op == "set":
                a = attrs[name]
                attrs[name] = Attr(name, a.values + vals, a.quoted + q, ch, "set")
            elif ch.kind == "unselect" and name in attrs:
                a = attrs[name]
                keep = [(v, qq) for v, qq in zip(a.values, a.quoted) if v not in vals]
                attrs[name] = Attr(name, [k[0] for k in keep], [k[1] for k in keep], ch, "set")
            else:
                attrs[name] = Attr(name, vals, q, ch, "set" if ch.kind in ("set", "append", "select") else "unset")

    # ---------- queries ----------
    def table(self, path: str, scope: str | None = None) -> Table | None:
        if scope:
            return self.tables.get((scope, path))
        return self.tables.get((self.active, path)) or self.tables.get(("global", path)) or self.tables.get(("root", path))

    def entries(self, path: str) -> list[Entry]:
        if " > " in path:
            base, rest = path.split(" > ", 1)
            t = self.table(path)
            if t is not None:
                return list(t)
            out = []
            bt = self.table(base)
            if bt:
                for e in bt:
                    st = e.sub.get(rest)
                    if st:
                        out.extend(st)
            return out
        t = self.table(path)
        return list(t) if t else []

    def entry(self, path: str, key: str) -> Entry | None:
        if " > " not in path:
            t = self.table(path)
            return t.entries.get(key) if t is not None else None
        for e in self.entries(path):
            if e.key == key:
                return e
        return None

    def all_tables(self):
        return [t for (s, p), t in self.tables.items() if s in (self.active, "global", "root")]

    @property
    def hostname(self) -> str | None:
        t = self.table("system global")
        return t.first("hostname") if t else None

    def identity(self) -> dict:
        h = self.header
        exp = self.schema.TARGET
        ident = {
            "platform": h.get("platform"), "model": h.get("model"), "version": h.get("version"), "build": h.get("build"),
            "build_date": h.get("builddate"), "hostname": self.hostname, "vdom_mode": "multi" if self.multi_vdom else "single",
            "vdoms": self.vdoms or ["root"], "active_vdom": self.active,
            "schema": self.schema.VERSION, "schema_verified": self.schema.VERIFIED,
        }
        warn = []
        if not h.get("version"):
            warn.append("No #config-version header found: firmware could not be identified from the file.")
        else:
            if h.get("version") != exp["version"]:
                warn.append(f"Firmware {h.get('version')} differs from the authoritative baseline {exp['version']}; "
                            "syntax/default assumptions may not hold.")
            if h.get("build") and h.get("build") != exp["build"]:
                warn.append(f"Build {h.get('build')} differs from baseline build {exp['build']}.")
        if h.get("model") and h.get("model") != exp["model"]:
            warn.append(f"Model {h.get('model')} differs from baseline model {exp['model']}.")
        ident["warnings"] = warn
        ident["baseline_match"] = not warn
        return ident


def iface_type(e: Entry) -> str:
    """FortiOS backups often omit `set type vlan`; a vlanid marks a VLAN sub-interface."""
    if e.explicit("type"):
        return e.first("type")
    return "vlan" if e.explicit("vlanid") else "physical"


def load(text: str) -> ConfigModel:
    return ConfigModel(parse(text))
