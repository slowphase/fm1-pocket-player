#!/usr/bin/env python3
"""The expanded catalogue, end to end, from the recorded inputs: what the nightly would publish once FM1 Editor's
listings are in, and after two Editor-first firmware are promoted.

  night 1   the golden inputs (21 Nov 2026) plus FM1 Editor's page at c017be1: 159 listing-only entries
  night 2   four days later, The Firmware Hub adds KickSide as "kicksidefm" (with a verified original package, a copy
            of one the golden run found playable on the Mac), and RemoteFM1FW builds GLITCH as "glitchdrums"

Each night goes through the real chain: discover.mjs, then the emulator layer (pocket/emu/catalog.py). Writes to OUT:
  catalog-v2-night1.json, catalog-v2.json (night 2), catalog.json (night 2's v1: GLITCH under its build id),
  packages.json (night 2's emulator package list)

The simulated rows are copies of real rows from the recorded inputs, so a few values are borrowed (KickSide's Hub row
is Blop's, GLITCH's build is AMB-1's); the point is the identity and playback behaviour.

  python3 pocket/tests/golden/make_expanded.py OUT
"""
import gzip, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
rd = lambda f: json.load(gzip.open(os.path.join(HERE, f)))

NODE = """
import { goldenBuild } from './pocket/tests/golden/golden.mjs';
import { hubWithKickSide, rfm1WithGlitch } from './pocket/tests/golden/promotion.mjs';
import { snapshot } from './pocket/editor.mjs'; import { IDENTITIES } from './pocket/discover.mjs';
import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib';
const f = 'pocket/tests/fixtures/';
const editor = snapshot({ html: gunzipSync(readFileSync(f + 'fm1-editor-c017be1.html.gz')).toString(),
  licenceText: readFileSync(f + 'fm1-editor-LICENSE', 'utf8'), commit: 'c017be1c6b34213f794c2c5b4afc8bab808a6a78',
  committed: '2026-11-21T12:46:05Z', checked: '2026-11-21T13:00:00Z' });
const editorAliases = JSON.parse(readFileSync('pocket/editor-aliases.json', 'utf8'));
const n1 = goldenBuild({ editor, editorAliases });
const { v1, upstream } = rfm1WithGlitch();
const now = new Date(Date.parse(n1.snapshot) + 4 * 864e5);
const n2 = goldenBuild({ editor, editorAliases, previous: n1, identityLedger: n1[IDENTITIES], hub: hubWithKickSide(), v1, upstream, now });
process.stdout.write(JSON.stringify({ n1, n2, v1 }));
"""


def emu_layer(v2, packages, emu, ledger):
    with tempfile.TemporaryDirectory() as t:
        for name, obj in (("v2.json", v2), ("packages.json", packages), ("emu.json", emu["emuLedger"]), ("compat.json", ledger)):
            json.dump(obj, open(os.path.join(t, name), "w"))
        subprocess.run([sys.executable, os.path.join(ROOT, "pocket", "emu", "catalog.py"), "--v2", os.path.join(t, "v2.json"),
                        "--packages", os.path.join(t, "packages.json"), "--emu-ledger", os.path.join(t, "emu.json"),
                        "--rfm1-ledger", os.path.join(t, "compat.json")], check=True, capture_output=True)
        return json.load(open(os.path.join(t, "v2.json")))


def build():
    emu, want = rd("emu-inputs.json.gz"), rd("emu-expected.json.gz")
    ledger = rd("discover-inputs.json.gz")["ledger"]
    out = json.loads(subprocess.run(["node", "--input-type=module", "-e", NODE], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
    # KickSide's original package: a copy of one the golden run found playable on the Mac (the ledger is keyed by SHA-256)
    good = next(e for e in want["firmwares"] if (e.get("emu") or {}).get("mac", {}).get("state") == "playable"
                and ((e.get("provenance") or {}).get("hub") or {}).get("id"))
    hid = good["provenance"]["hub"]["id"]
    pkg = dict(next(p for p in emu["packages"]["firmwares"] if p["hub"] == hid), hub="kicksidefm", name="KickSide",
               repo="kjs4discovery/kicksidesidekick", license=good.get("license") or "GPL-3.0")
    packages2 = dict(emu["packages"], firmwares=emu["packages"]["firmwares"] + [pkg])
    return {"night1": emu_layer(out["n1"], emu["packages"], emu, ledger), "night2": emu_layer(out["n2"], packages2, emu, ledger),
            "v1": out["v1"], "packages": packages2, "good": good, "package": pkg, "want": want}


if __name__ == "__main__":
    dest = sys.argv[1]
    os.makedirs(dest, exist_ok=True)
    r = build()
    for name, obj in (("catalog-v2-night1.json", r["night1"]), ("catalog-v2.json", r["night2"]), ("catalog.json", r["v1"]),
                      ("packages.json", r["packages"])):
        json.dump(obj, open(os.path.join(dest, name), "w"), indent=1, ensure_ascii=False)
    print(f"wrote {dest}: night 1 {len(r['night1']['firmwares'])} firmwares, night 2 {len(r['night2']['firmwares'])}")
