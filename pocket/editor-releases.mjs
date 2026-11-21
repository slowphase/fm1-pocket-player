#!/usr/bin/env node
// FM-1 Pocket Player: release dates for FM1 Editor's listing-only entries, from the makers' GitHub releases (Phase 2).
//
// Field priority: a firmware's release date is its maker's GitHub release (then the Hub's, for firmware the Hub lists,
// which discover.mjs handles); never the Editor's "updated" date, which is when the Editor last changed its card.
//
// Only Editor entries Pocket doesn't already have are looked up (reconcile.mjs decides, against the previous
// catalogue), and only those with a GitHub repository. The version the Editor shows picks the release (tag "v1.2",
// "1.2", "name-v1.2"...); with no version, the latest release. A version with no matching release stays unknown.
//
// Cached in editor-releases.json (kept in pocket-current): an answer is reused while the entry's repository, version
// and Editor update date are unchanged; "no release found" is re-checked at most once a week. So the first night makes
// about one API call per new entry, and later nights only a handful.
//
//   node pocket/editor-releases.mjs --editor editor-directory.json --catalogue catalog-v2.previous.json \
//        [--aliases pocket/editor-aliases.json] --cache editor-releases.json --out editor-releases.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reconcile, previousIds } from "./reconcile.mjs";
import { lookup } from "./releases.mjs";

export const RECHECK_DAYS = 7;
export const MAX_LOOKUPS = 400;   // well inside the Actions token's hourly allowance

// which entries to look up, and which cached answers still stand
export function plan({ directory, catalogue, aliases = {}, cache = null, now = new Date() }) {
  const r = reconcile(catalogue || { firmwares: [] }, directory, aliases, { published: previousIds(catalogue) });
  const old = (cache && cache.releases) || {};
  const keep = {}, todo = [];
  for (const n of r.new) {
    if (!n.repository) continue;
    const c = old[n.key];
    const same = c && c.repository === n.repository && (c.editorVersion || null) === (n.version || null) && (c.updated || null) === (n.updated || null);
    const fresh = c && c.checked && (now - new Date(c.checked)) / 86400000 < RECHECK_DAYS;
    if (same && (c.date || fresh)) keep[n.key] = c;
    else todo.push(n);
  }
  return { keep, todo };
}

export async function run({ directory, catalogue, aliases, cache, now = new Date(), fetchImpl = fetch, max = MAX_LOOKUPS }) {
  const { keep, todo } = plan({ directory, catalogue, aliases, cache, now });
  const releases = { ...keep };
  let looked = 0, found = 0, failed = 0;
  for (const n of todo.slice(0, max)) {
    looked++;
    try {
      const got = await lookup(n.repository, n.version, { fetchImpl });
      releases[n.key] = { repository: n.repository, editorVersion: n.version || null, updated: n.updated || null, checked: now.toISOString(),
                          version: got ? got.version : null, date: got ? got.date : null, url: got ? got.url : null };
      if (got) found++;
    } catch { failed++; }   // unknown tonight; tried again tomorrow
  }
  return { schema: 1, note: "Release dates for FM1 Editor's listing-only entries, from the makers' GitHub releases (pocket/editor-releases.mjs). Never the Editor's update date.",
           checked: now.toISOString(), releases, stats: { cached: Object.keys(keep).length, looked, found, failed, deferred: Math.max(0, todo.length - max) } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const read = (f, d) => (f && existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d);
  const directory = read(arg("--editor"), null);
  if (!directory || !directory.entries) { console.log("No FM1 Editor snapshot: no release dates to look up."); process.exit(0); }
  const out = await run({ directory, catalogue: read(arg("--catalogue"), null), aliases: read(arg("--aliases") || new URL("./editor-aliases.json", import.meta.url).pathname, {}),
                          cache: read(arg("--cache"), null) });
  writeFileSync(arg("--out"), JSON.stringify(out, null, 1) + "\n");
  const s = out.stats;
  console.log(`FM1 Editor release dates: ${s.cached} cached, ${s.looked} looked up (${s.found} found, ${s.failed} failed)${s.deferred ? `, ${s.deferred} left for tomorrow` : ""}.`);
}
