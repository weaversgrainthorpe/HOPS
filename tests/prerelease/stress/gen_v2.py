import json, os, sys
OUT=sys.argv[1]; os.makedirs(OUT, exist_ok=True)
for d in range(20):
    tabs=[]
    for t in range(10):
        groups=[]
        for g in range(20):
            entries=[]
            for e in range(20):
                en={"id":f"v2d{d}t{t}g{g}e{e}","name":f"App {d}.{t}.{g}.{e}","url":f"https://app{d}-{t}-{g}-{e}.example.lan/",
                    "icon":"mdi:server","openMode":"newtab","size":["small","medium","large"][e%3],"order":e,
                    "description":f"Entry {e} of group {g}"}
                if e%5==0: en["statusCheck"]={"type":"http","enabled":True,"interval":30}
                entries.append(en)
            groups.append({"id":f"v2d{d}t{t}g{g}","name":f"Group {g}","order":g,"collapsed":g%4==0,"color":"#3b82f6","opacity":0.95,"entries":entries})
        tabs.append({"id":f"v2d{d}t{t}","name":f"Tab {t}","order":t,"color":"#8b5cf6","opacity":0.95,"groups":groups})
    doc={"dashboards":[{"id":f"v2d{d}","name":f"Legacy {d:02d}","order":d,"path":f"/legacy-{d:02d}","tabs":tabs}],
         "exportType":"single-dashboard","exportedAt":"2026-10-30T00:00:00Z"}
    json.dump(doc,open(f"{OUT}/v2-{d:02d}.json","w"))
print("ok")
