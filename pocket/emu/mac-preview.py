#!/usr/bin/env python3
"""Writes emu-preview.json for test builds of the Mac app: each firmware's emu block from an annotated catalog-v2.json,
with the Hub version it was made for. The app uses it only while the published catalogue has no emu blocks, and only
for entries whose Hub version still matches (fm1-pocket-mac: CatalogueV2.withPreview). Drops Pocket's hosted-file
path (the Mac downloads each package from its maker).

    python3 pocket/emu/mac-preview.py ANNOTATED_catalog-v2.json OUT.json [HUB_COPY.json]

Also carries each firmware's discovery dates (release, listed): the catalogue's own, or, for a catalogue built before
discover.mjs had them, from the Hub copy (its `published` and `added`), as discover.mjs takes them.
"""
import json, sys
v2 = json.load(open(sys.argv[1]))
hub = {}
if len(sys.argv) > 3:
    hub = {h["id"]: h for h in json.load(open(sys.argv[3]))["catalog"]["firmwares"]}
out = {"about": "Test-build preview of catalog-v2.json's emu blocks (fm1-pocket-player pocket/emu/mac-preview.py). Ignored once the published catalogue has its own.",
       "made": v2.get("updated"), "engine": (v2.get("runtimes") or {}).get("fm1-emu"), "firmwares": {}}
for e in v2["firmwares"]:
    em = e.get("emu")
    item = {"hubVersion": ((e.get("provenance") or {}).get("hub") or {}).get("version")}
    if em and em.get("package"):
        em = json.loads(json.dumps(em)); em["package"].pop("file", None); em.pop("web", None)
        if em.get("preferred"): em["preferred"].pop("web", None)
        item["emu"] = em
    # the Mac's confidence and known issues, and the listening tests behind them
    if (e.get("confidence") or {}).get("mac"): item["confidence"] = {"mac": e["confidence"]["mac"]}
    if (e.get("knownIssues") or {}).get("mac"): item["knownIssues"] = {"mac": e["knownIssues"]["mac"]}
    if e.get("listened"): item["listened"] = e["listened"]
    h = hub.get(((e.get("provenance") or {}).get("hub") or {}).get("id"))
    rel = e.get("release") or ({"version": h.get("version"), "date": h["published"], "source": "The Firmware Hub"} if h and h.get("published") else None)
    if rel: item["release"] = rel
    listed = e.get("listed") or (h or {}).get("added") or e.get("added")
    if listed: item["listed"] = listed
    if len(item) > 1: out["firmwares"][e["id"]] = item
json.dump(out, open(sys.argv[2], "w"), indent=1, sort_keys=True); open(sys.argv[2], "a").write("\n")
print(f"{len(out['firmwares'])} emu blocks")
