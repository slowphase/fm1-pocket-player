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


if __name__ == "__main__":
    unittest.main()
