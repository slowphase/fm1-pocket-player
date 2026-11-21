// pocket/editor.mjs: FM1 Editor's directory page -> our snapshot, its checks, and its fallback.
// The fixture is the real page at commit c017be1 (21 Nov 2026, 431 entries) with the repository's LICENSE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse, snapshot, refusals, licence, statusLine, repository, linkRole, fallback, content, StructureError, MIN_ENTRIES } from "../editor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const HTML = gunzipSync(readFileSync(join(here, "fixtures", "fm1-editor-c017be1.html.gz"))).toString();
const LICENCE = readFileSync(join(here, "fixtures", "fm1-editor-LICENSE"), "utf8");
const COMMIT = "c017be1c6b34213f794c2c5b4afc8bab808a6a78";
const make = (html = HTML, more = {}) => snapshot({ html, licenceText: LICENCE, commit: COMMIT, committed: "2026-11-21T12:46:05Z", checked: "2026-11-21T13:00:00Z", ...more });
const byKey = (s) => new Map(s.entries.map((e) => [e.key, e]));

test("editor: the real page parses into every entry, each with its required fields", () => {
  const s = make();
  assert.equal(s.counts.entries, 431);
  assert.equal(s.counts.withRepository, 422);
  assert.equal(new Set(s.entries.map((e) => e.key)).size, 431);
  for (const e of s.entries) {
    assert.ok(e.name && e.maker, `${e.key}: name and maker`);
    assert.match(e.updated, /^\d{4}-\d{2}-\d{2}$/, `${e.key}: update date`);
    assert.ok(e.description, `${e.key}: description`);
    for (const k of e.kinds) assert.ok(["synths", "grooveboxes", "generative", "games", "tools", "samplers", "chords"].includes(k));
  }
  assert.deepEqual(s.problems, []);
});

test("editor: an entry keeps the Editor's facts, links by role, and its canonical repository", () => {
  const e = byKey(make()).get("386dx");
  assert.equal(e.name, "386DX");
  assert.equal(e.maker, "seajaysec");
  assert.equal(e.version, "2.0");
  assert.equal(e.channel, "release");
  assert.equal(e.updated, "2026-11-04");
  assert.deepEqual(e.kinds, ["grooveboxes", "games"]);
  assert.equal(e.repository, "seajaysec/386-dx-fm1-karaokebot");
  assert.deepEqual(e.links.map((l) => l.role), ["install", "release", "source"]);
  assert.match(e.description, /^A karaoke robot with a band/);
  assert.ok(!("release" in e) && !("released" in e), "the Editor's date is never presented as a release date");
});

test("editor: two unrelated GLITCHes are told apart by repository, and entries without a repository stay without one", () => {
  const m = byKey(make());
  assert.equal(m.get("glitch").repository, "ttreu/fm1-glitch");
  assert.equal(m.get("shrub").repository, null);
  assert.equal(m.get("groove-os").repository, null);
});

test("editor: the snapshot carries the source, its pinned commit and the MIT notice", () => {
  const s = make();
  assert.equal(s.source.commit, COMMIT);
  assert.equal(s.source.url, `https://github.com/benny-sparra/fm1-dx7-patch-importer/blob/${COMMIT}/firmware/index.html`);
  assert.equal(s.source.license.spdx, "MIT");
  assert.equal(s.source.license.copyright, "Copyright (c) 2026 Ben Sparrow");
  assert.match(s.source.license.notice, /MIT License/);
});

test("editor: the same page always makes the same snapshot, whatever order the entries are in", () => {
  const a = make(), b = make();
  assert.equal(content(a), content(b));
  // reverse the entries on the page
  const at = HTML.indexOf('<div class="firmware-grid dither-well">');
  const head = HTML.slice(0, at), grid = HTML.slice(at);
  const arts = [...grid.matchAll(/<article\b[\s\S]*?<\/article>/g)].map((m) => m[0]);
  const reversed = head + '<div class="firmware-grid dither-well">' + arts.reverse().join("\n") + "</div></main>";
  assert.equal(content(make(reversed)), content(a));
  assert.equal(content({ ...a, status: { ok: true, checked: "later" } }), content(a), "the clock is not content");
});

test("editor: the status line becomes a channel and a version; a version never decides the channel", () => {
  const cases = {
    "Latest 2.0": ["release", "2.0"], "Beta · Latest 0.1": ["beta", "0.1"], "Experimental · Latest 0.1.0": ["experimental", "0.1.0"],
    "Release candidate · Latest 1.0.0-rc10": ["release-candidate", "1.0.0-rc10"], "Pre-release · Latest 0.5.2-beta": ["pre-release", "0.5.2-beta"],
    "Beta · Build 43": ["beta", "Build 43"], "No numbered releases": ["unversioned", null], "Free · Beta · Latest 1.15": ["beta", "1.15"],
    "Experimental · Release 26": ["experimental", "26"], "In development · Latest 0.9": ["in-development", "0.9"], "Paid · Latest 2.0": ["release", "2.0"],
  };
  for (const [line, [channel, version]] of Object.entries(cases)) assert.deepEqual([statusLine(line).channel, statusLine(line).version], [channel, version], line);
});

test("editor: repositories and link roles", () => {
  assert.equal(repository("https://github.com/Owner/Repo.git"), "owner/repo");
  assert.equal(repository("https://github.com/owner/repo/releases/tag/v1"), "owner/repo");
  assert.equal(repository("https://owner.github.io/repo/"), null);
  assert.equal(repository("https://github.com/sponsors/someone"), null);
  assert.equal(linkRole("Try it in a browser"), "try");
  assert.equal(linkRole("Source and credits"), "source");
  assert.equal(linkRole("Cheat sheet"), "manual");
});

test("editor: a changed page structure is refused, never half-read", () => {
  assert.throws(() => parse(HTML.replace('<div class="firmware-grid dither-well">', '<div class="firmware-list">')), StructureError);
  assert.throws(() => parse(HTML.replaceAll('class="firmware-title-link"', 'class="title"')), StructureError);
  assert.throws(() => parse(HTML.replace(/(<div class="firmware-grid dither-well">[\s\S]*?)<\/article>/, "$1")), StructureError, "an entry that never closes");
  assert.throws(() => make(HTML.replaceAll('<p class="synthwave-kicker">', '<p class="maker">')), /no maker/);
  assert.throws(() => make(HTML.replaceAll(/data-updated="[^"]*"/g, "")), /no updated/);
});

test("editor: a much smaller, duplicated or tiny directory is refused", () => {
  const good = make();
  const fewer = { ...good, entries: good.entries.slice(0, 300) };
  assert.match(refusals(fewer.entries, good).join(), /down from 431/);
  assert.deepEqual(refusals(good.entries.slice(0, 400), good), [], "a modest drop is fine");
  assert.match(refusals([...good.entries, good.entries[0]], good).join(), /share an id: 386dx|share an id/);
  assert.match(refusals(good.entries.slice(0, MIN_ENTRIES - 1)).join(), /only 99 entries/);
  const noRepo = good.entries.map((e, i) => (i % 4 ? e : { ...e, repository: null }));
  assert.match(refusals(noRepo, good).join(), /no repository/);
});

test("editor: the repository must still be MIT licensed", () => {
  assert.deepEqual(licence(LICENCE), { spdx: "MIT", copyright: "Copyright (c) 2026 Ben Sparrow" });
  assert.equal(licence("All rights reserved."), null);
  assert.throws(() => make(HTML, { licenceText: "Copyright 2026. All rights reserved." }), /no longer the MIT licence/);
});

test("editor: a refused snapshot keeps the last good one, saying why", () => {
  const good = make();
  const kept = fallback(good, "the directory grid is not on the page", "2026-11-22T06:00:00Z");
  assert.equal(content({ ...kept, status: undefined }), content(good));
  assert.equal(kept.status.kept, true);
  assert.equal(kept.status.refused.reason, "the directory grid is not on the page");
  assert.equal(fallback(null, "x"), null, "nothing to keep: nothing is written");
});

test("editor: the command keeps the last good snapshot when the page breaks, and writes nothing without one", () => {
  const t = mkdtempSync(join(tmpdir(), "editor-"));
  writeFileSync(join(t, "good.html"), HTML);
  writeFileSync(join(t, "bad.html"), HTML.replace('<div class="firmware-grid dither-well">', "<div>"));
  writeFileSync(join(t, "LICENSE"), LICENCE);
  const run = (html, out) => execFileSync("node", [join(here, "..", "editor.mjs"), "--out", join(t, out), "--html", join(t, html), "--license", join(t, "LICENSE"), "--commit", COMMIT], { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } });
  run("bad.html", "none.json");
  assert.equal(existsSync(join(t, "none.json")), false);
  run("good.html", "snap.json");
  const good = JSON.parse(readFileSync(join(t, "snap.json"), "utf8"));
  assert.equal(good.counts.entries, 431);
  const said = run("bad.html", "snap.json");
  assert.match(said, /Refused/);
  const after = JSON.parse(readFileSync(join(t, "snap.json"), "utf8"));
  assert.equal(after.counts.entries, 431);
  assert.equal(after.status.kept, true);
  assert.equal(content({ ...after, status: undefined }), content({ ...good, status: undefined }));
});
