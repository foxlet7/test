"""Local SQLite project store. Original configurations are kept immutable (backup) with sha256."""
from __future__ import annotations

import datetime as dt
import hashlib
import os
import sqlite3
import threading
import uuid
from pathlib import Path

SCHEMA = """
create table if not exists projects(id text primary key, name text, created_at text, mode text default 'assisted',
                                    vdom text default '');
create table if not exists configs(id text primary key, project_id text, role text, filename text, sha256 text,
                                   imported_at text, text blob, parent_id text, note text);
create table if not exists decisions(config_id text, change_id text, status text, at text, title text,
                                     primary key(config_id, change_id));
create table if not exists changelog(id integer primary key autoincrement, project_id text, config_id text, at text,
                                     event text, detail text);
"""


def now():
    return dt.datetime.now().isoformat(timespec="seconds")


class Store:
    def __init__(self, data_dir: str | None = None):
        self.dir = Path(data_dir or os.environ.get("FORTIAUDIT_DATA") or Path.home() / ".fortiaudit")
        self.dir.mkdir(parents=True, exist_ok=True)
        os.chmod(self.dir, 0o700)
        (self.dir / "backups").mkdir(exist_ok=True)
        os.chmod(self.dir / "backups", 0o700)
        self.path = self.dir / "fortiaudit.db"
        self._lock = threading.Lock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        os.chmod(self.path, 0o600)

    def _q(self, sql, args=()):
        with self._lock:
            cur = self.db.execute(sql, args)
            self.db.commit()
            return cur.fetchall()

    def create_project(self, name):
        pid = uuid.uuid4().hex[:12]
        self._q("insert into projects(id,name,created_at) values(?,?,?)", (pid, name, now()))
        self.log(pid, None, "project-created", name)
        return pid

    def projects(self):
        out = []
        for p in self._q("select * from projects order by created_at desc"):
            d = dict(p)
            d["configs"] = [dict(c) for c in self._q(
                "select id,role,filename,sha256,imported_at,parent_id,note from configs where project_id=? order by imported_at",
                (p["id"],))]
            out.append(d)
        return out

    def project(self, pid):
        r = self._q("select * from projects where id=?", (pid,))
        return dict(r[0]) if r else None

    def set_mode(self, pid, mode):
        self._q("update projects set mode=? where id=?", (mode, pid))
        self.log(pid, None, "mode-changed", mode)

    def set_vdom(self, pid, vdom):
        self._q("update projects set vdom=? where id=?", (vdom, pid))

    def add_config(self, pid, role, filename, text: str, parent_id=None, note=""):
        cid = uuid.uuid4().hex[:12]
        sha = hashlib.sha256(text.encode("utf-8", "surrogateescape")).hexdigest()
        self._q("insert into configs values(?,?,?,?,?,?,?,?,?)", (cid, pid, role, filename, sha, now(), text, parent_id, note))
        bp = self.dir / "backups" / f"{sha}.conf"
        if not bp.exists():
            fd = os.open(bp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8", errors="surrogateescape") as fh:
                fh.write(text)
        self.log(pid, cid, "config-imported", f"{role} {filename} sha256={sha}")
        return cid

    def config(self, cid):
        r = self._q("select * from configs where id=?", (cid,))
        return dict(r[0]) if r else None

    def delete_project(self, pid):
        shas = [r["sha256"] for r in self._q("select sha256 from configs where project_id=?", (pid,))]
        cids = [r["id"] for r in self._q("select id from configs where project_id=?", (pid,))]
        for c in cids:
            self._q("delete from decisions where config_id=?", (c,))
        self._q("delete from configs where project_id=?", (pid,))
        self._q("delete from changelog where project_id=?", (pid,))
        self._q("delete from projects where id=?", (pid,))
        for s in shas:
            if not self._q("select 1 from configs where sha256=?", (s,)):
                p = self.dir / "backups" / f"{s}.conf"
                if p.exists():
                    p.unlink()
        with self._lock:
            self.db.execute("vacuum")

    def decide(self, cid, change_id, status, title):
        self._q("insert or replace into decisions values(?,?,?,?,?)", (cid, change_id, status, now(), title))
        c = self.config(cid)
        self.log(c["project_id"], cid, f"change-{status}", f"{change_id} {title}")

    def decisions(self, cid):
        return {r["change_id"]: dict(r) for r in self._q("select * from decisions where config_id=?", (cid,))}

    def log(self, pid, cid, event, detail):
        self._q("insert into changelog(project_id,config_id,at,event,detail) values(?,?,?,?,?)", (pid, cid, now(), event, detail))

    def changelog(self, pid):
        return [dict(r) for r in self._q("select * from changelog where project_id=? order by id", (pid,))]
