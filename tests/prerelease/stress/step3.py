import sys, json, copy
sys.path.insert(0, '.')
from client import Client

c = Client().login()
STRIP = {"id", "revision", "path", "name", "order"}


def shape(node):
    """Content of a dashboard with ids, revision, path and name removed, for comparing copies."""
    if isinstance(node, dict):
        return {k: shape(v) for k, v in sorted(node.items()) if k not in STRIP}
    if isinstance(node, list):
        return [shape(v) for v in node]
    return node


def big(cfg, did="stress-big"):
    return next(d for d in cfg["dashboards"] if d["id"] == did)


def count(d):
    n = 0
    def walk(ch):
        nonlocal n
        for k in ch:
            n += 1
            if k["kind"] == "folder":
                walk(k["content"]["children"])
    for t in d["tabs"]:
        walk(t["root"]["children"])
    return n


code, cfg, raw, ms, _ = c.req("GET", "/api/config")
d0 = big(cfg)
print(f"GET /api/config: {code}, {len(raw)/1e6:.2f} MB, {ms:.0f} ms; Stress Test has {count(d0)} items, {len(d0['tabs'])} tabs")

# Save: rename one tile deep in the last tab, as the editor would (whole dashboard PUT).
d1 = copy.deepcopy(d0)
d1["tabs"][-1]["root"]["children"][0]["name"] = "Renamed by stress test"
body = {"schema": 3, "layoutVersion": 2, "dashboard": d1, "revision": d0["revision"]}
code, js, raw, ms, _ = c.req("PUT", "/api/dashboards/stress-big", body)
print(f"Save (PUT): {code} in {ms:.0f} ms, {len(json.dumps(body))/1e6:.2f} MB sent -> {js}")
code, js, *_ = c.req("PUT", "/api/dashboards/stress-big", body)
print(f"Save again with the old revision: {code} -> {json.dumps(js)[:200]}")
_, cfg, *_ = c.req("GET", "/api/config")
d2 = big(cfg)
print("Saved change present:", d2["tabs"][-1]["root"]["children"][0]["name"] == "Renamed by stress test",
      "| items still", count(d2))

# Export single and full.
code, ex1, raw1, ms, h = c.req("GET", "/api/config/export?dashboardId=stress-big")
print(f"Export Stress Test: {code}, {len(raw1)/1e6:.2f} MB, {ms:.0f} ms, missing-assets header: {h.get('X-HOPS-Missing-Assets')}")
code, exf, rawf, ms, h = c.req("GET", "/api/config/export")
print(f"Export all: {code}, {len(rawf)/1e6:.2f} MB, {ms:.0f} ms, dashboards: {[x['name'] for x in exf['config']['dashboards']]}")

# Re-import the single export: comes in as a copy; must match the original in content.
code, js, raw, ms, _ = c.upload("/api/config/import", "stress-export.json", raw1)
print(f"Re-import of the export: {code} in {ms:.0f} ms; renamed: {js.get('renamed')}; enlarged: {js.get('foldersEnlarged')}")
_, cfg, *_ = c.req("GET", "/api/config")
copies = [d for d in cfg["dashboards"] if d["name"].startswith("Stress Test")]
print("Dashboards named Stress Test*:", [(d["name"], d["path"], d["id"]) for d in copies])
other = next(d for d in copies if d["id"] != "stress-big")
same = shape(other) == shape(big(cfg))
print("Re-imported copy identical in content (ids/names aside):", same)
if not same:
    a, b = json.dumps(shape(big(cfg)), sort_keys=True), json.dumps(shape(other), sort_keys=True)
    i = next(i for i in range(min(len(a), len(b))) if a[i] != b[i])
    print("  first difference:", a[max(0, i-150):i+150], "\n  vs:", b[max(0, i-150):i+150])

# Reports that walk every tile.
for p in ["/api/dead-links", "/api/icons/usage"]:
    code, js, raw, ms, _ = c.req("GET", p)
    print(f"GET {p}: {code}, {len(raw)/1e3:.0f} kB, {ms:.0f} ms")

# Backup, download, restore.
code, js, raw, ms, _ = c.req("POST", "/api/backups", {"reason": "stress"})
name = (js or {}).get("name") or (js or {}).get("backup", {}).get("name")
print(f"Create backup: {code} in {ms:.0f} ms -> {json.dumps(js)[:200]}")
code, js, raw, ms, _ = c.req("GET", "/api/backups")
lst = js if isinstance(js, list) else (js or {}).get("backups", [])
print(f"List backups: {code}, {len(lst)} backups, {ms:.0f} ms")
if not name and lst:
    name = sorted(lst, key=lambda b: b.get("created", b.get("name", "")))[-1]["name"]
code, js, raw, ms, h = c.req("GET", "/api/backups/" + name)
print(f"Download backup {name}: {code}, {len(raw)/1e6:.2f} MB, {ms:.0f} ms")
before = shape(big(c.req('GET', '/api/config')[1]))
code, js, raw, ms, _ = c.req("POST", "/api/backups/" + name)
print(f"Restore backup: {code} in {ms:.0f} ms -> {json.dumps(js)[:300]}")
