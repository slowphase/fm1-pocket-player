// Shared by pocket/tests/golden.test.mjs and regenerate.mjs: the recorded inputs, the build, and the baseline check.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../discover.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const read = (f) => JSON.parse(gunzipSync(readFileSync(join(here, f))).toString());
const policy = JSON.parse(readFileSync(join(here, "..", "..", "policy.json"), "utf8"));
// key order does not matter, values do
export const canonical = (o) => JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));

export function goldenBuild(extra = {}) {
  const inp = read("discover-inputs.json.gz");
  return build({ v1: inp.v1, upstream: inp.upstream, report: inp.report, policy, ledger: inp.ledger, hub: inp.hub,
                 previous: inp.previous, releases: inp.releases, now: new Date(inp.now), ...extra });
}

// every baseline entry is still there, with every field it had, unchanged; returns the entries not in the baseline
export function assertBaselineKept(actual, expected) {
  const got = new Map(actual.firmwares.map((e) => [e.id, e]));
  for (const want of expected.firmwares) {
    const e = got.get(want.id);
    assert.ok(e, `${want.id} is missing`);
    for (const [k, v] of Object.entries(want)) assert.equal(canonical(e[k]), canonical(v), `${want.id}.${k} changed`);
  }
  const ids = new Set(expected.firmwares.map((e) => e.id));
  return actual.firmwares.filter((e) => !ids.has(e.id));
}

