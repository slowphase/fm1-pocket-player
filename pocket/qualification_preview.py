#!/usr/bin/env python3
"""Keep downloadable CI web previews inside the same accepted delivery boundary.

Only edits the local preview package manifest and a temporary policy copy. The
production policy, snapshots and qualification report are never modified.
"""
import argparse
import copy
import json
from pathlib import Path


def restrict(packages, deliveries, safeguards, production):
    packages, policy = copy.deepcopy(packages), copy.deepcopy(production)
    allowed = {v["sha256"] for k,v in deliveries.items() if k.endswith(":fm1-emu")}
    held = []
    for row in packages["firmwares"]:
        if row.get("status") != "found": continue
        hold = next((h for h in safeguards["holds"] if "web" in h["platforms"] and
            (row["hub"] in h["ids"] or str(row.get("repo", "")).lower() == h.get("repository", "").lower() or
             row.get("sha256") == h.get("sha256"))), None)
        if hold:
            row["status"] = "qualification web hold: " + hold["reason"]
            policy.setdefault("excluded", {})[row["hub"]] = hold["reason"]
        elif row.get("sha256") not in allowed:
            row["status"] = "qualification web hold: new hosting is not cleared for this exact package"
        else: continue
        held.append({"id": row["hub"], "sha256": row.get("sha256"), "reason": row["status"]})
    return packages, policy, held


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--packages", required=True)
    p.add_argument("--out", required=True)
    a = p.parse_args(); root = Path(__file__).resolve().parent
    load = lambda f: json.loads(Path(f).read_text())
    packages, policy, held = restrict(load(a.packages), load(root/"qualification-deliveries.json"),
        load(root/"qualification-policy.json"), load(root/"policy.json"))
    Path(a.packages).write_text(json.dumps(packages, indent=1)+"\n")
    Path(a.out).write_text(json.dumps(policy, indent=2)+"\n")
    Path(a.out).with_suffix(".holds.json").write_text(json.dumps(held, indent=2)+"\n")
    print(f"Web preview: {len(held)} uncleared packages withheld; production policy unchanged.")
