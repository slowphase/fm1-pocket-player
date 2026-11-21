// Phase 2: FM1 Editor's listing-only entries in catalog-v2.json, built from the recorded golden inputs (21 Nov 2026)
// and the recorded Editor page (c017be1). Existing entries must stay exactly as the golden baseline has them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { goldenBuild, read, assertBaselineKept, canonical } from "./golden/golden.mjs";
import { snapshot } from "../editor.mjs";
import { RECONCILIATION, fingerprint } from "../discover.mjs";
import { BACKFILL_LISTED, CREDIT, UTILITY_TAG, editorCategory, DESCRIPTIONS, normaliseDescription, MAX_ABOUT } from "../editor-catalogue.mjs";
import { editorOnly } from "../reconcile.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const EDITOR = snapshot({
  html: gunzipSync(readFileSync(join(here, "fixtures", "fm1-editor-c017be1.html.gz"))).toString(),
  licenceText: readFileSync(join(here, "fixtures", "fm1-editor-LICENSE"), "utf8"),
  commit: "c017be1c6b34213f794c2c5b4afc8bab808a6a78", committed: "2026-11-21T12:46:05Z", checked: "2026-11-21T13:00:00Z",
});
const ALIASES = JSON.parse(readFileSync(join(here, "..", "editor-aliases.json"), "utf8"));
const GOLDEN = read("discover-expected.json.gz");
const INPUTS = read("discover-inputs.json.gz");
const withEditor = (extra = {}) => goldenBuild({ editor: EDITOR, editorAliases: ALIASES, ...extra });
const C = withEditor();
const ADDED = assertBaselineKept(C, GOLDEN);
const byId = new Map(C.firmwares.map((e) => [e.id, e]));
const byKey = new Map(ADDED.map((e) => [e.provenance.editor.key, e]));

test("editor catalogue: all 285 existing entries are exactly as before, and 159 listing-only entries are added", () => {
  assert.equal(ADDED.length, 159);
  assert.equal(C.firmwares.length, 285 + 159);
  assert.ok(ADDED.every(editorOnly));
  assert.equal(C.counts.fromEditor, 159);
  assert.equal(C.counts.downloadable, GOLDEN.counts.downloadable, "nothing new is downloadable");
  assert.equal(C.counts.withBuild, GOLDEN.counts.withBuild);
  assert.equal(new Set(C.firmwares.map((e) => e.id)).size, C.firmwares.length, "ids are unique");
});

test("editor catalogue: without an Editor snapshot the catalogue is exactly the golden one", () => {
  assert.equal(canonical(goldenBuild()), canonical(GOLDEN));
  assert.equal(canonical(goldenBuild({ editor: null, editorAliases: ALIASES })), canonical(GOLDEN));
});

test("editor catalogue: every new entry is listing-only, never downloadable, playable or Hub-credited", () => {
  for (const e of ADDED) {
    assert.equal(e.restriction.code, "listing-only", e.id);
    assert.equal(e.status.web.state, "source-only", e.id);
    assert.equal(e.status.mac.state, "source-only", e.id);
    for (const k of ["file", "sha256", "size", "glue", "builtBy", "abi", "image", "emu"]) assert.equal(e[k], undefined, `${e.id}.${k}`);
    assert.equal(e.provenance.hub, undefined, `${e.id} carries no Hub provenance, so no app shows the Hub credit`);
    assert.deepEqual(Object.keys(e.provenance), ["editor"]);
    assert.deepEqual(e.credit, CREDIT);
    assert.equal(e.license, "", "licences come from the Hub or the maker, never the Editor");
    assert.equal(DESCRIPTIONS, true);
    const raw = EDITOR.entries.find((x) => x.key === e.provenance.editor.key).description;
    assert.equal(e.about, normaliseDescription(raw), `${e.id}: the Editor's description, normalised`);
    assert.ok(e.about.length > 50 && e.about.length <= MAX_ABOUT + 1, e.id);
    assert.deepEqual(e.aboutCredit, { text: "Description from FM1 Editor", url: e.provenance.editor.url, license: "MIT", copyright: "Copyright (c) 2026 Ben Sparrow" });
    assert.equal(e.provenance.editor.commit, EDITOR.source.commit);
    assert.match(e.provenance.editor.url, /^https:\/\/fm1-editor\.com\/firmware\/#/);
    assert.deepEqual(e.makers, e.authors.map((name) => ({ name, url: e.source })));
    assert.ok(e.source, `${e.id} has a link to the firmware`);
    assert.doesNotMatch(e.source, /\.(zip|fwsc|rfm1|bin)(\?|$)/i, `${e.id}: source is a page, never a file download`);
  }
});

test("editor catalogue: identity cases (GLITCH, Hortator, h1, OPX)", () => {
  assert.equal(byKey.get("glitch").id, "glitch-ttreu");
  assert.equal(byId.get("glitch").name, GOLDEN.firmwares.find((f) => f.id === "glitch").name, "Pocket's glitch (GR!MM) is untouched");
  assert.ok(!byKey.has("hortator"), "Hortator is already in Pocket (two entries) and is not added again");
  assert.ok(!byKey.has("h1"), "h1 is built into the players, and is not listed again");
  assert.deepEqual(C[RECONCILIATION].builtIn.map((x) => x.key), ["h1"]);
  assert.ok(byKey.has("opx") && byKey.has("opx-solo"), "two Editor entries sharing a repository stay two entries");
  assert.notEqual(byKey.get("opx").id, byKey.get("opx-solo").id);
});

test("editor catalogue: categories map only for new entries, and tools are labelled", () => {
  assert.equal(editorCategory(["synths", "games"]), "Synth");
  assert.equal(editorCategory(["grooveboxes"]), "Groovebox");
  assert.equal(editorCategory(["chords", "synths"]), "Chords");
  assert.equal(editorCategory(["games", "synths"]), "Other");
  assert.equal(editorCategory(["synths", "tools"]), "Other");
  assert.equal(editorCategory([]), "Other");
  const cats = new Set(GOLDEN.firmwares.map((f) => f.category));
  for (const e of ADDED) {
    assert.ok(cats.has(e.category), `${e.id}: ${e.category} is an existing category`);
    const tool = e.provenance.editor.kinds.includes("tools");
    assert.equal(e.utility === true, tool, e.id);
    assert.equal(e.tag, tool ? UTILITY_TAG : "", e.id);
  }
  assert.ok(ADDED.some((e) => e.utility));
});

test("editor catalogue: the first import is backfilled, so nothing floods New to Library", () => {
  const now = new Date(INPUTS.now);
  for (const e of ADDED) {
    assert.equal(e.listed, BACKFILL_LISTED, e.id);
    assert.equal(e.provenance.editor.listedBackfill, true);
    assert.ok((now - new Date(e.listed)) / 86400000 > 14, "older than the 14 days of New to Library");
  }
});

test("editor catalogue: later nights keep ids and listed dates; an entry the Editor adds later is listed that day", () => {
  const next = new Date(new Date(INPUTS.now).getTime() + 86400000);
  const extra = { ...EDITOR.entries[0], key: "brand-new", name: "Brand New", repository: "someone/brand-new", repositories: ["someone/brand-new"] };
  const night2 = withEditor({ previous: C, now: next, editor: { ...EDITOR, entries: [...EDITOR.entries, extra] },
                              editorAliases: { ...ALIASES, distinct: {} } });
  const got = new Map(night2.firmwares.filter(editorOnly).map((e) => [e.provenance.editor.key, e]));
  assert.equal(got.get("glitch").id, "glitch-ttreu", "a published id never changes, even if the table does");
  assert.equal(got.get("glitch").listed, BACKFILL_LISTED);
  assert.equal(got.get("brand-new").listed, next.toISOString().slice(0, 10));
  assert.equal(got.get("brand-new").provenance.editor.listedBackfill, undefined);
  assertBaselineKept(night2, GOLDEN);
});

test("editor catalogue: release dates come from the maker's GitHub release, never the Editor's update date", () => {
  for (const e of ADDED) assert.equal(e.release, null, "no release lookup: unknown, not the Editor's date");
  const key = "glitch";
  const got = withEditor({ editorReleases: { [key]: { version: "0.3.0-beta", date: "2026-10-30T09:00:00Z", url: "https://github.com/ttreu/fm1-glitch/releases/tag/v0.3.0-beta" } } });
  const e = got.firmwares.find((x) => x.provenance.editor && x.provenance.editor.key === key);
  assert.deepEqual(e.release, { version: "0.3.0-beta", date: "2026-10-30T09:00:00Z", source: "GitHub release", url: "https://github.com/ttreu/fm1-glitch/releases/tag/v0.3.0-beta" });
  assert.notEqual(e.release.date.slice(0, 10), e.provenance.editor.updated);
  assertBaselineKept(got, GOLDEN);
});

test("editor catalogue: a night without any Editor snapshot keeps last night's listings unchanged", () => {
  const night2 = goldenBuild({ previous: C, editor: null });
  const kept = night2.firmwares.filter(editorOnly);
  assert.equal(kept.length, 159);
  assert.equal(canonical(kept), canonical(ADDED));
  assertBaselineKept(night2, GOLDEN);
});

test("editor catalogue: credits and schema are additive", () => {
  assert.deepEqual(C.attribution, GOLDEN.attribution, "the Hub's credit is unchanged");
  const ed = C.sources.find((s) => s.name === "FM1 Editor");
  assert.equal(ed.license, "MIT");
  assert.equal(ed.copyright, "Copyright (c) 2026 Ben Sparrow");
  assert.equal(ed.credit, "Listed by FM1 Editor");
  assert.deepEqual(C.sources.filter((s) => s.name !== "FM1 Editor"), GOLDEN.sources);
  for (const k of Object.keys(GOLDEN)) assert.ok(k in C, `top-level ${k} kept`);
  for (const k of Object.keys(GOLDEN.counts)) assert.ok(k in C.counts, `counts.${k} kept`);
  assert.equal(JSON.stringify(C).includes("reconciliation"), false, "the report rides outside the written catalogue");
  assert.notEqual(fingerprint(C), fingerprint(GOLDEN));
});

// what FM-1 Pocket 0.9.0's CatalogueV2.Entry decoder reads (Sources/PocketKit/CatalogueV2.swift), and the types it expects
test("editor catalogue: new entries decode in FM-1 Pocket 0.9.0 as source-only More Firmware, without the Hub credit", () => {
  const STATES = ["playable", "experimental", "unsupported", "source-only", "unavailable"];
  const str = (v) => typeof v === "string", strOrNull = (v) => v == null || typeof v === "string";
  for (const e of ADDED) {
    assert.ok(str(e.id) && /^[a-z0-9][a-z0-9._-]*$/.test(e.id) && e.id.length <= 64, `${e.id}: a safe id (SafeName.isID)`);
    assert.ok(str(e.name) && str(e.version) && str(e.category) && str(e.tag) && str(e.about) && str(e.license), e.id);
    assert.ok(Array.isArray(e.authors) && e.authors.every(str), e.id);
    assert.ok(e.makers.every((m) => str(m.name) && strOrNull(m.url)), e.id);
    assert.ok(strOrNull(e.source) && typeof e.beta === "boolean", e.id);
    for (const p of ["web", "mac"]) assert.ok(STATES.includes(e.status[p].state) && str(e.status[p].reason), e.id);
    assert.ok(str(e.restriction.code) && str(e.restriction.reason), e.id);
    assert.ok(e.release === null || str(e.release.date), e.id);
    assert.ok(str(e.listed) && /^\d{4}-\d{2}-\d{2}$/.test(e.listed), e.id);
    // no file + sha256, so no download entry; no emu block, so not playable; no provenance.hub.url, so no Hub credit
    assert.ok(!("file" in e) && !("sha256" in e) && !("emu" in e));
    assert.equal(e.provenance.hub?.url, undefined);
  }
});

test("editor catalogue: descriptions are normalised for display without changing their meaning", () => {
  // today's descriptions are already clean, so normalising leaves every one exactly as the Editor wrote it
  for (const e of EDITOR.entries) assert.equal(normaliseDescription(e.description), e.description.trim(), e.key);
  assert.equal(normaliseDescription("  Two&nbsp;voices &amp; a <b>drone</b>\u200b.\n\tPlays itself. "), "Two voices & a drone. Plays itself.");
  assert.equal(normaliseDescription("e\u0301t\u00e9 &#8212; &#x2014; ok"), "\u00e9t\u00e9 \u2014 \u2014 ok");
  assert.equal(normaliseDescription("left\u202eright\u0007 \ufeffend"), "leftright end", "no direction tricks or control characters");
  assert.equal(normaliseDescription(null), "");
  const long = normaliseDescription("word ".repeat(400));
  assert.ok(long.length <= MAX_ABOUT + 1 && long.endsWith("word…"), "an over-long text is shortened at a word");
  assert.ok(!/<|>/.test(normaliseDescription("<script>alert(1)</script>Safe")), "no markup survives");
});
