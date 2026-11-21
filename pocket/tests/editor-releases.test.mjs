// Phase 2: release dates for FM1 Editor's listing-only entries (pocket/editor-releases.mjs), with a fake GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, plan, RECHECK_DAYS } from "../editor-releases.mjs";
import { lookup } from "../releases.mjs";

const NOW = new Date("2026-11-22T06:30:00Z");
const entry = (key, repository, version, updated = "2026-11-10") => ({ key, name: key, maker: "m", repository, repositories: repository ? [repository] : [], version, updated, kinds: [] });
const DIR = { entries: [
  entry("alpha", "a/alpha", "1.2"),        // a matching tag
  entry("beta", "b/beta", null),           // no version: the latest release
  entry("gamma", "c/gamma", "2.0"),        // no release with that version: unknown
  entry("delta", null, "1.0"),             // no repository: never looked up
  entry("known", "k/known", "3.0"),        // already in Pocket: never looked up
] };
const CATALOGUE = { firmwares: [{ id: "known", name: "Known", source: "https://github.com/k/known" }] };
const RELEASES = {
  "a/alpha": [{ tag_name: "v1.3", published_at: "2026-11-15T00:00:00Z", html_url: "u13" }, { tag_name: "v1.2", published_at: "2026-11-01T00:00:00Z", html_url: "u12" }],
  "b/beta": [{ tag_name: "draft", draft: true, published_at: null }, { tag_name: "v0.9", published_at: "2026-11-05T00:00:00Z", html_url: "u09" }],
  "c/gamma": [{ tag_name: "v1.0", published_at: "2026-10-01T00:00:00Z", html_url: "u10" }],
};
function fakeGitHub() {
  const calls = [];
  const fetchImpl = async (url) => {
    const repo = url.match(/repos\/([^/]+\/[^/]+)\/releases/)[1];
    calls.push(repo);
    return { ok: !!RELEASES[repo], json: async () => RELEASES[repo] || { message: "Not Found" } };
  };
  return { calls, fetchImpl };
}

test("editor releases: the version picks the release; no version takes the latest; no match stays unknown", async () => {
  const gh = fakeGitHub();
  const out = await run({ directory: DIR, catalogue: CATALOGUE, aliases: {}, cache: null, now: NOW, fetchImpl: gh.fetchImpl });
  assert.deepEqual(gh.calls.sort(), ["a/alpha", "b/beta", "c/gamma"], "only new entries with a repository");
  assert.equal(out.releases.alpha.date, "2026-11-01T00:00:00Z");
  assert.equal(out.releases.alpha.version, "1.2");
  assert.equal(out.releases.beta.date, "2026-11-05T00:00:00Z", "drafts are skipped");
  assert.equal(out.releases.beta.version, "v0.9");
  assert.equal(out.releases.gamma.date, null, "never a guess");
  for (const r of Object.values(out.releases)) assert.notEqual((r.date || "").slice(0, 10), "2026-11-10", "never the Editor's update date");
  assert.deepEqual(out.stats, { cached: 0, looked: 3, found: 2, failed: 0, deferred: 0 });
});

test("editor releases: cached answers are reused while nothing changed; misses are re-checked weekly", async () => {
  const first = await run({ directory: DIR, catalogue: CATALOGUE, cache: null, now: NOW, fetchImpl: fakeGitHub().fetchImpl });
  const gh = fakeGitHub();
  const second = await run({ directory: DIR, catalogue: CATALOGUE, cache: first, now: new Date(NOW.getTime() + 86400000), fetchImpl: gh.fetchImpl });
  assert.deepEqual(gh.calls, [], "nothing to ask GitHub the next day");
  assert.deepEqual(second.releases, first.releases);
  const later = new Date(NOW.getTime() + (RECHECK_DAYS + 1) * 86400000);
  assert.deepEqual(plan({ directory: DIR, catalogue: CATALOGUE, cache: first, now: later }).todo.map((n) => n.key), ["gamma"], "only the miss is re-checked");
  const bumped = { entries: DIR.entries.map((e) => (e.key === "alpha" ? { ...e, version: "1.3", updated: "2026-11-16" } : e)) };
  assert.deepEqual(plan({ directory: bumped, catalogue: CATALOGUE, cache: first, now: NOW }).todo.map((n) => n.key), ["alpha"], "a new version is looked up");
});

test("editor releases: a failed lookup is left out tonight, and the run is capped", async () => {
  const out = await run({ directory: DIR, catalogue: CATALOGUE, cache: null, now: NOW, fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(out.stats.failed, 3);
  assert.deepEqual(out.releases, {});
  const capped = await run({ directory: DIR, catalogue: CATALOGUE, cache: null, now: NOW, fetchImpl: fakeGitHub().fetchImpl, max: 1 });
  assert.equal(capped.stats.looked, 1);
  assert.equal(capped.stats.deferred, 2);
});

test("editor releases: lookup returns null for a missing repository", async () => {
  assert.equal(await lookup("nobody/nothing", "1.0", { fetchImpl: fakeGitHub().fetchImpl }), null);
});
