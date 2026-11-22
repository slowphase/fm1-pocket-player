#!/usr/bin/env python3
"""Report-only qualification. Local inputs/outputs only; no network or publishing code.

The existing emu/catalog.py builds the candidate. This layer applies the approved
visibility/delivery policy without deleting or editing any internal firmware record.
It is deliberately NOT called by pocket-sync.yml.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def repository(url):
    u = urlsplit(url or "")
    parts = u.path.strip("/").split("/")
    return "/".join(parts[:2]).removesuffix(".git").lower() if u.hostname == "github.com" and len(parts) >= 2 else ""


def holds_for(f, platform, policy, repository_id=None):
    repos = {repository(f.get("source")), repository((f.get("emu", {}).get("package") or {}).get("url"))} - {""}
    ids = {f["id"], f.get("provenance", {}).get("hub", {}).get("id")}
    sha = (f.get("emu", {}).get("package") or {}).get("sha256")
    return [h["reason"] for h in policy["holds"] if platform in h["platforms"] and
            (ids.intersection(h["ids"]) or h.get("repository", "").lower() in repos or
             (repository_id and h.get("repositoryId") == repository_id) or (sha and h.get("sha256") == sha))]


def open_licence(value):
    # Same accepted licence family as the existing package hosting check. A label
    # alone never authorises NEW web hosting: the exact-delivery gate below also applies.
    labels = [s.strip() for s in re.split(r"\s+(?:AND|OR)\s+|[()]", value or "") if s.strip()]
    pattern = r"(?:GPL-[23]\.0(?:-only|-or-later)?|LGPL-[23]\.[01](?:-only|-or-later)?|AGPL-3\.0(?:-only|-or-later)?|MPL-2\.0|MIT|BSD-[23]-Clause|Apache-2\.0|ISC|Zlib|CC0-1\.0|0BSD|OFL-1\.1|Unlicense|FTL)"
    return bool(labels) and all(re.fullmatch(pattern, s) for s in labels)


def route(f, platform, engine, policy, approvals, deliveries, emu_commit):
    em = f.get("emu") or {}
    pkg = em.get("package") or {}
    status = (em.get(platform) if engine == "fm1-emu" else f.get("status", {}).get(platform)) or {}
    sha = pkg.get("sha256") if engine == "fm1-emu" else f.get("sha256")
    hub_id = f.get("provenance", {}).get("hub", {}).get("id") or f["id"]
    proof = deliveries.get(hub_id + ":maker:" + (sha or "")) or deliveries.get(hub_id + ":maker") or {}
    reasons = holds_for(f, platform, policy, proof.get("repositoryId"))
    if f.get("restriction", {}).get("code") in ("restricted", "withdrawn") or em.get("excluded"):
        reasons.append("Existing production restriction remains in force.")
    if status.get("state") != "playable": reasons.append("No passing playable result on this platform.")
    if f.get("knownIssues", {}).get(platform, {}).get(engine): reasons.append("Unresolved known issue on this engine.")
    tested = status.get("tested") or {}
    if not sha or tested.get("sha256") != sha: reasons.append("No test bound to this exact package fingerprint.")
    if engine == "rfm1":
        approval = approvals.get(f["id"], {})
        if not f.get("file") or approval.get("license") != f.get("license"):
            reasons.append("RemoteFM1FW approval gate not satisfied for this ID/licence.")
        standard_pass = tested.get("outcome") == "pass"
        waiver = policy.get("retainedNonSoundExceptions", {}).get(f["id"])
        evidence = deliveries.get(f["id"] + ":rfm1-tests") or {}
        run = evidence.get(platform) or {}; result = run.get("result") or {}
        # Preserve an existing display-only allowance when the exact raw test
        # actually made sound. Never infer musical playback from a silence waiver.
        if waiver == ["redraw"] and evidence.get("sha256") == sha and run.get("runtime") == tested.get("runtime") and \
                run.get("outcome") == "pass-with-exception" and result.get("sounds") is True and result.get("draws") is True and not result.get("halted"):
            standard_pass = True
        if not standard_pass: reasons.append("The standard playback check did not pass (a silence waiver is not qualification).")
    else:
        url = urlsplit(pkg.get("url") or "")
        source = pkg.get("source") or f.get("source")
        if url.scheme != "https" or url.hostname != "github.com" or "/releases/download/" not in url.path or not repository(source):
            reasons.append("No accepted original GitHub release package/source.")
        if not open_licence(pkg.get("license") or f.get("license")):
            reasons.append("No recognised clear-use licence label; exclude rather than infer permission.")
        if tested.get("engine") != "fm1-emu@" + emu_commit[:12]: reasons.append("Test engine differs from the pinned engine.")
        speed = tested.get("speed")
        if not isinstance(speed, (int, float)) or speed < 1.2: reasons.append("Missing or insufficient measured speed.")
        if not proof.get("releaseAvailable") or not proof.get("sourceAvailable"):
            reasons.append("Active maker release and source have not been confirmed.")
        if platform == "mac":
            fetched = proof
            if fetched.get("sha256") != sha or not fetched.get("verifiedBytes"):
                reasons.append("Maker delivery has not been byte-verified for this exact package.")
    if platform == "web":
        file = pkg.get("file") if engine == "fm1-emu" else f.get("file")
        key = f["id"] + ":" + engine
        clearance = deliveries.get(key) or {}
        if not file or clearance.get("sha256") != sha or clearance.get("file") != file or not clearance.get("verifiedBytes"):
            reasons.append("No previously accepted, byte-verified web delivery for this exact package; new hosting clearance required.")
    result = {"eligible": not reasons, "sha256": sha, "reasons": list(dict.fromkeys(reasons)), "status": status}
    if engine == "fm1-emu" and pkg: result["package"] = pkg
    return result


def evaluate(f, policy, approvals, deliveries, emu_commit):
    out = {}
    for platform in ("mac", "web"):
        routes = {e: route(f, platform, e, policy, approvals, deliveries, emu_commit) for e in ("rfm1", "fm1-emu")}
        engines = [e for e, r in routes.items() if r["eligible"]]
        out[platform] = {"visible": bool(engines), "engines": engines, "routes": routes}
    return out


def old_visible(f, platform, include_experimental=True):
    states = ("playable", "experimental") if include_experimental else ("playable",)
    em = f.get("emu") or {}; pkg = em.get("package") or {}
    return bool((f.get("file") and f.get("sha256") and f.get("status", {}).get(platform, {}).get("state") in states) or
                (not em.get("excluded") and pkg.get("sha256") and pkg.get("file" if platform == "web" else "url") and em.get(platform, {}).get("state") in states))


def report(before, candidate, policy, approvals, deliveries, emu_commit):
    assert policy["mode"] == "report-only" and policy["remoteApprovalGate"] == "required"
    old = {f["id"]: f for f in before["firmwares"]}
    fresh = {f["id"]: f for f in candidate["firmwares"]}
    assert old.keys() == fresh.keys(), "Internal records/IDs must not be added or removed by qualification"
    mutable = {"emu", "confidence", "knownIssues", "listened", "image", "imageKind"}
    for id, f in fresh.items():
        assert {k:v for k,v in old[id].items() if k not in mutable} == {k:v for k,v in f.items() if k not in mutable}, "Protected fields changed: " + id
    projected = copy.deepcopy(candidate)
    decisions, fallbacks = {}, []
    for f in projected["firmwares"]:
        d = evaluate(f, policy, approvals, deliveries, emu_commit)
        # Retain each last-good permitted route, without replacing the newer
        # record or deleting another engine. This is a proposal, never a write to production.
        previous = evaluate(old[f["id"]], policy, approvals, deliveries, emu_commit)
        for platform in ("mac", "web"):
            for engine in ("rfm1", "fm1-emu"):
                if not d[platform]["routes"][engine]["eligible"] and previous[platform]["routes"][engine]["eligible"]:
                    d[platform]["routes"][engine] = {**previous[platform]["routes"][engine], "lastGood": True}
                    d[platform]["engines"].append(engine)
                    d[platform]["visible"] = True
                    fallbacks.append({"id": f["id"], "platform": platform, "engine": engine})
        decisions[f["id"]] = d
        f["qualification"] = d
    summaries = {}
    for platform in ("mac", "web"):
        visible = [f for f in projected["firmwares"] if decisions[f["id"]][platform]["visible"]]
        baseline = [f for f in before["firmwares"] if old_visible(f, platform, False)]
        ids = {f["id"] for f in visible}; base = {f["id"] for f in baseline}
        summaries[platform] = {"browseableBefore": len(old), "runnableBeforeIncludingExperimental": sum(old_visible(f, platform) for f in old.values()),
            "playableLabelBefore": len(baseline), "visibleAfter": len(visible), "hiddenAfter": len(old)-len(visible),
            "addedToPlayable": [{"id": i, "name": old[i]["name"]} for i in sorted(ids-base)],
            "removedFromPlayable": [{"id": i, "name": old[i]["name"]} for i in sorted(base-ids)],
            "visibleIDs": sorted(ids)}
    return {"schema": 1, "mode": "report-only", "counts": summaries, "decisions": decisions,
            "lastGoodRoutes": fallbacks, "internalRecords": len(old), "protectedFieldsUnchanged": True,
            "policySHA256": fingerprint(policy), "beforeSHA256": fingerprint(before),
            "testScope": policy["testScope"], "productionWrites": 0}, projected


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("before", "candidate", "deliveries", "out"): p.add_argument("--"+name, required=True)
    p.add_argument("--policy", default="pocket/qualification-policy.json")
    p.add_argument("--approvals", default="pocket/policy.json")
    a = p.parse_args()
    load = lambda path: json.loads(Path(path).read_text())
    policy, production = load(a.policy), load(a.approvals)
    for id, checks in policy.get("retainedNonSoundExceptions", {}).items():
        assert checks == production.get("smokeExceptions", {}).get(id, {}).get("checks") and "sound" not in checks, "Only an existing non-sound allowance may be retained"
    result, projected = report(load(a.before), load(a.candidate), policy, production["approved"],
        load(a.deliveries), load(Path(__file__).parent / "emu/upstream.json")["commit"])
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    (out/"qualification-report.json").write_text(json.dumps(result, indent=2)+"\n")
    # Local preview only; internal records remain complete. Never passed to a publishing command.
    (out/"catalog-v2.proposed.json").write_text(json.dumps(projected, indent=1)+"\n")
    print(json.dumps({"mode": result["mode"], "counts": {k:{x:v for x,v in c.items() if x != "visibleIDs"} for k,c in result["counts"].items()}}, indent=2))


if __name__ == "__main__": main()
