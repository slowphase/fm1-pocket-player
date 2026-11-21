#!/usr/bin/env python3
"""Makes sure DIR holds every package packages.json lists as found, as <hub>.fwsc, each checked against the Hub's
SHA-256. A copy already in DIR (as <hub>.fwsc or <hub>-<sha8>.fwsc, e.g. from the pocket-packages release) is used
if its SHA-256 matches; anything else is downloaded from the maker's release (the url in packages.json), never from
the Hub. Files that do not match are deleted.

    python3 pocket/emu/fetch.py --packages packages.json --dir DIR [--only id,id]
"""
import hashlib, json, os, re, sys, time, urllib.request
args = sys.argv[1:]
def opt(k, d=None):
    if k in args:
        i = args.index(k); v = args[i + 1]; del args[i:i + 2]; return v
    return d
rows = [r for r in json.load(open(opt("--packages")))["firmwares"] if r.get("status") == "found"]
d = opt("--dir"); os.makedirs(d, exist_ok=True)
o = opt("--only")   # opt() consumes the option, so read it once
only = set(o.split(",")) if o else None
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
got = fetched = bad = 0
for r in rows:
    if only is not None and r["hub"] not in only: continue
    want, dst = r["sha256"], os.path.join(d, f"{r['hub']}.fwsc")
    alt = os.path.join(d, f"{r['hub']}-{want[:8]}.fwsc")
    if os.path.exists(alt) and not os.path.exists(dst): os.replace(alt, dst)
    if os.path.exists(dst) and sha(dst) == want: got += 1; continue
    try:
        req = urllib.request.Request(r["url"], headers={"User-Agent": "fm1-pocket-player (github.com/slowphase/fm1-pocket-player)"})
        data = urllib.request.urlopen(req, timeout=60).read()
        if hashlib.sha256(data).hexdigest() == want:
            open(dst, "wb").write(data); fetched += 1; time.sleep(0.3); continue
    except Exception as e:
        print(f"{r['hub']}: {e}", file=sys.stderr)
    bad += 1
    if os.path.exists(dst): os.remove(dst)
for f in os.listdir(d):
    stem = f[:-5]
    if f.endswith(".fwsc") and re.fullmatch(r".+-[0-9a-f]{8}", stem) and stem.rsplit("-", 1)[0] + ".fwsc" in os.listdir(d): os.remove(os.path.join(d, f))
print(f"{got} already here, {fetched} downloaded from the makers, {bad} missing or not matching (left out)")
