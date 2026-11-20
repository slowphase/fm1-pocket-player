#!/usr/bin/env python3
"""Writes emu-preview.json for test builds of the Mac app: each firmware's emu block from an annotated catalog-v2.json,
with the Hub version it was made for. The app uses it only while the published catalogue has no emu blocks, and only
for entries whose Hub version still matches (fm1-pocket-mac: CatalogueV2.withPreview). Drops Pocket's hosted-file
path (the Mac downloads each package from its maker).

    python3 pocket/emu/mac-preview.py ANNOTATED_catalog-v2.json OUT.json
"""
import json, sys
v2 = json.load(open(sys.argv[1]))
out = {"about": "Test-build preview of catalog-v2.json's emu blocks (fm1-pocket-player pocket/emu/mac-preview.py). Ignored once the published catalogue has its own.",
       "made": v2.get("updated"), "engine": (v2.get("runtimes") or {}).get("fm1-emu"), "firmwares": {}}
for e in v2["firmwares"]:
    em = e.get("emu")
    if not em or not em.get("package"): continue
    em = json.loads(json.dumps(em)); em["package"].pop("file", None); em.pop("web", None)
    if em.get("preferred"): em["preferred"].pop("web", None)
    out["firmwares"][e["id"]] = {"hubVersion": ((e.get("provenance") or {}).get("hub") or {}).get("version"), "emu": em}
json.dump(out, open(sys.argv[2], "w"), indent=1, sort_keys=True); open(sys.argv[2], "a").write("\n")
print(f"{len(out['firmwares'])} emu blocks")
