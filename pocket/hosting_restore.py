#!/usr/bin/env python3
"""Restore only previously accepted, still-published originals into a local store.
Keeps existing web downloads available while newer bytes await hosting clearance.
No release writes, Hub reads, source execution or playback qualification.
"""
import argparse
from pathlib import Path
import urllib.request
import re
from hosting_guard import load, sha, original_allowed, safe_name


def restore(previous, store, approvals, holds, base):
    store = Path(store); store.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in previous["firmwares"]:
        p = (f.get("emu") or {}).get("package") or {}
        if not p.get("file") or not original_allowed(f["id"],p.get("sha256"),p.get("source"),approvals,holds): continue
        record = approvals[f["id"]]
        if p["file"] != record["file"]: raise ValueError("Accepted package path changed: " + f["id"])
        name = Path(safe_name(p["file"])).name
        target = store/name
        if not (target.is_file() and sha(target.read_bytes()) == p["sha256"]):
            with urllib.request.urlopen(base.rstrip("/")+"/"+p["file"],timeout=60) as response: data = response.read()
            if sha(data) != p["sha256"]: raise ValueError("Last-accepted package mismatch: " + f["id"])
            target.write_bytes(data); n += 1
        image=f.get("image") or ""
        hub=f.get("provenance",{}).get("hub",{}).get("id") or f["id"]
        if f.get("imageKind")=="emulator screen" and image==f"shots/{hub}-emu-{p['sha256'][:8]}.png":
            shot=store/f"shot-{hub}-{p['sha256'][:8]}.png"
            if not shot.exists():
                with urllib.request.urlopen(base.rstrip("/")+"/"+image,timeout=60) as response: picture=response.read()
                if not picture.startswith(b"\x89PNG\r\n\x1a\n"): raise ValueError("Invalid accepted screenshot: "+f["id"])
                shot.write_bytes(picture)
    print(f"Restored {n} accepted originals; no new hosting grants.")


if __name__ == "__main__":
    root=Path(__file__).resolve().parent
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--previous",required=True);p.add_argument("--store",required=True)
    p.add_argument("--base",default="https://slowphase.github.io/fm1-pocket-player/data/")
    a=p.parse_args()
    restore(load(a.previous),a.store,load(root/"hosting-approved.json")["packages"],load(root/"hosting-holds.json"),a.base)
