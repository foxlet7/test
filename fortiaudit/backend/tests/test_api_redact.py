import pytest
from fastapi.testclient import TestClient

from fortiaudit import api as API
from fortiaudit.store import Store

H = {"X-FortiAudit": "1"}


@pytest.fixture
def client(tmp_path):
    API.store = Store(str(tmp_path))
    API._cache.clear()
    return TestClient(API.app)


def test_full_flow(client, fixture_text):
    assert client.post("/api/projects", json={"name": "x"}).status_code == 403  # CSRF header required
    assert client.get("/api/projects", headers={"host": "evil.example"}).status_code == 403
    pid = client.post("/api/projects", json={"name": "HQ"}, headers=H).json()["id"]
    r = client.post(f"/api/projects/{pid}/configs", files={"file": ("hq.conf", fixture_text)}, data={"role": "primary"}, headers=H)
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    assert r.json()["identity"]["build"] == "2902"
    for k in ("interfaces", "zones", "addresses", "policies", "routes", "vpn", "nat", "dhcp", "profiles", "topology"):
        assert client.get(f"/api/configs/{cid}/inventory/{k}").status_code == 200
    assert client.get(f"/api/configs/{cid}/object", params={"uid": "system interface|port1"}).json()["impact"]["total"] > 0
    assert client.get(f"/api/configs/{cid}/search", params={"q": "10.10.0.5"}).json()
    chs = client.get(f"/api/configs/{cid}/changes").json()
    target = [c for c in chs if c["auto_eligible"]][0]
    # audit-only mode blocks decisions
    client.post(f"/api/projects/{pid}/settings", json={"mode": "audit"}, headers=H)
    assert client.post(f"/api/configs/{cid}/changes/{target['id']}/decision", json={"status": "approved"}, headers=H).status_code == 403
    client.post(f"/api/projects/{pid}/settings", json={"mode": "assisted"}, headers=H)
    assert client.post(f"/api/configs/{cid}/changes/{target['id']}/decision", json={"status": "approved"}, headers=H).status_code == 200
    assert client.post(f"/api/configs/{cid}/remediate", json={"mode": "auto", "confirm": True}, headers=H).status_code == 403
    rem = client.post(f"/api/configs/{cid}/remediate", json={"mode": "assisted"}, headers=H).json()
    assert rem["validation"]["ok"] and rem["applied"] == [target["id"]]
    new = rem["new_config_id"]
    d = client.get("/api/diff", params={"a": cid, "b": new}).json()
    assert d["counts"] == {"removed": 1}
    # re-import corrected config and the finding is gone
    fs = client.get(f"/api/configs/{new}/findings").json()
    assert target["finding_id"] not in {f["id"] for f in fs}
    for fmt in ("json", "csv", "html", "pdf"):
        rr = client.get(f"/api/configs/{cid}/report.{fmt}")
        assert rr.status_code == 200 and len(rr.content) > 200
        if fmt != "pdf":
            assert "SH2xxxx" not in rr.text and "ENC zzz" not in rr.text and '"public"' not in rr.text
    assert "SH2xxxx" not in client.get(f"/api/configs/{cid}/lines", params={"start": 1, "end": 400}).text
    assert "SH2xxxx" not in client.get(f"/api/configs/{cid}/table", params={"path": "system admin"}).text
    client.post(f"/api/projects/{pid}/settings", json={"mode": "auto"}, headers=H)
    auto = client.post(f"/api/configs/{cid}/remediate", json={"mode": "auto", "confirm": True}, headers=H).json()
    assert auto["validation"]["ok"]
    assert client.delete(f"/api/projects/{pid}", headers=H).status_code == 200
    assert client.get("/api/projects").json() == []
    assert not list((API.store.dir / "backups").iterdir())


def test_rejects_binary_and_non_config(client):
    pid = client.post("/api/projects", json={"name": "x"}, headers=H).json()["id"]
    assert client.post(f"/api/projects/{pid}/configs", files={"file": ("a.bin", b"\x00\x01")}, headers=H).status_code == 400
    assert client.post(f"/api/projects/{pid}/configs", files={"file": ("a.txt", b"hello world")}, headers=H).status_code == 400


def test_redact_lines_pem_and_enc():
    from fortiaudit.redact import redact_lines
    lines = ["config vpn certificate local", '    edit "c"', '        set private-key "-----BEGIN ENCRYPTED PRIVATE KEY-----',
             "MIIabc", '-----END ENCRYPTED PRIVATE KEY-----"', "    next", "end",
             "config system admin", '    edit "a"', "        set password ENC SH2abc", "    next", "end"]
    out = redact_lines(lines)
    assert len(out) == len(lines)
    assert "MIIabc" not in "\n".join(out) and "SH2abc" not in "\n".join(out)
