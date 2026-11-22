#!/usr/bin/env python3
"""Read existing public evidence, verify bytes, and produce local previews only.

No Hub/Editor discovery requests, source execution, approval changes, issue writes,
release uploads, tags or deployment commands. Intended for the PR report job.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.request
from urllib.parse import quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://slowphase.github.io/fm1-pocket-player/"
RELEASE = "https://github.com/slowphase/fm1-pocket-player/releases/download/"


def fetch(url):
    headers = {"User-Agent": "FM1-Pocket-report-only", "Cache-Control": "no-cache"}
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token and urlsplit(url).hostname == "api.github.com": headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as response: return response.read()


def run(out):
    out.mkdir(parents=True, exist_ok=True)
    evidence = out/"evidence"; evidence.mkdir(exist_ok=True)
    store = evidence/"store"; store.mkdir(exist_ok=True)
    for name, url in {
        "published-catalog-v2.json": SITE+"data/catalog-v2.json",
        "packages.json": RELEASE+"pocket-packages/packages.json",
        "emu-compat.json": RELEASE+"pocket-packages/emu-compat.json",
        "compat.json": RELEASE+"pocket-current/compat.json",
        "hub-catalog.json": RELEASE+"pocket-current/hub-catalog.json",
    }.items(): (evidence/name).write_bytes(fetch(url))
    before = json.loads((evidence/"published-catalog-v2.json").read_text())
    packages = json.loads((evidence/"packages.json").read_text())
    deliveries = json.loads((ROOT/"pocket/qualification-deliveries.json").read_text())
    # Frozen delivery permissions: a later publication or a licence label alone
    # must never enrol a new package into the web allow-list.
    def verify_delivery(item):
        key, record = item
        try: ok = hashlib.sha256(fetch(SITE+"data/"+record["file"])).hexdigest() == record["sha256"]
        except Exception: ok = False
        return key, {**record, "verifiedBytes": ok}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        deliveries = dict(pool.map(verify_delivery, deliveries.items()))
    checks = []
    def verify_package(p):
        name = p["hub"]+"-"+p["sha256"][:8]+".fwsc"
        metadata = {}
        try:
            assert re.fullmatch(r"[A-Za-z0-9_-]+", p["hub"]) and re.fullmatch(r"[a-f0-9]{64}", p["sha256"]), "unsafe package identity"
            u = urlsplit(p["url"])
            assert u.scheme == "https" and u.hostname == "github.com", "not a maker GitHub asset"
            repo, rest = u.path.lstrip("/").split("/releases/download/", 1)
            tag, asset = rest.split("/", 1)
            base = "https://api.github.com/repos/"+repo
            release = json.loads(fetch(base+"/releases/tags/"+quote(unquote(tag), safe="")))
            assert not release.get("draft") and any(a["name"] == unquote(asset) for a in release.get("assets", [])), "asset is not in an active release"
            source = json.loads(fetch(base+"/commits/"+quote(unquote(tag), safe="")))
            project = json.loads(fetch(base))
            metadata = {"releaseAvailable": True, "sourceAvailable": bool(source.get("commit", {}).get("tree", {}).get("sha")),
                "sourceCommit": source.get("sha"), "repositoryId": project.get("id"), "releaseId": release.get("id")}
            raw = fetch(p["url"]); actual = hashlib.sha256(raw).hexdigest()
            ok = actual == p["sha256"]
            if ok: (store/name).write_bytes(raw)
            error = None if ok else "fingerprint mismatch"
        except Exception as e: ok = False; actual = None; error = str(e)
        return {"id": p["hub"], "sha256": p["sha256"], "verified": ok, "actualSHA256": actual, "error": error, **metadata}
    originals = [p for p in packages["firmwares"] if p.get("status") == "found"]
    # Also check the last-good original URL, rather than assuming an old asset
    # still exists just because its earlier test passed.
    seen = {(p["hub"], p["sha256"]) for p in originals}
    for f in before["firmwares"]:
        pkg = f.get("emu", {}).get("package") or {}
        hub = f.get("provenance", {}).get("hub", {}).get("id") or f["id"]
        if pkg.get("url") and (hub, pkg["sha256"]) not in seen:
            originals.append({"hub": hub, "sha256": pkg["sha256"], "url": pkg["url"]})
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        checks = list(pool.map(verify_package, originals))
    for check in checks:
        deliveries[check["id"]+":maker:"+check["sha256"]] = {**check, "verifiedBytes": check["verified"]}
    (evidence/"package-byte-checks.json").write_text(json.dumps(checks, indent=2)+"\n")
    (evidence/"delivery-baseline.json").write_text(json.dumps(deliveries, indent=2)+"\n")
    candidate = out/"catalog-v2.candidate.json"
    shutil.copyfile(evidence/"published-catalog-v2.json", candidate)
    subprocess.run([sys.executable, "-B", str(ROOT/"pocket/emu/catalog.py"), "--v2", str(candidate),
        "--packages", str(evidence/"packages.json"), "--emu-ledger", str(evidence/"emu-compat.json"),
        "--rfm1-ledger", str(evidence/"compat.json"), "--store", str(store)], check=True, cwd=ROOT)
    subprocess.run([sys.executable, "-B", str(ROOT/"pocket/qualify.py"), "--before", str(evidence/"published-catalog-v2.json"),
        "--candidate", str(candidate), "--deliveries", str(evidence/"delivery-baseline.json"), "--out", str(out)], check=True, cwd=ROOT)
    # An independent source read ensures this run did not change production and
    # flags concurrent nightly changes instead of comparing unrelated snapshots.
    same = fetch(SITE+"data/catalog-v2.json") == (evidence/"published-catalog-v2.json").read_bytes()
    (out/"run-integrity.json").write_text(json.dumps({"mode": "report-only", "publishedBytesUnchangedDuringRun": same,
        "productionWrites": 0, "firmwareHubRequests": 0, "editorRequests": 0,
        "byteChecks": len(checks), "failedByteChecks": [c for c in checks if not c["verified"]],
        "permissionsFileSHA256": hashlib.sha256((ROOT/"pocket/qualification-deliveries.json").read_bytes()).hexdigest()}, indent=2)+"\n")
    if not same: raise RuntimeError("Published snapshot changed during this read-only run: compare again before relying on counts")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", required=True)
    run(Path(p.parse_args().out).resolve())
