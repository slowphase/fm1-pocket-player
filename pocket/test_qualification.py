"""Safety cases for report-only policy; no network, engines or production writes."""
import copy
import json
from pathlib import Path
import unittest
from qualify import evaluate, report

POLICY = json.loads(Path(__file__).with_name("qualification-policy.json").read_text())
COMMIT = "09aeae3e9d78db52c3b9f5ceed93bd1120ccf444"
SHA = "a" * 64


def firmware(id="sample"):
    tested = {"sha256": SHA, "engine": "fm1-emu@"+COMMIT[:12], "speed": 2, "soundFrom": ["keys", "midi"]}
    return {"id": id, "name": id, "license": "GPL-3.0", "source": "https://github.com/maker/sample",
        "emu": {"package": {"url": "https://github.com/maker/sample/releases/download/v1/sample.fwsc", "sha256": SHA,
            "source": "https://github.com/maker/sample/tree/v1", "license": "GPL-3.0", "file": "pkg/sample.fwsc"},
            "mac": {"state": "playable", "tested": tested}, "web": {"state": "playable", "tested": tested}}}


def deliveries(id="sample"):
    return {id+":fm1-emu": {"sha256": SHA, "file": "pkg/sample.fwsc", "verifiedBytes": True},
            id+":maker": {"sha256": SHA, "verifiedBytes": True, "releaseAvailable": True, "sourceAvailable": True}}


class QualificationTests(unittest.TestCase):
    def verdict(self, f, delivery=None):
        return evaluate(f, POLICY, {}, deliveries(f["id"]) if delivery is None else delivery, COMMIT)

    def test_all_five_holds_and_platform_scope(self):
        for id in ("araminta", "shifl"):
            d = self.verdict(firmware(id))
            self.assertFalse(d["mac"]["visible"]); self.assertFalse(d["web"]["visible"])
        for id in ("basssomething2", "sillage", "volna"):
            d = self.verdict(firmware(id))
            self.assertTrue(d["mac"]["visible"]); self.assertFalse(d["web"]["visible"])

    def test_repository_alias_and_hash_cannot_bypass_hold(self):
        f = firmware("renamed"); f["source"] = "https://github.com/SCHWARTZWORLD/shifl"
        self.assertFalse(self.verdict(f)["mac"]["visible"])
        f = firmware("different-name"); f["emu"]["package"]["sha256"] = POLICY["holds"][1]["sha256"]
        self.assertFalse(self.verdict(f)["mac"]["visible"])

    def test_repository_identity_and_missing_source_fail_closed(self):
        f = firmware("new-id")
        d = deliveries("new-id")
        d["new-id:maker"]["repositoryId"] = POLICY["holds"][1]["repositoryId"]
        self.assertFalse(self.verdict(f, d)["mac"]["visible"])
        d["new-id:maker"].pop("repositoryId")
        d["new-id:maker"]["sourceAvailable"] = False
        self.assertFalse(self.verdict(f, d)["mac"]["visible"])

    def test_new_web_hosting_is_not_authorised_by_licence_or_playback(self):
        d = self.verdict(firmware(), {"sample:maker": {"sha256": SHA, "verifiedBytes": True, "releaseAvailable": True, "sourceAvailable": True}})
        self.assertTrue(d["mac"]["visible"]); self.assertFalse(d["web"]["visible"])

    def test_experimental_unknown_and_stale_tests_fail_closed(self):
        for change in ("experimental", "unknown", "stale", "issue", "missing-speed", "restriction"):
            f = firmware()
            if change in ("experimental", "unknown"): f["emu"]["mac"]["state"] = change
            elif change == "stale": f["emu"]["mac"]["tested"]["sha256"] = "b"*64
            elif change == "issue": f["knownIssues"] = {"mac": {"fm1-emu": "known problem"}}
            elif change == "restriction": f["emu"]["excluded"] = "SLOOP restriction"
            else: f["emu"]["mac"]["tested"].pop("speed")
            self.assertFalse(self.verdict(f)["mac"]["visible"], change)

    def test_rfm1_gate_and_good_alternative_engine(self):
        f = firmware(); f.update(file="fw/sample.rfm1", sha256=SHA)
        f["status"] = {"mac": {"state": "playable", "tested": {"sha256": SHA, "outcome": "pass"}}}
        f["emu"]["mac"]["state"] = "experimental"
        self.assertFalse(self.verdict(f)["mac"]["visible"])
        d = evaluate(f, POLICY, {"sample": {"license": "GPL-3.0"}}, deliveries(), COMMIT)
        self.assertEqual(d["mac"]["engines"], ["rfm1"])
        f["license"] = "MIT"
        self.assertFalse(evaluate(f, POLICY, {"sample": {"license": "GPL-3.0"}}, deliveries(), COMMIT)["mac"]["visible"])

    def test_existing_display_waiver_requires_raw_sound_and_matching_runtime(self):
        f = firmware("rupture"); f.update(file="fw/rupture.rfm1", sha256=SHA)
        f["emu"]["web"]["state"] = "experimental"
        f["status"] = {"web": {"state": "playable", "tested": {"sha256": SHA, "runtime": "rfm1.js@pin", "outcome": "pass-with-exception"}}}
        d = deliveries("rupture")
        d["rupture:rfm1"] = {"sha256": SHA, "file": "fw/rupture.rfm1", "verifiedBytes": True}
        run = {"runtime": "rfm1.js@pin", "outcome": "pass-with-exception", "result": {"sounds": True, "draws": True, "halted": 0}}
        d["rupture:rfm1-tests"] = {"sha256": SHA, "web": run}
        approved = {"rupture": {"license": "GPL-3.0"}}
        self.assertTrue(evaluate(f, POLICY, approved, d, COMMIT)["web"]["visible"])
        run["result"]["sounds"] = False
        self.assertFalse(evaluate(f, POLICY, approved, d, COMMIT)["web"]["visible"])
        run["result"]["sounds"] = True; run["runtime"] = "old-runtime"
        self.assertFalse(evaluate(f, POLICY, approved, d, COMMIT)["web"]["visible"])

    def test_last_good_route_retains_its_own_package_and_all_internal_records(self):
        old = {"firmwares": [firmware()]}; before = copy.deepcopy(old)
        candidate = copy.deepcopy(old); candidate["firmwares"][0]["emu"]["package"]["sha256"] = "b"*64
        result, projected = report(old, candidate, POLICY, {}, deliveries(), COMMIT)
        route = projected["firmwares"][0]["qualification"]["web"]["routes"]["fm1-emu"]
        self.assertTrue(route["lastGood"]); self.assertEqual(route["package"]["sha256"], SHA)
        self.assertEqual(old, before); self.assertEqual(len(projected["firmwares"]), 1)
        self.assertEqual(result["productionWrites"], 0)
        candidate["firmwares"][0]["name"] = "changed"
        with self.assertRaises(AssertionError): report(old, candidate, POLICY, {}, deliveries(), COMMIT)


if __name__ == "__main__": unittest.main()
