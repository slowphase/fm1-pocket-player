// node --test pocket/tests/
// The expanded catalogue (catalog-v2.json), The Firmware Hub's once-a-day copy, and per-player compatibility.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hubCatalogue, MAX_AGE_MS, USER_AGENT, ATTRIBUTION } from "../hub.mjs";
import { build, playerStatus, fingerprint, STATES } from "../discover.mjs";
import { outcome, update, macosRun, nativeRuntime, webRuntime, emptyLedger } from "../compat.mjs";

const day = 24 * 3600 * 1000;
const fakeHub = (n = 2) => ({ license: "CC-BY-4.0", firmwares: Array.from({ length: n }, (_, i) => ({ id: "x" + i, name: "X" + i })) });

test("the Hub is read at most once a day, with a User-Agent, and a failed read keeps the old copy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hub-")), file = join(dir, "hub.json");
  const calls = [];
  const ok = async (url, opts) => { calls.push({ url, ua: opts.headers["user-agent"] }); return { ok: true, json: async () => fakeHub() }; };
  const t0 = Date.parse("2026-11-20T06:30:00Z");
  let r = await hubCatalogue({ cacheFile: file, now: t0, fetchFn: ok });
  assert.equal(r.fetched, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ua, USER_AGENT);
  assert.match(calls[0].url, /thefirmwarehub\.com\/catalog\.json$/);
  r = await hubCatalogue({ cacheFile: file, now: t0 + day - 60_000, fetchFn: ok });   // 23 h 59 m later
  assert.equal(r.fetched, false);
  assert.equal(calls.length, 1, "no second read within a day");
  assert.equal(r.cache.catalog.firmwares.length, 2);
  r = await hubCatalogue({ cacheFile: file, now: t0 + MAX_AGE_MS + 1, fetchFn: async () => { throw new Error("offline"); } });
  assert.equal(r.fetched, false);
  assert.equal(r.cache.fetchedAt, new Date(t0).toISOString(), "a failed read keeps yesterday's copy");
  r = await hubCatalogue({ cacheFile: file, now: t0 + 2 * day, fetchFn: async () => ({ ok: true, json: async () => ({ firmwares: [] }) }) });
  assert.equal(r.cache.catalog.firmwares.length, 2, "an empty list never replaces a good one");
  r = await hubCatalogue({ cacheFile: file, now: t0 + 3 * day, allowFetch: false, fetchFn: ok });
  assert.equal(calls.length, 1, "pull-request checks never read the Hub");
});

// ---- a small world: four RemoteFM1FW builds, three published, plus Hub entries ----
const v1 = {
  schema: 1, updated: "2026-11-19T08:40:52.624Z", since: "2026-11-19", count: 3,
  firmwares: [
    { id: "felucca", name: "Felucca", version: "1.8.2", authors: ["Leo"], category: "Synth", tag: "t", about: "a", license: "GPL-3.0-only", source: "https://github.com/hugelton/Felucca", commit: "abc1234", glue: null, builtBy: null, abi: 6, beta: false, file: "fw/felucca-11111111.rfm1", sha256: "1".repeat(64), size: 10, added: "2026-11-19", updated: "2026-11-19", image: "shots/felucca-11111111.png" },
    { id: "berlinan", name: "Berlinan", version: "0.5.1", authors: ["J"], category: "Other", tag: "", about: "", license: "GPL-2.0-or-later", source: "https://github.com/j/berlinan", commit: "def5678", glue: null, builtBy: null, abi: 6, beta: true, file: "fw/berlinan-22222222.rfm1", sha256: "2".repeat(64), size: 10, added: "2026-11-19", updated: "2026-11-19", image: null },
    { id: "grimm", name: "GR!MM", version: "2.0.2", authors: ["S"], category: "Synth", tag: "", about: "", license: "GPL-3.0-only", source: "https://github.com/s/grimm", commit: "aaa1111", glue: null, builtBy: null, abi: 6, beta: false, file: "fw/grimm-33333333.rfm1", sha256: "3".repeat(64), size: 10, added: "2026-11-19", updated: "2026-11-19", image: null },
  ],
};
const upstream = {
  items: [
    { file: "felucca-1.8.2.rfm1", name: "Felucca 1.8.2", author: "Leo", license: "GPL-3.0-only", restricted: false, fantasy: false, source: "https://github.com/hugelton/Felucca", commit: "abc1234", asset: { size: 10, sha256: "1".repeat(64) } },
    { file: "berlinan-0.5.1.rfm1", name: "Berlinan 0.5.1", author: "J", license: "GPL-2.0-or-later", restricted: false, fantasy: false, source: "https://github.com/j/berlinan", commit: "def5678", asset: { size: 10, sha256: "2".repeat(64) } },
    { file: "grimm-2.0.2.rfm1", name: "GR!MM 2.0.2", author: "S", license: "GPL-3.0-only", restricted: false, fantasy: false, source: "https://github.com/s/grimm", commit: "aaa1111", asset: { size: 10, sha256: "3".repeat(64) } },
    { file: "dx747-1.0.rfm1", name: "DX747 1.0 †", author: "E", license: "GPL-3.0-only", restricted: true, fantasy: false, source: "https://github.com/esbenvb/fm1-dx747", commit: null, asset: { size: 10, sha256: "4".repeat(64) } },
    { file: "elasticat-1.0.rfm1", name: "Elasticat 1.0 ‡", author: "M", license: "MPL-2.0", restricted: false, fantasy: true, source: null, commit: null, asset: { size: 10, sha256: "5".repeat(64) } },
    { file: "newone-0.1.rfm1", name: "New One 0.1", author: "N", license: "MIT", restricted: false, fantasy: false, source: "https://github.com/n/newone", commit: "bbb2222", asset: { size: 10, sha256: "6".repeat(64) } },
    { file: "h1-0.2.1.rfm1", name: "h1 0.2.1", author: "Jake Handy", license: "MIT", restricted: false, fantasy: false, source: "https://github.com/jakehandy/h1", commit: null, asset: { size: 10, sha256: "7".repeat(64) } },
  ],
  cards: { newone: { what: "A new one", category: "Synth" } },
};
const policy = { approved: {}, excluded: { h1: "Built into this player (firmware/h1.rfm1), so it is not listed twice.", dx747: "restricted" }, withdrawn: {}, smokeExceptions: { berlinan: { reason: "Silent until set up.", checks: ["sound"] } } };
const report = { pending: [{ id: "newone" }], rejected: [] };
const nat = nativeRuntime();
const web = webRuntime();
const rec = (o, runtime, extra = {}) => ({ runtime, environment: "test", date: "2026-11-20T06:30:00Z", outcome: o, problems: o === "fail" ? ["drew nothing on the screen"] : [], exception: extra.exception || null, result: {} });
const ledger = {
  builds: {
    ["1".repeat(64)]: { id: "felucca", web: rec("pass", web.id), native: rec("pass", nat.id) },
    ["2".repeat(64)]: { id: "berlinan", web: rec("pass-with-exception", web.id, { exception: "Silent until set up." }), native: rec("pass-with-exception", nat.id, { exception: "Silent until set up." }) },
    ["3".repeat(64)]: { id: "grimm", web: rec("pass", web.id), native: rec("fail", nat.id) },
  },
  runtimes: { web, native: nat },
  macos: {},
};
const hub = {
  fetchedAt: "2026-11-20T06:30:00Z",
  catalog: { firmwares: [
    { id: "felucca", name: "Felucca", author: "Leo", repo: "hugelton/Felucca", lic: "GPL-3.0", version: "1.8.2" },
    { id: "dx747", name: "DX747", author: "E", repo: "esbenvb/fm1-dx747", lic: "GPL-3.0 + SDK exception" },
    { id: "zp12", name: "zp12", author: "zvenson", repo: "zvenson/zp12", lic: "GPL-3.0", kind: "drums", version: "1.0", what: "card text that must not be copied" },
    { id: "vesper", name: "VESPER", author: "F", repo: "fatcat/vesper-fm1", lic: "" },
    { id: "h1", name: "h1", author: "Jake Handy", repo: "jakehandy/h1", lic: "MIT" },
  ] },
};

test("v2: every downloadable entry is exactly its catalog.json entry; nothing else is downloadable", () => {
  const c = build({ v1, upstream, report, policy, ledger, hub, now: new Date("2026-11-20T07:00:00Z") });
  assert.equal(c.schema, 2);
  for (const f of v1.firmwares) {
    const e = c.firmwares.find((x) => x.id === f.id);
    for (const k of Object.keys(f)) assert.deepEqual(e[k], f[k], `${f.id}.${k}`);
  }
  assert.deepEqual(c.firmwares.filter((e) => e.file).map((e) => e.id).sort(), ["berlinan", "felucca", "grimm"]);
  assert.equal(c.counts.downloadable, 3);
  assert.deepEqual(c.builtIn, ["h1"], "h1 is built in, never listed twice");
  assert.ok(!c.firmwares.some((e) => e.id === "h1"));
});

test("v2: restrictions carry their specific reasons, and source links", () => {
  const c = build({ v1, upstream, report, policy, ledger, hub });
  const by = Object.fromEntries(c.firmwares.map((e) => [e.id, e]));
  assert.equal(by.dx747.restriction.code, "restricted");
  assert.equal(by.dx747.status.web.state, "source-only");
  assert.equal(by.dx747.status.mac.state, "source-only");
  assert.equal(by.dx747.source, "https://github.com/esbenvb/fm1-dx747");
  assert.equal(by.elasticat.restriction.code, "not-fm1");
  assert.equal(by.elasticat.status.mac.state, "unsupported", "a known incompatibility, not a download restriction");
  assert.equal(by.newone.restriction.code, "awaiting-review");
  assert.equal(by.zp12.restriction.code, "no-build");
  assert.equal(by.zp12.source, "https://github.com/zvenson/zp12");
  assert.equal(by.zp12.category, "Drums");
  assert.equal(by.zp12.about, "", "the Hub's card texts are not copied");
  assert.equal(by.vesper.restriction.code, "not-open");
  assert.ok(Object.values(by).every((e) => !e.restriction || e.restriction.reason.length > 10));
});

test("v2: one entry per firmware identity, with provenance from each source", () => {
  const c = build({ v1, upstream, report, policy, ledger, hub });
  assert.equal(c.firmwares.filter((e) => e.id === "felucca").length, 1);
  const f = c.firmwares.find((e) => e.id === "felucca");
  assert.equal(f.provenance.remotefm1fw.file, "felucca-1.8.2.rfm1");
  assert.equal(f.provenance.hub.id, "felucca");
  assert.equal(f.provenance.hub.url, "https://thefirmwarehub.com/firmware/felucca/");
  assert.equal(f.provenance.pocket.published, "1.8.2");
  assert.deepEqual(f.makers, [{ name: "Leo", url: "https://github.com/hugelton/Felucca" }], "each maker linked to the repository");
  assert.equal(c.counts.discovered, c.firmwares.length + 1);
  assert.equal(c.counts.onHub, 5);
});

test("v2: the Hub's attribution travels with the catalogue, and only when the Hub was used", () => {
  const withHub = build({ v1, upstream, report, policy, ledger, hub });
  assert.equal(withHub.attribution.text, ATTRIBUTION.text);
  assert.equal(withHub.attribution.license, "CC BY 4.0");
  assert.match(withHub.attribution.changes, /not copied/);
  assert.equal(withHub.attribution.read, hub.fetchedAt);
  const noHub = build({ v1, upstream, report, policy, ledger, hub: null });
  assert.equal(noHub.attribution, null);
  assert.equal(noHub.counts.onHub, null);
  assert.ok(!noHub.firmwares.some((e) => e.id === "zp12"));
});

test("compatibility is per player: passing in the web player says nothing about the Mac", () => {
  const c = build({ v1, upstream, report, policy, ledger, hub });
  const by = Object.fromEntries(c.firmwares.map((e) => [e.id, e]));
  assert.equal(by.grimm.status.web.state, "playable");
  assert.equal(by.grimm.status.mac.state, "unsupported", "failed in the native engine");
  assert.match(by.grimm.status.mac.reason, /drew nothing/);
  assert.equal(by.grimm.status.mac.tested.sha256, "3".repeat(64));
  assert.equal(by.grimm.status.mac.tested.runtime, nat.id);
  assert.equal(by.felucca.status.mac.state, "experimental", "Linux only: not verified on macOS yet");
  assert.match(by.felucca.status.mac.reason, /not yet been verified on macOS/);
  assert.equal(by.berlinan.status.web.state, "playable");
  assert.match(by.berlinan.status.web.reason, /Silent until set up/);
  for (const p of ["web", "mac"]) assert.equal(Object.values(c.counts[p]).reduce((a, b) => a + b, 0), c.firmwares.length);
});

test("a macOS run for this engine commit turns Linux passes into playable; a failed one does not", () => {
  const good = { ...ledger, macos: { [nat.id]: { runtime: nat.id, verified: true, date: "2026-11-20", environment: "macOS arm64", results: { felucca: { outcome: "pass", sha256: "1".repeat(64) } } } } };
  const c = build({ v1, upstream, report, policy, ledger: good, hub });
  const by = Object.fromEntries(c.firmwares.map((e) => [e.id, e]));
  assert.equal(by.felucca.status.mac.state, "playable");
  assert.match(by.felucca.status.mac.reason, /individually on macOS/);
  assert.equal(by.felucca.status.mac.verification, "macos");
  assert.equal(by.berlinan.status.mac.state, "playable");
  assert.equal(by.berlinan.status.mac.verification, "representative", "covered by the sample, not run itself");
  assert.match(by.berlinan.status.mac.reason, /not run individually on macOS/);
  assert.equal(by.berlinan.status.mac.tested.macos.sample, true);
  assert.equal(c.counts.macVerification.macos, 1);
  assert.equal(by.grimm.status.mac.state, "unsupported", "a native failure stays a failure");
  const bad = { ...ledger, macos: { [nat.id]: { runtime: nat.id, verified: false, date: "2026-11-20", environment: "macOS arm64", results: {} } } };
  assert.equal(build({ v1, upstream, report, policy, ledger: bad, hub }).firmwares.find((e) => e.id === "felucca").status.mac.state, "experimental");
  const old = { ...ledger, macos: { "fm1-pocket-mac@000000000000": { runtime: "fm1-pocket-mac@000000000000", verified: true, results: {} } } };
  assert.equal(build({ v1, upstream, report, policy, ledger: old, hub }).firmwares.find((e) => e.id === "felucca").status.mac.state, "experimental", "verification is per engine commit");
});

test("a build too slow in the native engine stays experimental on the Mac unless macOS measured it fast enough", () => {
  const slow = { runtime: nat.id, environment: "Linux", date: "d", outcome: "pass", problems: [], exception: null, result: { speed: 0.4 }, id: "fizz", sha256: "x" };
  const verified = { runtime: nat.id, verified: true, date: "d", environment: "macOS arm64", results: {} };
  let st = playerStatus("mac", slow, verified);
  assert.equal(st.state, "experimental");
  assert.equal(st.performance, "may-stutter");
  assert.equal(st.verification, "representative");
  assert.match(st.reason, /0\.4x real time on the Linux test machine and has not been timed on macOS/);
  st = playerStatus("mac", slow, { ...verified, results: { fizz: { outcome: "pass", sha256: "x", result: { speed: 2.5 } } } });
  assert.equal(st.state, "playable", "fast enough on Apple Silicon");
  assert.equal(st.verification, "macos");
  assert.equal(st.tested.macos.speed, 2.5);
  st = playerStatus("mac", slow, { ...verified, results: { fizz: { outcome: "pass", sha256: "x", result: { speed: 0.9 } } } });
  assert.equal(st.state, "experimental");
  assert.match(st.reason, /0\.9x real time when tested on macOS/);
  st = playerStatus("mac", slow, { ...verified, results: { fizz: { outcome: "pass", sha256: "an older build", result: { speed: 2.5 } } } });
  assert.equal(st.verification, "representative", "a macOS result for another build of it does not count");
  assert.equal(st.state, "experimental");
  const fast = { ...slow, result: { speed: 3 } };
  st = playerStatus("mac", fast, { ...verified, results: { fizz: { outcome: "pass", sha256: "x", result: { speed: 0.8 } } } });
  assert.equal(st.state, "experimental", "slow on macOS outweighs fast on Linux");
  st = playerStatus("mac", fast, { ...verified, results: { fizz: { outcome: "fail", problems: ["silent"], sha256: "x", result: { speed: 3 } } } });
  assert.equal(st.state, "unsupported", "a macOS failure of this build is a failure");
  assert.equal(playerStatus("web", { ...slow }, null).state, "playable", "the web player compiles WebAssembly: speed is not its concern here");
});

test("untested builds are experimental, never playable", () => {
  assert.equal(playerStatus("web", null, null).state, "experimental");
  assert.equal(playerStatus("mac", null, null).state, "experimental");
  const c = build({ v1, upstream, report, policy, ledger: { builds: {}, macos: {} }, hub: null });
  assert.ok(c.firmwares.filter((e) => e.file).every((e) => e.status.web.state === "experimental" && e.status.mac.state === "experimental"));
});

test("the change check ignores timestamps", () => {
  const a = build({ v1, upstream, report, policy, ledger, hub, now: new Date("2026-11-20T07:00:00Z") });
  const b = build({ v1, upstream, report, policy, ledger, hub, now: new Date("2026-11-21T07:00:00Z") });
  assert.equal(fingerprint(a), fingerprint(b));
  const c = build({ v1, upstream, report, policy, ledger: { ...ledger, builds: {} }, hub });
  assert.notEqual(fingerprint(a), fingerprint(c));
});

test("outcomes honour documented exceptions only", () => {
  const silent = { halted: 0, draws: true, redraws: true, sounds: false };
  assert.equal(outcome(silent, null).outcome, "fail");
  assert.equal(outcome(silent, { reason: "r", checks: ["sound"] }).outcome, "pass-with-exception");
  assert.equal(outcome({ ...silent, sounds: true, redraws: false }, { reason: "r", checks: ["redraw"] }).outcome, "pass-with-exception");
  assert.equal(outcome({ crashed: "boom" }, { reason: "r", checks: ["sound"] }).outcome, "fail");
  assert.equal(outcome({ ...silent, sounds: true }, null).outcome, "pass");
});

test("the ledger re-tests only new builds or a changed runtime, and forgets unpublished ones", async () => {
  const runs = { web: 0, native: 0 };
  const good = { halted: 0, draws: true, redraws: true, sounds: true };
  const runWeb = async () => { runs.web++; return good; };
  const runNative = async () => { runs.native++; return good; };
  const entries = v1.firmwares;
  const l = emptyLedger();
  await update({ ledger: l, entries, dataDir: "/x", policy, nativeBin: "bin", runWeb, runNative });
  assert.deepEqual(runs, { web: 3, native: 3 });
  await update({ ledger: l, entries, dataDir: "/x", policy, nativeBin: "bin", runWeb, runNative });
  assert.deepEqual(runs, { web: 3, native: 3 }, "nothing new: nothing re-tested");
  l.builds["1".repeat(64)].native.runtime = "fm1-pocket-mac@old";
  await update({ ledger: l, entries: entries.slice(0, 2), dataDir: "/x", policy, nativeBin: "bin", runWeb, runNative });
  assert.deepEqual(runs, { web: 3, native: 4 }, "a changed engine re-tests");
  assert.equal(Object.keys(l.builds).length, 2, "builds no longer published are dropped");
  assert.equal(l.builds["2".repeat(64)].web.outcome, "pass-with-exception");
});

test("the macOS run checks the representative set and is verified only if all pass", async () => {
  const entries = [{ id: "felucca", sha256: "1".repeat(64), file: "fw/f.rfm1" }, { id: "nope", sha256: "9".repeat(64), file: "fw/n.rfm1" }];
  const run = await macosRun({ entries, dataDir: "/x", policy, nativeBin: "bin", runNative: async () => ({ halted: 0, draws: true, redraws: true, sounds: true }) });
  assert.ok(run.results.felucca);
  assert.ok(!run.results.nope, "only the representative set");
  assert.equal(run.verified, false, "the rest of the representative set is missing");
  assert.ok(run.missing.length > 0);
  assert.match(run.environment, /macOS/);
});

test("the macOS job also runs every build slow or borderline on Linux", async () => {
  const { macosSet } = await import("../compat.mjs");
  const entries = [{ id: "hortator", sha256: "a" }, { id: "quick", sha256: "b" }, { id: "untested", sha256: "c" }];
  const led = { builds: { a: { native: { result: { speed: 0.6 } } }, b: { native: { result: { speed: 9 } } } } };
  const set = macosSet(entries, led);
  assert.ok(set.has("hortator"));
  assert.ok(!set.has("quick"));
  assert.ok(!set.has("untested"));
  assert.ok(set.has("felucca"), "the representative set is always included");
  const run = await macosRun({ entries: [{ id: "hortator", sha256: "a", file: "fw/h.rfm1" }], dataDir: "/x", policy, nativeBin: "bin", also: ["hortator"],
    runNative: async () => ({ halted: 0, draws: true, redraws: true, sounds: true, speed: 1.4 }) });
  assert.equal(run.results.hortator.sha256, "a");
});

test("STATES are the four the players understand", () => {
  assert.deepEqual(STATES, ["playable", "experimental", "unsupported", "source-only"]);
});

test("catalog.json keeps schema 1 and its fields", () => {
  const src = readFileSync(new URL("../catalog.mjs", import.meta.url), "utf8");
  assert.match(src, /schema: 1,/, "catalog.mjs still writes schema 1");
  assert.ok(!/status|restriction|provenance/.test(src), "no v2 fields in catalog.mjs");
});
