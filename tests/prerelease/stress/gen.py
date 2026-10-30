#!/usr/bin/env python3
"""Generate HOPS v3 stress-test export files (synthetic data only).

Limits (backend/internal/configdoc/verify.go): 5000 items per dashboard,
folders nested 12 deep (a root child is depth 1), 200 tabs.
"""
import json, random, sys, os

random.seed(3000)
OUT = sys.argv[1]
SHAPES = ["rounded", "simple-tab", "folder-flat", "folder-paper", "folder-outline", "folder-cartoon", "folder-open"]
TABPOS = ["left", "centre", "right"]
SIZES = ["small", "medium", "large"]
SPAN = {"small": 1, "medium": 2, "large": 4}
ICONS = ["mdi:server", "mdi:lan", "mdi:router-wireless", "mdi:nas", "mdi:docker", "mdi:home-assistant",
         "mdi:television", "mdi:printer", "mdi:camera", "mdi:music", "mdi:movie", "mdi:database",
         "mdi:shield", "mdi:chart-line", "mdi:cloud", "mdi:git", "mdi:email", "mdi:calendar"]
NAMES = ["Router", "NAS", "Proxmox", "Grafana", "Jellyfin", "Pi-hole", "Home Assistant", "Printer",
         "Camera", "Switch", "Backups", "Wiki", "Git", "Mail", "Calendar", "Photos", "Music", "Notes"]
ODD = ["Ünïcödé café ☕", "日本語のタイル", "עברית מימין לשמאל", "Emoji 🚀🔥🏠", "Tab\tand  spaces",
       "<b>not bold</b> & \"quotes\"", "A" * 120]

class Gen:
    def __init__(self, prefix):
        self.p, self.n, self.items, self.checks = prefix, 0, 0, 0
    def nid(self, kind):
        self.n += 1
        return f"{self.p}-{kind}{self.n}"
    def tile(self, order, x, y, i, checks=False):
        self.items += 1
        size = SIZES[i % 3]
        name = ODD[i % len(ODD)] if i % 23 == 0 else f"{NAMES[i % len(NAMES)]} {i}"
        host = f"svc{i}.example.lan"
        t = {"id": self.nid("t"), "kind": "tile", "type": "note" if i % 41 == 0 else "link",
             "name": name, "url": "" if i % 41 == 0 else f"https://{host}:{8000 + i % 1000}/",
             "icon": ICONS[i % len(ICONS)], "openMode": "newtab", "size": size, "order": order,
             "placement": {"x": x, "y": y, "w": SPAN[size], "h": SPAN[size]}}
        if i % 41 == 0:
            t["description"] = ("Long note text. " * 40).strip()
        elif i % 3 == 0:
            t["description"] = f"Subtitle for {name}"
        if i % 5 == 0 and t["url"]:
            t["awayUrl"] = f"https://{host.split('.')[0]}.away.example.org/"
        if checks and t["url"] and i % 4 == 0:
            # Documentation addresses (RFC 5737): never reachable, so checks time out.
            self.checks += 1
            t["url"] = f"http://192.0.2.{i % 250 + 1}:{80 + i % 5}/"
            t["statusCheck"] = {"type": "http", "enabled": True, "interval": 60}
        return t
    def grid(self, n, start, checks=False, cols=6):
        """n tiles, one per 4x4 slot, cols slots per row; returns (children, grid rows used)."""
        out = []
        for k in range(n):
            out.append(self.tile(k, (k % cols) * 4, (k // cols) * 4, start + k, checks))
        return out, ((n + cols - 1) // cols) * 4
    def folder(self, order, y, i, children, h_inner, w=24, display="expanded"):
        self.items += 1
        for ch in children:  # folder contents are an ordered list: no grid positions
            ch.pop("placement", None)
        f = {"id": self.nid("f"), "kind": "folder",
             "name": ODD[i % len(ODD)] if i % 9 == 0 else f"Folder {i}",
             "display": display, "shape": SHAPES[i % len(SHAPES)], "showTitle": True,
             "size": SIZES[i % 3], "contentSize": SIZES[(i + 1) % 3],
             "placement": {"x": 0, "y": y, "w": w, "h": h_inner + 3},
             "content": {"children": children}, "order": order}
        if f["shape"] != "rounded":
            f["tabPosition"] = TABPOS[i % 3]
        return f

def dashboard(did, name, path, tabs):
    return {"id": did, "name": name, "order": 0, "path": path, "revision": 1,
            "settings": {"statusChecksEnabled": None, "statusCheckIntervalMinutes": None,
                         "statusCheckTimeoutSeconds": None, "editIdleTimeoutMinutes": None,
                         "animatedFolderBackgrounds": None},
            "background": {"type": "image", "value": "/presets/dark-gradient.jpg", "images": [], "interval": 0,
                           "fit": "cover", "transition": "fade", "transitionDuration": 0,
                           "overlayOpacity": 0.3, "overlayBlur": 0, "opacity": 1},
            "tabs": tabs}

def tab(g, order, name, children):
    return {"id": g.nid("tab"), "name": name, "order": order, "root": {"columns": 24, "children": children}}

def deep_chain(g, depth, start, y=0, order=0):
    """A folder chain `depth` levels deep (root child = level 1), 3 tiles at each level."""
    def level(d):
        tiles, rows = g.grid(3, start + d * 10, cols=3)
        kids = list(tiles)
        h = rows
        if d < depth:
            sub = level(d + 1)
            sub["placement"]["y"] = rows
            sub["order"] = len(kids)
            kids.append(sub)
            h += sub["placement"]["h"]
        return g.folder(0, 0, start + d, kids, h, w=24)
    top = level(1)
    top["placement"]["y"], top["order"] = y, order
    return top

def big(target_items):
    """Many tabs of tiles and folders, one deep chain, status checks on a share of tiles."""
    g = Gen("big")
    tabs, i = [], 0
    deep = deep_chain(g, 11, 90000)
    tabs.append(tab(g, 0, "Deep (12 levels incl. tiles)", [deep]))
    t = 1
    while g.items + 24 + 26 <= target_items:
        kids, y = [], 0
        loose, rows = g.grid(24, i, checks=True)
        i += 24
        kids += loose
        y += rows
        for fo in range(4):
            if g.items + 26 > target_items:
                break
            inner, irows = g.grid(18, i, checks=True)
            i += 18
            # a folder inside the folder
            sub_tiles, srows = g.grid(6, i, checks=True)
            i += 6
            sub = g.folder(len(inner), irows, i, sub_tiles, srows, display="collapsed" if fo % 2 else "expanded")
            f = g.folder(len(kids), y, i + fo, inner + [sub], irows + sub["placement"]["h"])
            kids.append(f)
            y += f["placement"]["h"]
        tabs.append(tab(g, t, f"Tab {t} " + ("🚀" if t % 7 == 0 else ""), kids))
        t += 1
    # top up exactly to the target with loose tiles on the last tab
    last = tabs[-1]["root"]["children"]
    ymax = max(c["placement"]["y"] + c["placement"]["h"] for c in last)
    k = 0
    while g.items < target_items:
        last.append(g.tile(len(last), (k % 6) * 4, ymax + (k // 6) * 4, 80000 + k))
        k += 1
    return g, dashboard("stress-big", "Stress Test", "/stress-test", tabs)

def many_tabs(n):
    g = Gen("tabs")
    tabs = []
    for t in range(n):
        kids, _ = g.grid(3, t * 3)
        tabs.append(tab(g, t, f"T{t}" if t % 10 else f"Tab number {t} with a longer name", kids))
    return g, dashboard("stress-tabs", "Stress Tabs", "/stress-tabs", tabs)

def deep(depth):
    g = Gen("deep")
    return g, dashboard("stress-deep", "Stress Deep", "/stress-deep", [tab(g, 0, "Deep", [deep_chain(g, depth, 0)])])

def write(name, *dashes):
    single = len(dashes) == 1
    doc = {"format": "hops-export", "schemaVersion": 3, "exportedAt": "2026-10-30T00:00:00Z",
           "exportType": "single-dashboard" if single else "full",
           "config": {"layoutVersion": 2, "dashboards": [d for _, d in dashes]}}
    path = os.path.join(OUT, name)
    with open(path, "w") as f:
        json.dump(doc, f, ensure_ascii=False)
    for g, d in dashes:
        print(f"{name}: {d['name']}: {g.items} items, {len(d['tabs'])} tabs, {g.checks} status checks, "
              f"{os.path.getsize(path)/1e6:.2f} MB")

os.makedirs(OUT, exist_ok=True)
write("ok-big.json", big(4990))
write("ok-tabs.json", many_tabs(200))
write("ok-deep.json", deep(11))
write("over-items.json", big(5001))
write("over-tabs.json", many_tabs(201))
write("over-deep.json", deep(12))
