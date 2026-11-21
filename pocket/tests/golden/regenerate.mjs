#!/usr/bin/env node
// Rewrites the golden expected files from their recorded inputs with the current code. Only for an intended change
// to existing entries; explain the difference in the pull request (see README.md here).
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { goldenBuild, canonical } from "./golden.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(gunzipSync(readFileSync(join(here, f))).toString());
const write = (f, o) => writeFileSync(join(here, f), gzipSync(Buffer.from(canonical(o)), { level: 9 }));
const v2 = goldenBuild();
write("discover-expected.json.gz", v2);
const t = mkdtempSync(join(tmpdir(), "golden-"));
writeFileSync(join(t, "v2.json"), JSON.stringify(v2));
// the emulator layer's inputs go through Python exactly as the test passes them (JavaScript would write 3.0 as 3)
execFileSync("python3", ["-c", `
import gzip, json, sys
g, t = sys.argv[1], sys.argv[2]
emu = json.load(gzip.open(g + "/emu-inputs.json.gz"))
json.dump(emu["packages"], open(t + "/packages.json", "w")); json.dump(emu["emuLedger"], open(t + "/emu.json", "w"))
json.dump(json.load(gzip.open(g + "/discover-inputs.json.gz"))["ledger"], open(t + "/compat.json", "w"))`, here, t]);
execFileSync("python3", [join(here, "..", "..", "emu", "catalog.py"), "--v2", join(t, "v2.json"), "--packages", join(t, "packages.json"),
  "--emu-ledger", join(t, "emu.json"), "--rfm1-ledger", join(t, "compat.json")], { stdio: "inherit" });
write("emu-expected.json.gz", JSON.parse(readFileSync(join(t, "v2.json"), "utf8")));
console.log("Golden expected files rewritten.");
