// The golden catalogue baseline (pocket/tests/golden/README.md): discover.mjs must turn the recorded inputs of the
// 21 Nov 2026 nightly into exactly the catalogue that night published, for all 285 existing firmwares.
import { test } from "node:test";
import assert from "node:assert/strict";
import { read, goldenBuild, assertBaselineKept, canonical } from "./golden/golden.mjs";

test("golden: the recorded inputs still make exactly the published catalogue", () => {
  const want = read("discover-expected.json.gz");
  const got = goldenBuild();
  assert.equal(got.firmwares.length, 285);
  assert.equal(canonical(got), canonical(want));
});

test("golden: the order of the sources' lists does not matter", () => {
  const inp = read("discover-inputs.json.gz");
  const rev = (a) => [...a].reverse();
  const got = goldenBuild({
    upstream: { ...inp.upstream, items: rev(inp.upstream.items) },
    hub: { ...inp.hub, catalog: { ...inp.hub.catalog, firmwares: rev(inp.hub.catalog.firmwares) } },
    v1: { ...inp.v1, firmwares: rev(inp.v1.firmwares) },
  });
  assert.deepEqual(assertBaselineKept(got, read("discover-expected.json.gz")), []);
});

test("golden: the baseline check catches a changed or missing entry", () => {
  const want = read("discover-expected.json.gz");
  const got = goldenBuild();
  got.firmwares[0] = { ...got.firmwares[0], name: "Something else" };
  assert.throws(() => assertBaselineKept(got, want), /changed/);
  got.firmwares.pop();
  assert.throws(() => assertBaselineKept(got, want), /missing|changed/);
});
