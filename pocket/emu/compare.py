#!/usr/bin/env python3
"""The emulator upgrade check: compares a candidate fm1-emu commit with the pinned one over the same original
packages, on the same machine, in the same job. Exits 1 if the candidate is worse anywhere.

    python3 pocket/emu/compare.py --baseline A.json[,A2.json] --candidate B.json[,B2.json] [--wasm-baseline W.json,..] [--wasm-candidate W.json,..]

A regression is: the emulated FM-1 stops where it did not; a window that made sound (keys, MIDI, PLAY) goes silent;
speed falls by more than 15% and below 1.2x real time; the browser engine errors where it did not. Firmwares listed
in pocket/emu/accepted.json for that candidate commit are reported but do not fail the check (a reviewed, known change).
Automated checks only: an upgrade still needs a listening test before the apps take it (pocket/emu/listening.json).
"""
import json, os, sys
args = sys.argv[1:]
def opt(k, d=None):
    if k in args:
        i = args.index(k); v = args[i + 1]; del args[i:i + 2]; return v
    return d
def native(files):
    out = {}
    for f in filter(None, (files or "").split(",")):
        d = json.load(open(f))
        for r in d["firmwares"]: out[r["id"]] = r
    return out
def wasm(files):
    out = {}
    for f in filter(None, (files or "").split(",")):
        for r in json.load(open(f)): out[r["id"]] = r["wasm"]
    return out
HERE = os.path.dirname(os.path.abspath(__file__))
cand_commit = opt("--candidate-commit", "")
try: accepted = json.load(open(os.path.join(HERE, "accepted.json"))).get(cand_commit, {})
except Exception: accepted = {}
A, B = native(opt("--baseline")), native(opt("--candidate"))
WA, WB = wasm(opt("--wasm-baseline")), wasm(opt("--wasm-candidate"))
problems, better, same = [], [], 0
for id in sorted(set(A) | set(B)):
    a, b = A.get(id), B.get(id)
    if not a or not b: problems.append((id, "measured by only one of the two engines")); continue
    p = []
    if (b.get("stopped") or b.get("exit")) and not (a.get("stopped") or a.get("exit")): p.append("now stops")
    lost = [w for w in a.get("soundFrom", []) if w != "idle" and w not in b.get("soundFrom", [])]
    if lost: p.append("no longer sounds from " + ", ".join(lost))
    sa, sb = a.get("speed") or 0, b.get("speed") or 0
    if sa and sb < sa * 0.85 and sb < 1.2: p.append(f"slower: {sa}x to {sb}x")
    if sb > sa * 1.15: better.append(f"{id} faster: {sa}x to {sb}x")
    gained = [w for w in b.get("soundFrom", []) if w not in a.get("soundFrom", [])]
    if gained: better.append(f"{id} now sounds from {', '.join(gained)}")
    if p: problems.append((id, "; ".join(p)))
    else: same += 1
for id in sorted(set(WA) & set(WB)):
    if WB[id].get("error") and not WA[id].get("error"): problems.append((id, "the browser engine now fails"))
    elif WA[id].get("realtime") and WB[id].get("realtime") and WB[id]["realtime"] < WA[id]["realtime"] * 0.85 and WB[id]["realtime"] < 1.2:
        problems.append((id, f"browser engine slower: {WA[id]['realtime']}x to {WB[id]['realtime']}x"))
wasm_n = len(set(WA) & set(WB))
failing = [(i, w) for i, w in problems if i not in accepted]
if not (set(A) | set(B)) and not wasm_n:
    failing.append(("(none)", "nothing was compared: no measurements from either engine"))
lines = [f"## Emulator upgrade check", "",
         f"Native: {len(set(A) | set(B))} packages compared; browser engine: {wasm_n}. {same} native unchanged or better; "
         f"{len(problems)} worse ({len(problems) - len([p for p in problems if p[0] not in accepted])} accepted)."]
lines += ["", "**Worse**", *[f"- {i}: {w}{' (accepted: ' + accepted[i] + ')' if i in accepted else ''}" for i, w in problems]] if problems else []
lines += ["", "**Better**", *[f"- {x}" for x in better[:60]]] if better else []
text = "\n".join(lines) + "\n"
if os.environ.get("GITHUB_STEP_SUMMARY"): open(os.environ["GITHUB_STEP_SUMMARY"], "a").write(text)
print(text)
sys.exit(1 if failing else 0)
