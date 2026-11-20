#!/usr/bin/env python3
"""Pipeline prototype (evaluation, nothing published): what catalog-v2.json would carry if the emulator became an
engine. Adds an "emu" block to each entry, which v2 clients that do not know it ignore, and writes a separate preview
file; catalog.json (v1) and catalog-v2.json are not touched.

    python3 pocket/emu/annotate.py --v2 catalog-v2.json --packages packages.json --native-linux A.json[,B.json]
        --native-mac A.json,... [--native-intel ...] [--wasm A.json,...] [--policy pocket/policy.json] --out preview.json

Per entry:
  emu.package   the original package as the maker released it (url, sha256 = the Hub's, size, version), or why not
  emu.redistribute  whether Pocket may serve its own verified copy (the web player cannot fetch makers' GitHub
                assets: no CORS), by the same licence rule as the .rfm1 builds (pocket/validate.mjs licenceOk)
  emu.web / emu.mac  state (playable / experimental / unavailable), why, and the measured run: speed, where
                sound came from, the machine, the engine commit, the package's SHA-256
States: playable = the package makes sound in the scripted session (or is silent by a documented exception) and
runs at 1.2x real time or more on that player's measuring machine; experimental = slower than that, or silent
without an explanation; unavailable = no package Pocket can get to that player.
"""
import json, re, sys

args = sys.argv[1:]
def opt(k, d=None):
    if k in args:
        i = args.index(k); v = args[i + 1]; del args[i:i + 2]; return v
    return d
SLOW = 1.2
OPEN = re.compile(r"^(GPL-[23]\.0(-only|-or-later)?|LGPL-[23]\.[01](-only|-or-later)?|AGPL-3\.0(-only|-or-later)?|MPL-2\.0|MIT|"
                  r"BSD-[23]-Clause|Apache-2\.0|ISC|Zlib|CC0-1\.0|0BSD|OFL-1\.1|Unlicense|FTL)$")
def licence_ok(spdx):
    parts = [p.strip() for p in re.split(r"\s+(?:AND|OR)\s+|[()]", spdx or "") if p.strip()]
    return bool(parts) and all(OPEN.match(p) for p in parts)

def rows(paths, inner=None):
    out, host = {}, None
    for p in [p for p in (paths or "").split(",") if p]:
        d = json.load(open(p))
        if isinstance(d, list):
            for r in d: out[r["id"]] = r.get("wasm", r)
        else:
            host = d.get("host"); [out.__setitem__(r["id"], r) for r in d["firmwares"]]
    return out, host

v2 = json.load(open(opt("--v2")))
pk = {r["hub"]: r for r in json.load(open(opt("--packages")))["firmwares"]}
lin, lin_host = rows(opt("--native-linux"))
mac, mac_host = rows(opt("--native-mac"))
intel, intel_host = rows(opt("--native-intel"))
wasm, _ = rows(opt("--wasm"))
policy = json.load(open(opt("--policy", "pocket/policy.json")))
exceptions = policy.get("smokeExceptions", {})
COMMIT = json.load(open("pocket/emu/upstream.json"))["commit"]

def judge(run, speed_key, where, entry_id, hub):
    if not run: return {"state": "experimental", "reason": f"Not yet run on {where}."}
    rms = run.get("rms") or {}
    loud = [k for k, v in rms.items() if v and v > 0.0002] if rms else None
    speed = run.get(speed_key, run.get("speed", run.get("realtime")))
    rec = {"speed": speed, "machine": where, "engine": f"fm1-emu@{COMMIT[:12]}", "sha256": run.get("sha256")}
    if loud is not None: rec["soundFrom"] = loud
    if run.get("exit", 0) != 0: return {"state": "unsupported", "reason": f"The emulated FM-1 stopped on {where}.", "tested": rec}
    if loud == [] and entry_id not in exceptions and hub not in exceptions:
        return {"state": "experimental", "reason": "Ran, but made no sound in the scripted session (keys, MIDI, PLAY).", "tested": rec}
    if speed is not None and speed < SLOW:
        return {"state": "experimental", "performance": "may-stutter", "reason": f"Ran at {speed}x real time on {where}: it may stutter.", "tested": rec}
    return {"state": "playable", "reason": f"Played the scripted session on {where} at {speed}x real time.", "tested": rec}

counts = {"web": {}, "mac": {}, "packages": {}}
for e in v2["firmwares"]:
    hub = ((e.get("provenance") or {}).get("hub") or {}).get("id") or (e["id"] if e["id"] in pk else None)
    p = pk.get(hub) if hub else None
    em = {}
    if not p:
        em["package"] = None; em["why"] = "Not on The Firmware Hub: no original package known."
    elif p["status"] != "found":
        em["package"] = None; em["why"] = f"The maker's package could not be fetched automatically ({p['status']}): local import only."
    else:
        em["package"] = {"url": p["url"], "sha256": p["sha256"], "size": p.get("hubSize"), "version": p.get("version"), "asset": p.get("asset"), "source": "maker release"}
    # Pocket serves its own copy only where it would publish the firmware at all: an open licence, and not excluded by
    # pocket/policy.json (its reasons, such as third-party material or naming terms, hold whatever the file format)
    excl = policy.get("excluded", {}).get(e["id"]) or (policy.get("excluded", {}).get(hub) if hub else None)
    em["redistribute"] = bool(em["package"]) and licence_ok(e.get("license") or (p or {}).get("license")) and not excl
    if excl: em["excluded"] = excl
    if em["package"]:
        w = wasm.get(hub)
        web = judge(lin.get(hub), "speed", "ubuntu x86-64 (native engine; the browser engine measured beside it)", e["id"], hub)
        if w and "realtime" in w:
            web.setdefault("tested", {})["browserEngineSpeed"] = w["realtime"]
            if w["realtime"] < SLOW and web["state"] == "playable":
                web.update(state="experimental", performance="may-stutter", reason=f"The browser engine ran it at {w['realtime']}x real time (V8): it may stutter.")
        if not em["redistribute"]:
            why = f"Pocket does not publish it ({em['excluded']})" if em.get("excluded") else "Its licence does not let Pocket serve a copy"
            web = {"state": "unavailable", "reason": why + ", and the web player cannot fetch the maker's file itself: open the package from disk."}
        em["web"] = web
        m = judge(mac.get(hub), "speed", f"macOS Apple Silicon ({(mac_host or {}).get('cpu', '?')})", e["id"], hub)
        if intel.get(hub): m.setdefault("tested", {})["intelSpeed"] = intel[hub].get("speed")
        em["mac"] = m
    else:
        em["web"] = em["mac"] = {"state": "unavailable", "reason": em["why"]}
    e["emu"] = em
    for k in ("web", "mac"): counts[k][em[k]["state"]] = counts[k].get(em[k]["state"], 0) + 1
    counts["packages"]["found" if em["package"] else "none"] = counts["packages"].get("found" if em["package"] else "none", 0) + 1

# coverage: what either engine can play, per player
def either(e, p):
    rf = e.get("file") and e["status"][p]["state"] == "playable"
    em = e["emu"][p]["state"] == "playable"
    return rf, em
cov = {}
for p in ("web", "mac"):
    rf = sum(1 for e in v2["firmwares"] if either(e, p)[0]); em_ = sum(1 for e in v2["firmwares"] if either(e, p)[1])
    both = sum(1 for e in v2["firmwares"] if all(either(e, p))); union = sum(1 for e in v2["firmwares"] if any(either(e, p)))
    cov[p] = {"rfm1Playable": rf, "emuPlayable": em_, "both": both, "either": union, "emuOnly": union - rf, "rfm1Only": union - em_}
v2["emuPreview"] = {"note": "Evaluation only: not published. The emulator engine's view of each firmware.", "engine": f"fm1-emu@{COMMIT}",
                    "counts": counts, "coverage": cov, "machines": {"linux": lin_host, "mac": mac_host, "intel": intel_host}}
json.dump(v2, open(opt("--out"), "w"), indent=1)
print(json.dumps({"counts": counts, "coverage": cov}, indent=1))
