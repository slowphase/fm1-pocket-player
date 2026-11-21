// FM1 Editor reconciliation (Phase 2): identity by repository plus the alias table, never by name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshot } from "../editor.mjs";
import { reconcile, markdown, pocketRepositories } from "../reconcile.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const gz = (f) => JSON.parse(gunzipSync(readFileSync(f)).toString());
// the golden catalogue (21 Nov 2026, 285 firmwares) and the Editor's page at c017be1 (431 entries), both recorded
const CATALOGUE = gz(join(here, "golden", "discover-expected.json.gz"));
const DIRECTORY = snapshot({
  html: gunzipSync(readFileSync(join(here, "fixtures", "fm1-editor-c017be1.html.gz"))).toString(),
  licenceText: readFileSync(join(here, "fixtures", "fm1-editor-LICENSE"), "utf8"),
  commit: "c017be1c6b34213f794c2c5b4afc8bab808a6a78", committed: "2026-11-21T12:46:05Z", checked: "2026-11-21T13:00:00Z",
});
const ALIASES = JSON.parse(readFileSync(join(here, "..", "editor-aliases.json"), "utf8"));
const R = reconcile(CATALOGUE, DIRECTORY, ALIASES);

test("reconcile: the recorded sources give the counts the investigation found", () => {
  assert.equal(R.counts.editor, 431);
  assert.equal(R.counts.pocket, 285);
  assert.equal(R.counts.editorMatched, 271);
  assert.equal(R.counts.pocketMatched, 272);
  assert.equal(R.counts.ambiguous, 0);
  assert.equal(R.counts.new, 160);
  assert.equal(R.counts.pocketOnly, 13);
  assert.deepEqual(R.problems, []);
  assert.deepEqual(R.pocketOnly.map((x) => x.id).sort(),
    ["aetherfm1", "assid", "aurora", "blop", "dubwise", "elasticat", "felucca8", "minigrain", "modularkoi", "sloop3", "sq80", "vector37", "viscera"]);
});

test("reconcile: every Pocket firmware and every Editor entry is accounted for exactly once", () => {
  const editorKeys = [...R.matched.map((x) => x.key), ...R.ambiguous.map((x) => x.key), ...R.new.map((x) => x.key)];
  assert.equal(editorKeys.length, 431);
  assert.equal(new Set(editorKeys).size, 431);
  const covered = new Set(R.matched.flatMap((x) => x.pocket));
  for (const fw of CATALOGUE.firmwares) assert.ok(covered.has(fw.id) !== R.pocketOnly.some((x) => x.id === fw.id), fw.id);
});

test("reconcile: Hortator's one repository stays two Pocket firmwares, through the alias pair", () => {
  assert.deepEqual(R.matched.find((x) => x.key === "hortator").pocket, ["hortator", "hortator-bt"]);
  const without = reconcile(CATALOGUE, DIRECTORY, { ...ALIASES, pairs: {} });
  assert.deepEqual(without.ambiguous.map((x) => x.key), ["hortator"], "without the pair it is ambiguous, and never added as new");
  assert.ok(!without.new.some((x) => x.key === "hortator"));
});

test("reconcile: GLITCH is a new entry with its own id, never Pocket's glitch (GR!MM)", () => {
  const g = R.new.find((x) => x.key === "glitch");
  assert.equal(g.repository, "ttreu/fm1-glitch");
  assert.equal(g.id, "glitch-ttreu");
  assert.ok(!R.matched.some((x) => x.pocket.includes("glitch") && x.key === "glitch"));
});

test("reconcile: new ids never collide with Pocket ids or each other, and frozen ids are kept", () => {
  const pocket = new Set(CATALOGUE.firmwares.map((f) => f.id));
  const ids = R.new.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(!pocket.has(id), id);
  const frozen = reconcile(CATALOGUE, DIRECTORY, { ...ALIASES, ids: { "opx": "felucca-opx" } });
  assert.equal(frozen.new.find((x) => x.key === "opx").id, "felucca-opx");
  assert.equal(frozen.new.find((x) => x.key === "opx").frozen, true);
});

test("reconcile: names never match, only repositories (and a moved repository through the table)", () => {
  const fw = { id: "x", name: "386DX", source: "https://github.com/someone-else/elsewhere" };
  const dir = { entries: [{ key: "386dx", name: "386DX", repository: "seajaysec/386-dx-fm1-karaokebot", repositories: ["seajaysec/386-dx-fm1-karaokebot"] }] };
  assert.equal(reconcile({ firmwares: [fw] }, dir).counts.new, 1, "same name, different repository: not a match");
  const moved = reconcile({ firmwares: [fw] }, dir, { repositories: { "someone-else/elsewhere": "seajaysec/386-dx-fm1-karaokebot" } });
  assert.equal(moved.counts.editorMatched, 1);
  assert.deepEqual(pocketRepositories({ source: "https://github.com/A/B.git", provenance: { hub: { release: "https://github.com/a/b/releases/tag/v1" } } }), ["a/b"]);
});

test("reconcile: h1, built into the players, is matched by repository and never added (the 159 the investigation found)", () => {
  const r = reconcile(CATALOGUE, DIRECTORY, ALIASES, { builtIn: [{ id: "h1", repositories: ["jakehandy/h1"] }] });
  assert.deepEqual(r.builtIn.map((x) => x.key), ["h1"]);
  assert.equal(r.counts.new, 159);
  assert.ok(!r.new.some((x) => x.key === "h1"));
});

test("reconcile: an Editor entry listed before under its own id keeps it, and is reported when Pocket picks it up", () => {
  const prev = { firmwares: [{ id: "glitch-ttreu", name: "GLITCH", provenance: { editor: { key: "glitch" } } }] };
  const r = reconcile(CATALOGUE, DIRECTORY, { ...ALIASES, distinct: {} }, { published: { glitch: "glitch-ttreu" } });
  assert.equal(r.new.find((x) => x.key === "glitch").id, "glitch-ttreu");
  const picked = { firmwares: [...CATALOGUE.firmwares, { id: "glitch2", name: "GLITCH", source: "https://github.com/ttreu/fm1-glitch" }, ...prev.firmwares] };
  const p = reconcile(picked, DIRECTORY, ALIASES, { published: { glitch: "glitch-ttreu" } });
  assert.deepEqual(p.promoted, [{ key: "glitch", name: "GLITCH", was: "glitch-ttreu", pocket: ["glitch2"] }]);
});

test("reconcile: a stale alias is reported, and the markdown report has the summary", () => {
  const stale = reconcile(CATALOGUE, DIRECTORY, { ...ALIASES, pairs: { ...ALIASES.pairs, gone: ["nope"] } });
  assert.ok(stale.problems.some((p) => /gone/.test(p)));
  const md = markdown(R);
  assert.match(md, /\| New, listing-only candidates \| 160/);
  assert.match(md, /GLITCH \(glitch\): Pocket already uses "glitch"/);
});
