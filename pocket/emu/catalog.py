#!/usr/bin/env python3
"""Adds the emulator engine to catalog-v2.json, in place, after pocket/discover.mjs has built it. Additive: a new
`emu` block per entry and `counts.emu`; nothing an existing client reads changes (no top-level file or sha256 is added
or altered, so catalog.json's downloads and Phase A clients are untouched).

    python3 pocket/emu/catalog.py --v2 DATA/catalog-v2.json --packages emu-packages.json --emu-ledger emu-compat.json
        --rfm1-ledger compat.json --store DIR_OF_PACKAGES --site DATA [--policy pocket/policy.json] [--no-web-engine]

--store holds the packages as <hub>-<sha8>.fwsc (or <hub>.fwsc); each is checked against its SHA-256 before it is copied to
DATA/pkg/. Only packages Pocket may host are copied.

Per entry, `emu`:
  package     the original package from the maker's release: url (the maker's), sha256 (the Hub's, checked), size,
              version, source (the maker's source at that release), licence; `file`, Pocket's own copy, only where
              Pocket may host it (an open licence and not excluded by policy.json). The Mac downloads from the maker;
              the web player needs Pocket's copy (browsers cannot fetch makers' GitHub assets: no CORS).
  web / mac   state (playable, experimental, unsupported, unavailable), reason, and `tested`: the automated runs
              (engine commit, machine, speed, where sound came from, package SHA-256). Automated boot checks only.
  listened    real-world listening tests (pocket/emu/listening.json), never mixed with `tested`
  preferred   {web, mac}: "fm1-emu" or "rfm1", the best-performing compatible engine, with why. The apps follow it
              unless the user overrides it for that firmware.
"""
import hashlib, json, os, re, shutil, sys

args = sys.argv[1:]
def opt(k, d=None):
    if k in args:
        i = args.index(k); v = args[i + 1]; del args[i:i + 2]; return v
    return d
HERE = os.path.dirname(os.path.abspath(__file__))
COMMIT = json.load(open(os.path.join(HERE, "upstream.json")))["commit"]
SLOW, SILENT = 1.2, 0.0002
OPEN = re.compile(r"^(GPL-[23]\.0(-only|-or-later)?|LGPL-[23]\.[01](-only|-or-later)?|AGPL-3\.0(-only|-or-later)?|MPL-2\.0|MIT|"
                  r"BSD-[23]-Clause|Apache-2\.0|ISC|Zlib|CC0-1\.0|0BSD|OFL-1\.1|Unlicense|FTL)$")
def licence_ok(spdx):
    parts = [p.strip() for p in re.split(r"\s+(?:AND|OR)\s+|[()]", spdx or "") if p.strip()]
    return bool(parts) and all(OPEN.match(p) for p in parts)

v2path = opt("--v2"); v2 = json.load(open(v2path))
pk = {r["hub"]: r for r in json.load(open(opt("--packages")))["firmwares"]}
try: led = json.load(open(opt("--emu-ledger")))["builds"]
except Exception: led = {}
try: rled = json.load(open(opt("--rfm1-ledger")))["builds"]
except Exception: rled = {}
store, site = opt("--store"), opt("--site")
web_engine = "--no-web-engine" not in args   # the site has no emu/fm1_web.wasm this time: the web player cannot use packages
policy = json.load(open(opt("--policy", os.path.join(HERE, "..", "policy.json"))))
exceptions, notes, excluded = policy.get("smokeExceptions", {}), policy.get("emuNotes", {}), policy.get("excluded", {})
listening = json.load(open(os.path.join(HERE, "listening.json"))).get("tests", [])
rfm1_by_sha = rled

def run_of(sha, machine):
    r = (led.get(sha) or {}).get(machine)
    return r if r and r.get("engine") == COMMIT else None

def judge(sha, machine, where, ids):
    run = run_of(sha, machine)
    if not run: return {"state": "experimental", "reason": f"Not yet measured on {where} with this engine version."}
    speed = run.get("speed", run.get("realtime"))
    tested = {k: run.get(k) for k in ("engine", "date", "machine", "speed", "starved", "soundFrom") if run.get(k) is not None}
    tested["engine"] = "fm1-emu@" + COMMIT[:12]; tested["sha256"] = sha; tested["kind"] = "automated boot check (scripted session)"
    if machine == "wasm": tested["speed"] = run.get("realtime")
    if run.get("exit") not in (0, None) or run.get("stopped"):
        return {"state": "unsupported", "reason": f"The emulated FM-1 stopped on {where}.", "tested": tested}
    note = next((notes[i] for i in ids if i in notes), None)
    sound = run.get("soundFrom")
    if machine != "wasm" and sound == [] :
        if note: return {"state": "experimental", "reason": note, "tested": tested}
        if not any(i in exceptions for i in ids):
            return {"state": "experimental", "reason": "Ran, but made no sound in the scripted session (keys, MIDI, PLAY).", "tested": tested}
    if speed is not None and speed < SLOW:
        return {"state": "experimental", "performance": "may-stutter", "reason": f"Ran at {speed}x real time on {where}: it may stutter.", "tested": tested}
    st = {"state": "playable", "reason": f"Played the scripted session on {where} at {speed}x real time.", "tested": tested}
    if note: st["note"] = note
    return st

def rfm1_speed(e, player):
    """the .rfm1 engine's measured speed, like for like with the emulator's: web = the web runtime in Node, mac = the
    native engine on the Linux runner (the emulator's mac figure is compared with its own Linux run for the same reason)"""
    if not e.get("sha256"): return None
    b = rfm1_by_sha.get(e["sha256"]) or {}
    r = (b.get("web") if player == "web" else b.get("native")) or {}
    return (r.get("result") or {}).get("speed")

def prefer(e, em, player):
    """The best-performing compatible engine. Both fully playable: the original package (fm1-emu), since it is the
    maker's own firmware, fingerprint-checked, and runs with real-time headroom. Only one fully playable: that one.
    Both only experimental: the one with more measured headroom."""
    have_rfm1 = bool(e.get("file")) and e["status"][player]["state"] in ("playable", "experimental")
    have_emu = em[player]["state"] in ("playable", "experimental") and (player == "mac" or (em.get("package") or {}).get("file"))
    if not have_emu: return {"engine": "rfm1", "reason": "Only the .rfm1 build runs in this player."} if have_rfm1 else None
    if not have_rfm1: return {"engine": "fm1-emu", "reason": "Only the original package runs in this player."}
    r_ok, e_ok = e["status"][player]["state"] == "playable", em[player]["state"] == "playable"
    if r_ok and e_ok: return {"engine": "fm1-emu", "reason": "Both run well; the original package is the maker's own fingerprint-checked firmware."}
    if r_ok != e_ok:
        win = "rfm1" if r_ok else "fm1-emu"
        return {"engine": win, "reason": f"Only the {'.rfm1 build' if win == 'rfm1' else 'original package'} passed every automated check here."}
    rs, es = rfm1_speed(e, player), (em[player].get("tested") or {}).get("speed")
    if rs is not None and es is not None and rs > es:
        return {"engine": "rfm1", "reason": f"Neither is fully proven here; the .rfm1 build has more headroom ({rs}x against {es}x)."}
    return {"engine": "fm1-emu", "reason": "Neither is fully proven here; the original package is tried first."}

hosted = []
counts = {"packages": 0, "hosted": 0, "web": {}, "mac": {}, "preferred": {"web": {}, "mac": {}}}
for e in v2["firmwares"]:
    hub = ((e.get("provenance") or {}).get("hub") or {}).get("id") or (e["id"] if e["id"] in pk else None)
    p = pk.get(hub) if hub else None
    ids = [i for i in (e["id"], hub) if i]
    em = {}
    if not p:
        why = "Not on The Firmware Hub: no original package known." if not hub else "The maker's package could not be fetched automatically: open it from disk."
        em["package"] = None; em["web"] = em["mac"] = {"state": "unavailable", "reason": why}
    elif p.get("status") != "found":
        em["package"] = None; em["web"] = em["mac"] = {"state": "unavailable", "reason": f"The maker's package could not be fetched automatically ({p.get('status')}): open it from disk."}
    else:
        counts["packages"] += 1
        lic = e.get("license") or p.get("license") or ""
        excl = next((excluded[i] for i in ids if i in excluded), None)
        src = p.get("source") or ""
        em["package"] = {"url": p["url"], "sha256": p["sha256"], "size": p.get("hubSize"), "version": p.get("version"), "license": lic,
                         "asset": p.get("asset"), "release": p.get("release"), "source": src or None}
        may_host = licence_ok(lic) and not excl
        if excl: em["excluded"] = excl
        name = f"{hub}-{p['sha256'][:8]}.fwsc"
        have = next((os.path.join(store, n) for n in (name, f"{hub}.fwsc") if store and os.path.exists(os.path.join(store, n))), None)
        if have and hashlib.sha256(open(have, "rb").read()).hexdigest() != p["sha256"]: have = None
        if may_host and have and web_engine:
            em["package"]["file"] = "pkg/" + name
            if site:
                os.makedirs(os.path.join(site, "pkg"), exist_ok=True)
                shutil.copyfile(have, os.path.join(site, "pkg", name))
            hosted.append(name); counts["hosted"] += 1
        em["web"] = judge(p["sha256"], "wasm", "the browser engine (V8)", ids)
        lin = run_of(p["sha256"], "linux")
        if em["web"]["state"] == "playable" and lin and lin.get("soundFrom") == [] and not any(i in exceptions for i in ids):
            em["web"] = {"state": "experimental", "reason": next((notes[i] for i in ids if i in notes), "Ran, but made no sound in the scripted session (keys, MIDI, PLAY)."), "tested": em["web"].get("tested")}
        if not em["package"].get("file"):
            why = (f"Pocket does not host it ({excl})" if excl else "The web player's emulator is not on the site this time" if not web_engine
                   else "Pocket's copy is not ready yet" if may_host else "Its licence does not let Pocket host a copy")
            em["web"] = {"state": "unavailable", "reason": why + ", and a browser cannot fetch the maker's file itself: open the package from disk."}
        em["mac"] = judge(p["sha256"], "mac", "macOS Apple Silicon", ids)
        if excl and em["mac"]["state"] != "unavailable":
            em["mac"] = {**em["mac"], "state": "unavailable", "reason": f"Pocket does not distribute it ({excl}). Download it from the maker and open it from disk."}
        intel = run_of(p["sha256"], "intel")
        if intel and em["mac"].get("tested") is not None: em["mac"]["tested"]["intelSpeed"] = intel.get("speed")
    em["listened"] = [t for t in listening if t.get("firmware") in ids]
    em["preferred"] = {}
    for player in ("web", "mac"):
        if em[player]["state"] not in ("playable", "experimental", "unsupported", "unavailable"): em[player]["state"] = "experimental"
        pr = prefer(e, em, player)
        if pr: em["preferred"][player] = pr
        counts[player][em[player]["state"]] = counts[player].get(em[player]["state"], 0) + 1
        if pr: counts["preferred"][player][pr["engine"]] = counts["preferred"][player].get(pr["engine"], 0) + 1
    e["emu"] = em

v2.setdefault("counts", {})["emu"] = counts
v2["runtimes"] = {**v2.get("runtimes", {}), "fm1-emu": {"repository": "joakimeriksson/fm1-emu", "commit": COMMIT, "license": "MIT",
    "note": "The emulator's MIT licence covers the emulator only; each firmware keeps its own licence and restrictions."}}
json.dump(v2, open(v2path, "w"), indent=1); open(v2path, "a").write("\n")
if site:
    open(os.path.join(site, "pkg", "HOSTED.txt") if hosted else os.devnull, "w").write("\n".join(sorted(hosted)) + "\n")
playable = lambda pl: sum(1 for e in v2["firmwares"] if e["emu"]["preferred"].get(pl))
text = (f"## The emulator engine (fm1-emu@{COMMIT[:12]})\n\n{counts['packages']} original packages found, {counts['hosted']} hosted by Pocket. "
        f"Web: {counts['web']}. Mac: {counts['mac']}. Firmwares either engine plays: web {playable('web')}, Mac {playable('mac')}. "
        f"Preferred engine: web {counts['preferred']['web']}, Mac {counts['preferred']['mac']}. Automated boot checks only; listening tests: {len(listening)}.\n")
if os.environ.get("GITHUB_STEP_SUMMARY"): open(os.environ["GITHUB_STEP_SUMMARY"], "a").write(text)
print(text)
