// Permanent Pocket ids (pocket/identity.mjs): a firmware first listed from FM1 Editor keeps its id when The Firmware Hub
// or RemoteFM1FW later offers it. Simulated over the recorded golden inputs and the recorded Editor page (c017be1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { goldenBuild, read, assertBaselineKept, canonical } from "./golden/golden.mjs";
import { snapshot } from "../editor.mjs";
import { RECONCILIATION, IDENTITIES } from "../discover.mjs";
import { checkAgainstV1, nextLedger, identities } from "../identity.mjs";
import { editorOnly, markdown } from "../reconcile.mjs";
import { hubWithKickSide, rfm1WithGlitch } from "./golden/promotion.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const EDITOR = snapshot({
  html: gunzipSync(readFileSync(join(here, "fixtures", "fm1-editor-c017be1.html.gz"))).toString(),
  licenceText: readFileSync(join(here, "fixtures", "fm1-editor-LICENSE"), "utf8"),
  commit: "c017be1c6b34213f794c2c5b4afc8bab808a6a78", committed: "2026-11-21T12:46:05Z", checked: "2026-11-21T13:00:00Z",
});
const ALIASES = JSON.parse(readFileSync(join(here, "..", "editor-aliases.json"), "utf8"));
const GOLDEN = read("discover-expected.json.gz");
const INP = read("discover-inputs.json.gz");
const day = (n) => new Date(Date.parse(INP.now) + n * 864e5);

// night 1: the Editor's listings arrive (KickSide is listed as "kickside", GLITCH as "glitch-ttreu")
const N1 = goldenBuild({ editor: EDITOR, editorAliases: ALIASES });
const L1 = N1[IDENTITIES];

const night = (n, prev, ledger, extra = {}) => goldenBuild({ editor: EDITOR, editorAliases: ALIASES, previous: prev, identityLedger: ledger, now: day(n), ...extra });
const N2 = night(4, N1, L1, { hub: hubWithKickSide() });
const rec = (c, id) => c.firmwares.find((e) => e.id === id);

test("identity: night 1 records every Editor-first id in the ledger", () => {
  assert.equal(Object.keys(L1.ids).length, 159);
  assert.deepEqual(L1.ids.kickside, { editor: "kickside", repository: "kjs4discovery/kicksidesidekick", hub: null, remotefm1fw: null, since: "2026-10-07", backfill: true });
  assert.equal(L1.ids["glitch-ttreu"].editor, "glitch");
});

test("identity: when the Hub adds an Editor-first firmware, it keeps its Pocket id and becomes one record", () => {
  const k = rec(N2, "kickside");
  assert.ok(k, "kickside is still listed under its id");
  assert.ok(!rec(N2, "kicksidefm"), "no duplicate under the Hub's id");
  assert.equal(N2.firmwares.filter((e) => e.name === "KickSide").length, 1);
  assert.equal(k.provenance.hub.id, "kicksidefm", "packages resolve through the Hub's own id");
  assert.deepEqual(k.upstreamIds, { hub: "kicksidefm" });
  assert.deepEqual(k.aliases, ["kicksidefm"]);
  assert.ok(!editorOnly(k));
  assert.equal(k.restriction.code, "no-build", "the Hub's verified status now applies, not listing-only");
  assert.equal(k.release.source, "The Firmware Hub");
  assert.equal(k.listed, "2026-10-07", "the day Pocket first listed it, not the day the Hub added it");
  assert.equal(k.provenance.editor.key, "kickside");
  assert.equal(k.provenance.editor.listedBackfill, true);
  assert.equal(k.credit.text, "Listed by FM1 Editor");
  assert.equal(k.attributedDescription.credit, "Description from FM1 Editor");
  assert.ok(k.attributedDescription.text.length > 50);
  assert.equal(k.about, "", "about stays the new source's own (the Hub's card text is never copied)");
  assert.deepEqual(k.promoted, { from: "FM1 Editor", sources: ["hub"], listed: "2026-10-07" });
  assert.equal(N2.counts.promotedFromEditor, 1);
  assert.equal(N2.counts.fromEditor, 158);
  assert.deepEqual(N2[RECONCILIATION].identity.promoted, [{ id: "kickside", was: "kicksidefm", sources: ["hub"], editor: "kickside" }]);
  assert.match(markdown(N2[RECONCILIATION]), /kickside: joined to hub \(their id kicksidefm\)/);
  assertBaselineKept(N2, GOLDEN);
});

test("identity: the promotion holds night after night, and survives losing the ledger or the previous catalogue", () => {
  const L2 = N2[IDENTITIES];
  assert.equal(L2.ids.kickside.hub, "kicksidefm", "the ledger now records the Hub's id");
  const strip = (e) => canonical({ ...e });
  const N3 = night(5, N2, L2, { hub: hubWithKickSide() });
  assert.equal(strip(rec(N3, "kickside")), strip(rec(N2, "kickside")));
  const noPrev = night(5, null, L2, { hub: hubWithKickSide() });
  assert.ok(rec(noPrev, "kickside") && !rec(noPrev, "kicksidefm"), "the ledger alone keeps the id");
  assert.equal(rec(noPrev, "kickside").provenance.editor.listedBackfill, true);
  const noLedger = night(5, N2, null, { hub: hubWithKickSide() });
  assert.ok(rec(noLedger, "kickside") && !rec(noLedger, "kicksidefm"), "the previous catalogue alone keeps the id");
  assert.equal(rec(noLedger, "kickside").listed, "2026-10-07");
});

test("identity: when RemoteFM1FW builds an Editor-first firmware, it becomes playable under its Pocket id", () => {
  const { v1, upstream } = rfm1WithGlitch();
  const N = night(1, N1, L1, { v1, upstream });
  const g = rec(N, "glitch-ttreu");
  assert.equal(g.file, "fw/glitchdrums-1234abcd.rfm1");
  assert.equal(g.status.web.state, "playable");
  assert.deepEqual(g.aliases, ["glitchdrums"]);
  assert.deepEqual(g.upstreamIds, { remotefm1fw: "glitchdrums" });
  assert.ok(!rec(N, "glitchdrums"), "no duplicate under the build's id");
  assert.equal(rec(N, "glitch").name, "GR!MM", "Pocket's own glitch is untouched");
  assert.equal(g.listed, "2026-10-07");
  checkAgainstV1(N, v1);    // catalog.json's "glitchdrums" (the .rfm1's own id) is the same record, through the alias
  const broken = structuredClone(N);
  delete broken.firmwares.find((e) => e.id === "glitch-ttreu").aliases;
  assert.throws(() => checkAgainstV1(broken, v1), /glitchdrums/, "the check still catches a build with no matching record");
  assert.equal(N[IDENTITIES].ids["glitch-ttreu"].remotefm1fw, "glitchdrums");
});

test("identity: a different firmware arriving under an Editor-first id gets its own id; the Editor record is untouched", () => {
  const N = night(4, N1, L1, { hub: hubWithKickSide("kickside", "someone-else/another-kickside") });
  assert.equal(rec(N, "kickside").provenance.editor.key, "kickside");
  assert.ok(editorOnly(rec(N, "kickside")), "the Editor-first record is exactly as it was");
  const other = rec(N, "kickside-hub");
  assert.equal(other.provenance.hub.id, "kickside");
  assert.deepEqual(other.aliases, ["kickside"]);
  assert.equal(N[RECONCILIATION].identity.guarded[0].id, "kickside-hub");
});

test("identity: when the Hub's id equals the Pocket id, the record simply gains the Hub (no rename)", () => {
  const N = night(4, N1, L1, { hub: hubWithKickSide("kickside") });
  const k = rec(N, "kickside");
  assert.equal(k.provenance.hub.id, "kickside");
  assert.equal(k.aliases, undefined);
  assert.equal(k.listed, "2026-10-07");
  assert.equal(k.provenance.editor.key, "kickside");
});

test("identity: an ambiguous match never retires the Editor id; a hand-made mapping settles it", () => {
  const hub = hubWithKickSide("kicksidefm");
  const blop = hub.catalog.firmwares.find((h) => h.id === "blop");
  hub.catalog.firmwares.push({ ...structuredClone(blop), id: "kicksidebt", name: "KickSide BT", repo: "kjs4discovery/kicksidesidekick" });
  const N = night(4, N1, L1, { hub });
  assert.ok(rec(N, "kickside"), "still listed under its id");
  assert.ok(editorOnly(rec(N, "kickside")));
  assert.deepEqual(N[RECONCILIATION].identity.ambiguous.map((x) => x.candidates), [["kicksidebt", "kicksidefm"]]);
  const mapped = night(4, N1, L1, { hub, editorAliases: { ...ALIASES, identities: { kickside: { editor: "kickside", hub: "kicksidefm" } } } });
  assert.equal(rec(mapped, "kickside").provenance.hub.id, "kicksidefm");
  assert.ok(rec(mapped, "kicksidebt"), "the other firmware keeps its own Hub id");
  assert.deepEqual(mapped[RECONCILIATION].identity.ambiguous, []);
});

test("identity: if the Editor later drops a promoted firmware, the record stays (another source offers it)", () => {
  const without = { ...EDITOR, entries: EDITOR.entries.filter((e) => e.key !== "kickside") };
  const N3 = night(5, N2, N2[IDENTITIES], { hub: hubWithKickSide(), editor: without });
  const k = rec(N3, "kickside");
  assert.ok(k);
  assert.equal(k.provenance.editor.key, "kickside", "its Editor credit is kept from the record");
  assert.equal(k.listed, "2026-10-07");
});

test("identity: the ledger only grows, and a firmware established under its own id is never renamed", () => {
  const grown = nextLedger({ ids: { gone: { editor: "gone", repository: "x/gone", since: "2026-10-07" } } }, N1.firmwares, "2026-11-22");
  assert.ok(grown.ids.gone, "a record is never dropped");
  assert.equal(Object.keys(grown.ids).length, 160);
  // a hand-made identity pointing at an established Pocket firmware changes nothing
  const N = night(1, N1, L1, { editorAliases: { ...ALIASES, identities: { kickside: { editor: "kickside", hub: "hortator" } } } });
  assert.ok(rec(N, "hortator"));
  assertBaselineKept(N, GOLDEN);
  assert.equal(identities({ aliases: { identities: { a: { hub: "h" } } } }).get("a").explicit, true);
});

test("identity: with no Editor-first records anywhere, nothing changes", () => {
  assert.equal(canonical(goldenBuild({ identityLedger: { ids: {} } })), canonical(GOLDEN));
  assert.equal(goldenBuild()[IDENTITIES], undefined);
});

// what FM-1 Pocket 0.9.0's CatalogueV2.Entry decoder reads (Sources/PocketKit/CatalogueV2.swift), for promoted records
test("identity: promoted records decode in FM-1 Pocket 0.9.0 under their Pocket id", () => {
  const { v1, upstream } = rfm1WithGlitch();
  const N = night(4, N1, L1, { v1, upstream, hub: hubWithKickSide() });
  const STATES = ["playable", "experimental", "unsupported", "source-only", "unavailable"];
  const str = (v) => typeof v === "string";
  for (const id of ["kickside", "glitch-ttreu"]) {
    const e = rec(N, id);
    assert.ok(/^[a-z0-9][a-z0-9._-]*$/.test(e.id) && e.id.length <= 64);
    assert.ok(str(e.name) && str(e.version) && str(e.category) && str(e.tag) && str(e.about) && str(e.license));
    assert.ok(Array.isArray(e.authors) && e.makers.every((m) => str(m.name)) && typeof e.beta === "boolean");
    for (const p of ["web", "mac"]) assert.ok(STATES.includes(e.status[p].state) && str(e.status[p].reason));
    assert.ok(e.release === null || str(e.release.date));
    assert.ok(Array.isArray(e.aliases) ? e.aliases.every(str) : e.aliases === undefined);
  }
  // the Hub now lists KickSide, so its Hub credit shows (provenance.hub.url); GLITCH has none, so none shows
  assert.ok(rec(N, "kickside").provenance.hub.url);
  assert.equal(rec(N, "glitch-ttreu").provenance.hub, undefined);
  // a downloadable promoted record carries exactly its catalog.json fields apart from the id, so 0.9.0 downloads the same file
  const g = rec(N, "glitch-ttreu"), f = v1.firmwares.find((x) => x.id === "glitchdrums");
  for (const k of Object.keys(f)) if (k !== "id") assert.equal(canonical(g[k]), canonical(f[k]), k);
});
