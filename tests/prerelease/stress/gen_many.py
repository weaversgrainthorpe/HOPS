#!/usr/bin/env python3
"""100 dashboards x 1000 items (10 tabs x 4 folders x 24 tiles + 40 folders), one file each."""
import json, os, sys

OUT, N = sys.argv[1], int(sys.argv[2])
SIZES, SPAN = ["small", "medium", "large"], {"small": 1, "medium": 2, "large": 4}
os.makedirs(OUT, exist_ok=True)

for d in range(N):
    n = 0
    def nid(k):
        global n
        n += 1
        return f"m{d}-{k}{n}"
    tabs = []
    for t in range(10):
        kids, y = [], 0
        for f in range(4):
            tiles = []
            for i in range(24):
                s = SIZES[i % 3]
                tiles.append({"id": nid("t"), "kind": "tile", "type": "link", "name": f"Service {d}-{t}-{f}-{i}",
                              "url": f"https://svc{d}-{t}-{f}-{i}.example.lan/", "icon": "mdi:server",
                              "openMode": "newtab", "size": s, "order": i})
            kids.append({"id": nid("f"), "kind": "folder", "name": f"Folder {t}.{f}", "display": "expanded",
                         "shape": "rounded", "showTitle": True, "size": "medium", "contentSize": "medium",
                         "placement": {"x": 0, "y": y, "w": 24, "h": 20}, "content": {"children": tiles}, "order": f})
            y += 20
        tabs.append({"id": nid("tab"), "name": f"Tab {t}", "order": t, "root": {"columns": 24, "children": kids}})
    dash = {"id": f"many-{d}", "name": f"Many {d:03d}", "order": d, "path": f"/many-{d:03d}", "revision": 1,
            "settings": {"statusChecksEnabled": None, "statusCheckIntervalMinutes": None, "statusCheckTimeoutSeconds": None,
                         "editIdleTimeoutMinutes": None, "animatedFolderBackgrounds": None},
            "background": {"type": "color", "value": "#1e293b", "images": [], "interval": 0, "fit": "cover",
                           "transition": "fade", "transitionDuration": 0, "overlayOpacity": 0, "overlayBlur": 0, "opacity": 1},
            "tabs": tabs}
    doc = {"format": "hops-export", "schemaVersion": 3, "exportedAt": "2026-10-30T00:00:00Z",
           "exportType": "single-dashboard", "config": {"layoutVersion": 2, "dashboards": [dash]}}
    with open(os.path.join(OUT, f"many-{d:03d}.json"), "w") as f:
        json.dump(doc, f)
print(N, "files,", sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT)) / 1e6, "MB total")
