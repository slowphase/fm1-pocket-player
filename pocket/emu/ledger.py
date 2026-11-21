#!/usr/bin/env python3
"""The emulator's compatibility ledger (emu-compat.json in pocket-current), like compat.json for the .rfm1 engine:
each original package's measured runs, by package SHA-256 and engine commit. A package is measured again only when
its SHA-256 or the pinned engine commit changes.

    python3 pocket/emu/ledger.py todo   --ledger L --packages P --machine linux|wasm|mac       (ids to measure)
    python3 pocket/emu/ledger.py merge  --ledger L --packages P --machine linux|mac --native R.json
    python3 pocket/emu/ledger.py merge  --ledger L --packages P --machine wasm --wasm R.json
    python3 pocket/emu/ledger.py seed   --ledger L --from docs/emu-evaluation-results.json

Every result says which machine measured it, when, and with which engine commit. These are automated boot checks
(a scripted session; nobody listens), never listening tests: those are recorded by hand in pocket/emu/listening.json.
"""
import datetime, json, os, sys

args = sys.argv[1:]
cmd = args.pop(0) if args else ""
def opt(k, d=None):
    if k in args:
        i = args.index(k); v = args[i + 1]; del args[i:i + 2]; return v
    return d
HERE = os.path.dirname(os.path.abspath(__file__))
COMMIT = json.load(open(os.path.join(HERE, "upstream.json")))["commit"]
NOW = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def load(path):
    try: return json.load(open(path))
    except Exception: return {"schema": 1, "builds": {}}

def save(path, led):
    led["engine"] = COMMIT
    json.dump(led, open(path, "w"), indent=1); open(path, "a").write("\n")

def packages(path):
    return {r["hub"]: r for r in json.load(open(path))["firmwares"] if r.get("status") == "found"}

def current(rec, machine):
    """this machine's run of this build, if it was made with the pinned engine"""
    r = (rec or {}).get(machine)
    return r if r and r.get("engine") == COMMIT else None

if cmd == "todo":
    led, pk, m = load(opt("--ledger")), packages(opt("--packages")), opt("--machine")
    print(" ".join(sorted(h for h, p in pk.items() if not current(led["builds"].get(p["sha256"]), m))))

elif cmd == "merge":
    path, pk, m = opt("--ledger"), packages(opt("--packages")), opt("--machine")
    led = load(path)
    by_hub = {h: p["sha256"] for h, p in pk.items()}
    if m == "wasm":
        for r in json.load(open(opt("--wasm"))):
            sha = by_hub.get(r["id"])
            if not sha or r["wasm"].get("error"): continue
            led["builds"].setdefault(sha, {"hub": r["id"]})["wasm"] = {**r["wasm"], "engine": COMMIT, "date": NOW,
                "machine": "the browser engine (fm1-web, WebAssembly JIT) in Node's V8 on a GitHub Linux runner"}
    else:
        d = json.load(open(opt("--native")))
        host = d.get("host") or {}
        for r in d["firmwares"]:
            sha = r.get("sha256") or by_hub.get(r["id"])
            if not sha or "speed" not in r and r.get("exit", 0) == 0: continue
            led["builds"].setdefault(sha, {"hub": r["id"]})[m] = {
                "engine": COMMIT, "date": NOW, "machine": f"{host.get('system')} {host.get('machine')}, {host.get('cpu')}",
                "speed": r.get("speed"), "starved": r.get("starved"), "rms": r.get("rms"), "soundFrom": r.get("soundFrom"),
                "exit": r.get("exit"), "stopped": r.get("stopped"), "screens": r.get("screens")}
    save(path, led)
    print(f"{m}: {sum(1 for b in led['builds'].values() if current(b, m))} builds measured with fm1-emu@{COMMIT[:12]}")

elif cmd == "seed":
    path, src = opt("--ledger"), json.load(open(opt("--from")))
    led = load(path)
    commit = src["snapshot"]["engine"].split("@")[1]
    machines = src["machines"]
    for r in src["firmwares"]:
        if not r.get("sha256") or "speed" not in r: continue
        b = led["builds"].setdefault(r["sha256"], {"hub": r["hub"]})
        for key, m, host in (("linux", "linux", machines["ubuntu-latest"]), ("macArm", "mac", machines["macos-15"]), ("macIntel", "intel", machines["macos-15-intel"])):
            if r["speed"].get(key) is None or b.get(m): continue
            b[m] = {"engine": commit, "date": src["snapshot"]["packagesRead"], "machine": f"{host['system']} {host['machine']}, {host['cpu']}",
                    "speed": r["speed"][key], "starved": (r.get("starved") or {}).get(key), "soundFrom": r.get("soundFrom"), "exit": 0,
                    "seeded": "docs/emu-evaluation-results.json"}
        if r["speed"].get("browserEngine") is not None and not b.get("wasm"):
            b["wasm"] = {"engine": commit, "date": src["snapshot"]["packagesRead"], "realtime": r["speed"]["browserEngine"],
                         "machine": "the browser engine in Node's V8 on a GitHub Linux runner", "seeded": "docs/emu-evaluation-results.json"}
    save(path, led)
    print(f"seeded {len(led['builds'])} builds")
else:
    sys.exit(__doc__)
