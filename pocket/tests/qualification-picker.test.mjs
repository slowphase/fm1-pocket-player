import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/pocket-picker.js", import.meta.url), "utf8");
async function load(firmwares, stored = {}) {
  const window = { Fm1Emu: {} }, before = JSON.stringify(stored);
  const context = { window, localStorage: { getItem: k => stored[k] ?? null, setItem: () => assert.fail("loading must preserve stored user data") },
    fetch: async () => ({ ok: true, json: async () => ({ schema: 2, firmwares }) }) };
  vm.runInNewContext(source, context);
  const entries = await window.FM1Pocket.load();
  assert.equal(JSON.stringify(stored), before);
  return JSON.parse(JSON.stringify(entries));
}
function fw(id, rfm = "playable", emu = "experimental") {
  return { id, name: id, file: "fw/"+id+".rfm1", sha256: "a".repeat(64), status: { web: { state: rfm } },
    emu: { package: { file: "pkg/"+id+".fwsc", sha256: "b".repeat(64) }, web: { state: emu } } };
}

test("option B hides unqualified entries and keeps the passing alternative without changing favourites", async () => {
  const a = fw("a", "experimental", "playable"), b = fw("b", "experimental", "experimental");
  const c = fw("c"); c.knownIssues = { web: { rfm1: "known broken" } };
  const result = await load([a,b,c], { "pocket.favs": '["b"]', "pocket.engine": '{"a":"rfm1"}' });
  assert.deepEqual(result.map(e => [e.meta.id,e.engine]), [["a","fm1-emu"]]);
});

test("qualification holds override passing labels and last-good playback uses its pinned bytes", async () => {
  const held = fw("held"); held.qualification = { web: { visible: false, engines: [], routes: {} } };
  const good = fw("good", "experimental", "experimental");
  good.qualification = { web: { visible: true, engines: ["fm1-emu"], routes: { "fm1-emu": {
    eligible: true, sha256: "c".repeat(64), lastGood: true, package: { file: "pkg/last-good.fwsc", sha256: "c".repeat(64) }, status: { state: "playable" }
  } } } };
  const result = await load([held,good]);
  assert.equal(result.length, 1); assert.equal(result[0].url, "data/pkg/last-good.fwsc");
  assert.equal(result[0].sha256, "c".repeat(64));
});

test("an uncertain platform decision hides only that entry", async () => {
  const missing = fw("missing"); missing.qualification = {};
  const malformed = fw("malformed"); malformed.qualification = { web: { visible: true, engines: ["rfm1"] } };
  const result = await load([missing, malformed, fw("good")]);
  assert.deepEqual(result.map(e => e.meta.id), ["good"]);
});
