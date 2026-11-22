"""Global dependency graph. Edge direction: dependent -> dependency (policy -> address)."""
from __future__ import annotations

from dataclasses import dataclass

import networkx as nx

from .model import ConfigModel, Entry

SINGLETON = "_"


@dataclass
class BrokenRef:
    src: str
    attr: str
    value: str
    namespace: str
    line: int
    predefined_unknown: bool = False  # might be a predefined object absent from our knowledge base

    def to_dict(self):
        return self.__dict__.copy()


class Resolver:
    def __init__(self, model: ConfigModel):
        self.m = model
        self.sc = model.schema
        self._idx: dict[str, dict[str, Entry]] = {}
        for ns, tables in self.sc.NAMESPACES.items():
            d: dict[str, Entry] = {}
            for t in tables:
                for e in model.entries(t):
                    d.setdefault(e.key, e)
            self._idx[ns] = d

    def resolve(self, ns: str, name: str):
        """Return Entry, 'predefined', or None."""
        e = self._idx.get(ns, {}).get(name)
        if e is not None:
            return e
        if name in self.sc.PREDEFINED.get(ns, set()):
            return "predefined"
        if ns == "service" and name in self.sc.PREDEFINED_SERVICES:
            return "predefined"
        return None

    def names(self, ns: str) -> dict[str, Entry]:
        return self._idx.get(ns, {})


def node_id(e: Entry) -> str:
    return e.uid


class DepGraph:
    def __init__(self, model: ConfigModel):
        self.m = model
        self.r = Resolver(model)
        self.g = nx.MultiDiGraph()
        self.broken: list[BrokenRef] = []
        self._build()

    def _add_node(self, e: Entry):
        self.g.add_node(e.uid, table=e.path, name=e.key, line=e.node.line, end_line=e.node.end_line)

    def _build(self):
        m, sc = self.m, self.m.schema
        for t in m.all_tables():
            for e in t:
                self._add_node(e)
            if t.attrs and not t.entries:
                self.g.add_node(f"{t.path}|{SINGLETON}", table=t.path, name=SINGLETON, line=t.node.line,
                                end_line=t.node.end_line)
        for path, refs in sc.REFS.items():
            ents = m.entries(path)
            holders = [(e.uid, e.attrs) for e in ents]
            t = m.table(path)
            if t is not None and t.attrs and not t.entries:
                holders.append((f"{t.path}|{SINGLETON}", t.attrs))
            for e in ents:
                if e.uid not in self.g:
                    self._add_node(e)
            for uid, attrs in holders:
                for attr, ns in refs.items():
                    if ns is None or attr not in attrs or attrs[attr].op != "set":
                        continue
                    a = attrs[attr]
                    vals = a.values[::2] if (path, attr) in sc.PAIRED_REFS else a.values
                    for v in vals:
                        tgt = self.r.resolve(ns, v)
                        if tgt is None:
                            self.broken.append(BrokenRef(uid, attr, v, ns, a.line,
                                                         predefined_unknown=ns in ("service", "application-list")))
                        elif tgt != "predefined":
                            self.g.add_edge(uid, tgt.uid, attr=attr, line=a.line)
        # tunnel interface -> phase1 (the interface exists because of the phase1)
        for p1 in m.entries("vpn ipsec phase1-interface"):
            ie = m.entry("system interface", p1.key)
            if ie is not None:
                self.g.add_edge(ie.uid, p1.uid, attr="tunnel-of", line=ie.node.line)

    # ---------- queries ----------
    def find(self, name: str, table: str | None = None) -> list[str]:
        return [n for n, d in self.g.nodes(data=True) if d.get("name") == name and (table is None or d["table"] == table)]

    def direct(self, uid: str) -> dict:
        out = [{"to": v, "attr": d["attr"], "line": d["line"]} for _, v, d in self.g.out_edges(uid, data=True)]
        inn = [{"from": u, "attr": d["attr"], "line": d["line"]} for u, _, d in self.g.in_edges(uid, data=True)]
        return {"depends_on": out, "used_by": inn}

    def dependents(self, uid: str) -> set[str]:
        return nx.ancestors(self.g, uid) if uid in self.g else set()

    def dependencies(self, uid: str) -> set[str]:
        return nx.descendants(self.g, uid) if uid in self.g else set()

    def impact(self, uid: str) -> dict:
        """Everything that may be affected if `uid` changes, grouped by table, with the reference chain."""
        if uid not in self.g:
            return {"object": uid, "found": False}
        deps = self.dependents(uid)
        rev = self.g.reverse(copy=False)
        groups: dict[str, list] = {}
        for d in sorted(deps):
            try:
                path = nx.shortest_path(rev, uid, d)
            except nx.NetworkXNoPath:
                path = [uid, d]
            groups.setdefault(self.g.nodes[d]["table"], []).append(
                {"uid": d, "name": self.g.nodes[d]["name"], "line": self.g.nodes[d]["line"],
                 "via": path, "direct": len(path) == 2})
        return {"object": uid, "found": True, "total": len(deps),
                "direct": sum(1 for v in groups.values() for x in v if x["direct"]),
                "by_table": groups, "dependencies": sorted(self.dependencies(uid))}

    def unreferenced(self, tables: set[str]) -> list[str]:
        return [n for n, d in self.g.nodes(data=True) if d["table"] in tables and self.g.in_degree(n) == 0]

    def cycles(self, tables: set[str]) -> list[list[str]]:
        sub = self.g.subgraph([n for n, d in self.g.nodes(data=True) if d["table"] in tables])
        return [c for c in nx.simple_cycles(nx.DiGraph(sub))]

    def subgraph_json(self, uids: set[str]) -> dict:
        nodes = [{"id": n, **self.g.nodes[n]} for n in uids if n in self.g]
        edges = [{"source": u, "target": v, "attr": d["attr"]} for u, v, d in self.g.edges(data=True)
                 if u in uids and v in uids]
        return {"nodes": nodes, "edges": edges}

    def neighborhood(self, uid: str, depth: int = 2) -> dict:
        if uid not in self.g:
            return {"nodes": [], "edges": []}
        und = self.g.to_undirected(as_view=True)
        seen = set(nx.single_source_shortest_path_length(und, uid, cutoff=depth))
        return self.subgraph_json(seen)

    def stats(self):
        return {"nodes": self.g.number_of_nodes(), "edges": self.g.number_of_edges(), "broken_refs": len(self.broken)}
