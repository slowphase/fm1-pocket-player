#!/usr/bin/env python3
"""Tests for pocket/emu/catalog.py on a tiny made-up catalogue: engine preference (measurements, known issues,
policy overrides), confidence levels (listened only for the exact file and player, automated otherwise, known
issues from policy and from listening reports), hosting only open, non-excluded packages, and catalog.json-era
fields left alone.   python3 pocket/emu/test_catalog.py"""
import hashlib, json, os, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
COMMIT = json.load(open(os.path.join(HERE, "upstream.json")))["commit"]

def sha(b): return hashlib.sha256(b).hexdigest()

class Catalog(unittest.TestCase):
    def build(self, listening=None, policy_extra=None, b_rfm1="playable"):
        d = tempfile.mkdtemp()
        pk = {"a": b"A" * 5000, "b": b"B" * 5000, "c": b"C" * 5000}
        store = os.path.join(d, "store"); os.makedirs(store)
        for k, v in pk.items():
            open(os.path.join(store, k + ".fwsc"), "wb").write(v)
            open(os.path.join(store, f"shot-{k}-{sha(v)[:8]}.png"), "wb").write(b"PNG" + k.encode())
        st = lambda s: {"state": s, "reason": "r"}
        v2 = {"schema": 2, "firmwares": [
            {"id": "a", "name": "A", "license": "GPL-3.0", "file": "fw/a.rfm1", "sha256": "1" * 64, "version": "1",
             "status": {"web": st("playable"), "mac": st("playable")}},
            {"id": "b", "name": "B", "license": "GPL-3.0", "file": "fw/b.rfm1", "sha256": "2" * 64, "version": "1",
             "status": {"web": st(b_rfm1), "mac": st(b_rfm1)}},
            {"id": "c", "name": "C", "license": "All rights reserved", "status": {"web": st("source-only"), "mac": st("source-only")}},
        ]}
        open(os.path.join(d, "v2.json"), "w").write(json.dumps(v2))
        rows = [{"hub": k, "status": "found", "sha256": sha(v), "url": f"https://github.com/m/{k}/releases/download/v1/{k}.fwsc",
                 "version": "1", "license": "GPL-3.0" if k != "c" else "All rights reserved"} for k, v in pk.items()]
        open(os.path.join(d, "packages.json"), "w").write(json.dumps({"firmwares": rows}))
        run = {"engine": COMMIT, "speed": 3.0, "soundFrom": ["keys"], "exit": 0, "machine": "Darwin arm64, Apple M1"}
        led = {"builds": {sha(v): {"hub": k, "linux": run, "mac": run, "wasm": {"engine": COMMIT, "realtime": 2.5}} for k, v in pk.items()}}
        open(os.path.join(d, "led.json"), "w").write(json.dumps(led))
        open(os.path.join(d, "rled.json"), "w").write(json.dumps({"builds": {}}))
        pol = json.load(open(os.path.join(HERE, "..", "policy.json")))
        pol["excluded"] = {}; pol["emuNotes"] = {}; pol["knownIssues"] = {}; pol["emuPrefer"] = {}
        pol.update(policy_extra or {})
        open(os.path.join(d, "policy.json"), "w").write(json.dumps(pol))
        lst = os.path.join(HERE, "listening.json"); saved = open(lst).read()
        try:
            open(lst, "w").write(json.dumps({"tests": listening or []}))
            subprocess.run([sys.executable, os.path.join(HERE, "catalog.py"), "--v2", os.path.join(d, "v2.json"),
                            "--packages", os.path.join(d, "packages.json"), "--emu-ledger", os.path.join(d, "led.json"),
                            "--rfm1-ledger", os.path.join(d, "rled.json"), "--store", store, "--site", os.path.join(d, "site"),
                            "--policy", os.path.join(d, "policy.json")], check=True, capture_output=True)
        finally:
            open(lst, "w").write(saved)
        out = json.load(open(os.path.join(d, "v2.json")))
        return {e["id"]: e for e in out["firmwares"]}, d, pk

    def test_preference_and_automated_confidence(self):
        f, d, pk = self.build()
        self.assertEqual(f["a"]["emu"]["preferred"]["mac"]["engine"], "fm1-emu", "both playable: the original package")
        self.assertEqual(f["a"]["confidence"]["mac"]["fm1-emu"]["level"], "automated")
        self.assertEqual(f["a"]["confidence"]["mac"]["rfm1"]["level"], "automated")
        self.assertEqual(f["a"]["file"], "fw/a.rfm1", "the .rfm1 entry is untouched")
        self.assertIsNone(f["c"]["emu"]["package"].get("file"), "a closed licence is never hosted")
        self.assertEqual(f["c"]["emu"]["web"]["state"], "unavailable")
        self.assertEqual(f["c"]["emu"]["preferred"]["mac"]["engine"], "fm1-emu", "the Mac downloads it from the maker")
        self.assertTrue(os.path.exists(os.path.join(d, "site", "pkg", f"a-{sha(pk['a'])[:8]}.fwsc")))

    def test_experimental_is_never_described_as_passed(self):
        f, d, pk = self.build(b_rfm1="experimental")
        note = f["b"]["confidence"]["web"]["rfm1"]["note"]
        self.assertNotIn("Passed", note)
        self.assertIn("did not pass", note)
        self.assertIn("Passed", f["a"]["confidence"]["web"]["rfm1"]["note"], "a playable build still says it passed")

    def test_screens_for_firmware_without_a_picture(self):
        f, d, pk = self.build()
        self.assertEqual(f["a"]["image"], f"shots/a-emu-{sha(pk['a'])[:8]}.png")
        self.assertEqual(f["a"]["imageKind"], "emulator screen")
        self.assertTrue(os.path.exists(os.path.join(d, "site", f["a"]["image"])))
        self.assertNotIn("image", f["c"], "a firmware Pocket may not host gets no screen: the apps draw its name")

    def test_policy_override_and_known_issue(self):
        f, _, _ = self.build(policy_extra={"emuPrefer": {"a": {"engine": "rfm1", "reason": "until listened"}},
                                           "knownIssues": {"b": {"fm1-emu": "silent"}}})
        self.assertEqual(f["a"]["emu"]["preferred"]["web"]["engine"], "rfm1")
        self.assertEqual(f["b"]["emu"]["preferred"]["mac"]["engine"], "rfm1", "a known issue sends it to the other engine")
        self.assertEqual(f["b"]["confidence"]["mac"]["fm1-emu"], {"level": "known-issue", "note": "silent"})
        self.assertEqual(f["b"]["knownIssues"]["web"]["fm1-emu"], "silent")

    def test_listening_counts_only_for_its_exact_file_and_player(self):
        a = sha(b"A" * 5000)
        tests = [{"firmware": "a", "player": "mac", "engine": "fm1-emu", "build": a, "verdict": "good", "who": "D", "date": "2026-11-20"},
                 {"firmware": "a", "player": "mac", "engine": "rfm1", "build": "9" * 64, "verdict": "good", "who": "D", "date": "2026-11-20"},
                 {"firmware": "b", "player": "mac", "engine": "fm1-emu", "build": sha(b"B" * 5000), "verdict": "problems", "notes": "crackles", "date": "2026-11-20"}]
        f, _, _ = self.build(listening=tests)
        self.assertEqual(f["a"]["confidence"]["mac"]["fm1-emu"]["level"], "listened")
        self.assertEqual(f["a"]["confidence"]["web"]["fm1-emu"]["level"], "automated", "listening on the Mac says nothing of the web")
        self.assertEqual(f["a"]["confidence"]["mac"]["rfm1"]["level"], "automated", "a test of another file does not count")
        self.assertEqual(f["b"]["confidence"]["mac"]["fm1-emu"]["level"], "known-issue")
        self.assertIn("crackles", f["b"]["knownIssues"]["mac"]["fm1-emu"])
        self.assertEqual(f["b"]["emu"]["preferred"]["mac"]["engine"], "rfm1")
        self.assertEqual(len(f["a"]["listened"]), 2)


class Golden(unittest.TestCase):
    """The emulator layer on the golden baseline (pocket/tests/golden/README.md): the 21 Nov 2026 catalogue."""
    def test_existing_entries_are_unchanged(self):
        import gzip
        g = os.path.join(HERE, "..", "tests", "golden")
        rd = lambda f: json.load(gzip.open(os.path.join(g, f)))
        emu, disc = rd("emu-inputs.json.gz"), rd("discover-expected.json.gz")
        with tempfile.TemporaryDirectory() as t:
            for name, obj in (("v2.json", disc), ("packages.json", emu["packages"]), ("emu.json", emu["emuLedger"]),
                              ("compat.json", rd("discover-inputs.json.gz")["ledger"])):
                json.dump(obj, open(os.path.join(t, name), "w"))
            subprocess.run([sys.executable, os.path.join(HERE, "catalog.py"), "--v2", os.path.join(t, "v2.json"), "--packages",
                            os.path.join(t, "packages.json"), "--emu-ledger", os.path.join(t, "emu.json"), "--rfm1-ledger",
                            os.path.join(t, "compat.json")], check=True, capture_output=True)
            got = json.load(open(os.path.join(t, "v2.json")))
        want = rd("emu-expected.json.gz")
        self.maxDiff = 4000
        self.assertEqual(len(got["firmwares"]), 285)
        # the expected file went through JavaScript, which writes 2.0 as 2
        def norm(o):
            if isinstance(o, float) and o.is_integer(): return int(o)
            if isinstance(o, dict): return {k: norm(v) for k, v in o.items()}
            if isinstance(o, list): return [norm(v) for v in o]
            return o
        canon = lambda o: json.dumps(norm(o), sort_keys=True)
        g2 = {e["id"]: e for e in got["firmwares"]}
        for e in want["firmwares"]:
            for k, v in e.items():
                self.assertEqual(canon(g2[e["id"]].get(k)), canon(v), f"{e['id']}.{k} changed")
        self.assertEqual(canon(got["counts"]), canon(want["counts"]))

    def test_editor_listings_leave_existing_entries_unchanged_and_get_no_package(self):
        """Phase 2: the golden catalogue plus FM1 Editor's listing-only entries (built by discover.mjs from the recorded
        page), through the emulator layer: the 285 existing entries are exactly as before, and no Editor entry gets an
        original package, even one whose id equals a Hub package's id."""
        import gzip
        g = os.path.join(HERE, "..", "tests", "golden")
        rd = lambda f: json.load(gzip.open(os.path.join(g, f)))
        emu = rd("emu-inputs.json.gz")
        script = ("import { goldenBuild } from './pocket/tests/golden/golden.mjs';"
                  "import { snapshot } from './pocket/editor.mjs';"
                  "import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib';"
                  "const f = 'pocket/tests/fixtures/';"
                  "const editor = snapshot({ html: gunzipSync(readFileSync(f + 'fm1-editor-c017be1.html.gz')).toString(),"
                  " licenceText: readFileSync(f + 'fm1-editor-LICENSE', 'utf8'), commit: 'c017be1', committed: null, checked: '2026-11-21T13:00:00Z' });"
                  "const aliases = JSON.parse(readFileSync('pocket/editor-aliases.json', 'utf8'));"
                  "process.stdout.write(JSON.stringify(goldenBuild({ editor, editorAliases: aliases })));")
        root = os.path.join(HERE, "..", "..")
        v2 = json.loads(subprocess.run(["node", "--input-type=module", "-e", script], cwd=root, check=True, capture_output=True, text=True).stdout)
        listing = [e for e in v2["firmwares"] if set((e.get("provenance") or {})) == {"editor"}]
        self.assertGreater(len(listing), 100)
        # an Editor entry that happens to share a Hub package's id must still get no package
        pkg_hub = next(p["hub"] for p in emu["packages"]["firmwares"] if p.get("status") == "found")
        decoy = dict(listing[0], id=pkg_hub)
        v2["firmwares"] = [e for e in v2["firmwares"] if e["id"] != pkg_hub] + [decoy] if pkg_hub not in {e["id"] for e in rd("discover-expected.json.gz")["firmwares"]} else v2["firmwares"] + [decoy]
        with tempfile.TemporaryDirectory() as t:
            for name, obj in (("v2.json", v2), ("packages.json", emu["packages"]), ("emu.json", emu["emuLedger"]),
                              ("compat.json", rd("discover-inputs.json.gz")["ledger"])):
                json.dump(obj, open(os.path.join(t, name), "w"))
            subprocess.run([sys.executable, os.path.join(HERE, "catalog.py"), "--v2", os.path.join(t, "v2.json"), "--packages",
                            os.path.join(t, "packages.json"), "--emu-ledger", os.path.join(t, "emu.json"), "--rfm1-ledger",
                            os.path.join(t, "compat.json")], check=True, capture_output=True)
            got = json.load(open(os.path.join(t, "v2.json")))
        want = rd("emu-expected.json.gz")
        def norm(o):
            if isinstance(o, float) and o.is_integer(): return int(o)
            if isinstance(o, dict): return {k: norm(v) for k, v in o.items()}
            if isinstance(o, list): return [norm(v) for v in o]
            return o
        canon = lambda o: json.dumps(norm(o), sort_keys=True)
        existing = {e["id"] for e in want["firmwares"]}
        g2 = {}
        for e in got["firmwares"]:
            if e["id"] in existing and set((e.get("provenance") or {})) == {"editor"}: continue   # the decoy
            g2.setdefault(e["id"], e)
        for e in want["firmwares"]:
            for k, v in e.items():
                self.assertEqual(canon(g2[e["id"]].get(k)), canon(v), f"{e['id']}.{k} changed")
        for e in got["firmwares"]:
            if set((e.get("provenance") or {})) == {"editor"}:
                self.assertIsNone(e["emu"]["package"], e["id"])
                self.assertEqual(e["emu"]["mac"]["state"], "unavailable")
                self.assertFalse(e.get("file"), e["id"])
        self.assertEqual(got["counts"]["emu"]["packages"], want["counts"]["emu"]["packages"])
        self.assertEqual(got["counts"]["emu"]["preferred"], want["counts"]["emu"]["preferred"])


class Promotion(unittest.TestCase):
    """An Editor-first firmware (KickSide, Pocket id "kickside") that The Firmware Hub later adds under its own id
    ("kicksidefm") with a verified package: through discover.mjs and this emulator layer, it keeps its Pocket id and
    becomes playable, its package found through the Hub's id, and every existing entry stays as it was."""

    def test_editor_first_firmware_becomes_playable_through_the_hub_under_its_pocket_id(self):
        import gzip
        g = os.path.join(HERE, "..", "tests", "golden")
        rd = lambda f: json.load(gzip.open(os.path.join(g, f)))
        emu, want = rd("emu-inputs.json.gz"), rd("emu-expected.json.gz")
        # a package the golden run found playable on the Mac, re-used as KickSide's (the ledger is keyed by SHA-256)
        good = next(e for e in want["firmwares"] if (e.get("emu") or {}).get("mac", {}).get("state") == "playable"
                    and ((e.get("provenance") or {}).get("hub") or {}).get("id"))
        hid = good["provenance"]["hub"]["id"]
        pkg = dict(next(p for p in emu["packages"]["firmwares"] if p["hub"] == hid), hub="kicksidefm", name="KickSide",
                   repo="kjs4discovery/kicksidesidekick", license=good.get("license") or "GPL-3.0")
        packages = dict(emu["packages"], firmwares=emu["packages"]["firmwares"] + [pkg])
        script = ("import { goldenBuild } from './pocket/tests/golden/golden.mjs';"
                  "import { hubWithKickSide } from './pocket/tests/golden/promotion.mjs';"
                  "import { snapshot } from './pocket/editor.mjs'; import { IDENTITIES } from './pocket/discover.mjs';"
                  "import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib';"
                  "const f = 'pocket/tests/fixtures/';"
                  "const editor = snapshot({ html: gunzipSync(readFileSync(f + 'fm1-editor-c017be1.html.gz')).toString(),"
                  " licenceText: readFileSync(f + 'fm1-editor-LICENSE', 'utf8'), commit: 'c017be1', committed: null, checked: '2026-11-21T13:00:00Z' });"
                  "const editorAliases = JSON.parse(readFileSync('pocket/editor-aliases.json', 'utf8'));"
                  "const n1 = goldenBuild({ editor, editorAliases });"
                  "const n2 = goldenBuild({ editor, editorAliases, previous: n1, identityLedger: n1[IDENTITIES], hub: hubWithKickSide() });"
                  "process.stdout.write(JSON.stringify(n2));")
        root = os.path.join(HERE, "..", "..")
        v2 = json.loads(subprocess.run(["node", "--input-type=module", "-e", script], cwd=root, check=True, capture_output=True, text=True).stdout)
        with tempfile.TemporaryDirectory() as t:
            for name, obj in (("v2.json", v2), ("packages.json", packages), ("emu.json", emu["emuLedger"]),
                              ("compat.json", rd("discover-inputs.json.gz")["ledger"])):
                json.dump(obj, open(os.path.join(t, name), "w"))
            subprocess.run([sys.executable, os.path.join(HERE, "catalog.py"), "--v2", os.path.join(t, "v2.json"), "--packages",
                            os.path.join(t, "packages.json"), "--emu-ledger", os.path.join(t, "emu.json"), "--rfm1-ledger",
                            os.path.join(t, "compat.json")], check=True, capture_output=True)
            got = json.load(open(os.path.join(t, "v2.json")))
        by = {e["id"]: e for e in got["firmwares"]}
        self.assertNotIn("kicksidefm", by, "no duplicate under the Hub's id")
        k = by["kickside"]
        self.assertEqual(k["provenance"]["hub"]["id"], "kicksidefm")
        self.assertEqual(k["emu"]["package"]["sha256"], pkg["sha256"], "the package is found through the Hub's id")
        self.assertEqual(k["emu"]["mac"]["state"], "playable", "playable on the Mac under its Pocket id")
        self.assertEqual(k["emu"]["mac"]["state"], good["emu"]["mac"]["state"])
        self.assertEqual(k["listed"], "2026-10-07")
        self.assertEqual(k["provenance"]["editor"]["key"], "kickside")
        self.assertEqual(got["counts"]["emu"]["packages"], want["counts"]["emu"]["packages"] + 1)
        def ints(o):
            if isinstance(o, float) and o.is_integer(): return int(o)
            if isinstance(o, dict): return {k: ints(v) for k, v in o.items()}
            if isinstance(o, list): return [ints(v) for v in o]
            return o
        norm = lambda o: json.dumps(ints(o), sort_keys=True)
        for e in want["firmwares"]:
            for key, v in e.items():
                self.assertEqual(norm(by[e["id"]].get(key)), norm(v), f"{e['id']}.{key} changed")


if __name__ == "__main__":
    unittest.main()
