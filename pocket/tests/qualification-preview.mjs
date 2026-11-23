// Exercise the real picker loader against a report-only catalogue, without a
// server or firmware execution. Usage: node ... CATALOGUE REPORT
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const catalogue = JSON.parse(readFileSync(process.argv[2], "utf8"));
const report = JSON.parse(readFileSync(process.argv[3], "utf8"));
const window = { Fm1Emu: {} };
const context = { window, localStorage: { getItem: k => k === "pocket.favs" ? '["shifl","noizdemons"]' : null,
    setItem: () => assert.fail("preview must not alter favourites, saves or preferences") },
  fetch: async () => ({ ok: true, json: async () => catalogue }) };
vm.runInNewContext(readFileSync(new URL("../../src/pocket-picker.js", import.meta.url), "utf8"), context);
const entries = await window.FM1Pocket.load();
assert.deepEqual(Array.from(entries, e => e.meta.id).sort(), report.counts.web.visibleIDs);
for (const entry of entries) {
  const route = entry.meta.qualification.web.routes[entry.engine];
  assert.ok(route.eligible);
  assert.equal(entry.sha256, route.sha256, "last-good playback must use its own pinned package");
}
assert.equal(catalogue.firmwares.length, report.internalRecords);
console.log(`Web preview passed: ${entries.length} visible; all ${report.internalRecords} internal records retained; stored user data unchanged.`);
