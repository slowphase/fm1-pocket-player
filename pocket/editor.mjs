#!/usr/bin/env node
// FM-1 Pocket Player: FM1 Editor's firmware directory, as our own structured snapshot (editor-directory.json).
//
// FM1 Editor (fm1-editor.com, by Ben Sparrow) keeps the broadest list of FM-1 firmware there is. It has no feed: the
// list is the hand-written page firmware/index.html in its public source repository
// github.com/benny-sparra/fm1-dx7-patch-importer, MIT licensed. We read that file from GitHub (never the rendered
// site), at a pinned commit, at most once a day, and turn it into JSON. The apps never read the Editor's HTML: they read
// the catalogue built from this snapshot.
//
// Conservative by design. The parser knows the page's structure and checks it; if the structure changes, entries
// lose required fields, the list shrinks a lot, identifiers repeat, or the repository's licence stops being MIT, the
// new snapshot is refused and the last good one is kept (with the reason recorded), so a broken page never becomes
// a broken catalogue.
//
// What it keeps, per firmware: the Editor's anchor (key), name, maker, status line (channel and version), the date the
// Editor last updated the entry (never a release date: that comes from the maker's release, elsewhere), GitHub stars as
// the Editor counted them, kinds, the Editor's description (MIT, with the notice in the snapshot), its links by role,
// and the canonical GitHub repository (owner/repo, lower case) the entry's source link names.
//
//   node pocket/editor.mjs --out editor-directory.json [--previous FILE]
//   node pocket/editor.mjs --out FILE --html index.html --license LICENSE --commit SHA --committed ISO   (offline)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REPO = "benny-sparra/fm1-dx7-patch-importer";
export const PATH = "firmware/index.html";
export const SITE = "https://fm1-editor.com/firmware/";
export const UA = "fm1-pocket-player (github.com/slowphase/fm1-pocket-player)";
export const KINDS = ["synths", "grooveboxes", "generative", "games", "tools", "samplers", "chords"];
// refuse a new snapshot that has lost more than this share of the last good one's entries
export const MAX_DROP = 0.15;
// and never accept fewer than this many entries at all
export const MIN_ENTRIES = 100;
// at most this share of entries may lack a field that most have (maker, date, description, repository)
const MAX_MISSING = { maker: 0.02, updated: 0.02, description: 0.05, repository: 0.15 };
const GRID = '<div class="firmware-grid dither-well">';

export class StructureError extends Error {}

const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
const text = (html) => decode(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? decode(m[1]) : null; };

// owner/repo, lower case, for a github.com link (not github.io pages, not gists)
export function repository(url) {
  const m = String(url || "").match(/^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (!m || ["orgs", "users", "sponsors", "apps", "marketplace", "topics"].includes(m[1].toLowerCase())) return null;
  return `${m[1]}/${m[2].replace(/\.git$/, "")}`.toLowerCase();
}

// a link's role, from the label the Editor gives it
export function linkRole(label) {
  const l = label.toLowerCase();
  if (/^source|^repository/.test(l)) return "source";
  if (/^releases?\b/.test(l)) return "release";
  if (/^install/.test(l)) return "install";
  if (/^(try|play) it/.test(l)) return "try";
  if (/manual|guide|cheat sheet|controls/.test(l)) return "manual";
  if (/editor|studio|uploader/.test(l)) return "editor";
  if (/^download/.test(l)) return "download";
  if (/^licen[cs]e/.test(l)) return "licence";
  if (/website|site|web app/.test(l)) return "website";
  return "other";
}

// "Beta · Latest 0.1.0" -> { channel: "beta", version: "0.1.0" } ("Build 43" is kept as the version "Build 43"). The channel is the first development stage the line
// names; a numbered latest version with no stage is "release"; anything else keeps the Editor's words in `status`.
const STAGES = [["experimental", /\bexperimental\b/], ["alpha", /\balpha\b/], ["beta", /\bbeta\b/], ["pre-release", /\bpre-?release\b|\bpre-1\.0\b/],
  ["release-candidate", /\brelease candidate\b/], ["test-build", /\btest build\b/], ["preview", /\bpreview\b/], ["in-development", /\bin development\b/],
  ["early", /\bearly\b/]];
export function statusLine(s) {
  const status = String(s || "").trim();
  const parts = status.split(/\s*·\s*/);
  // the version: "Latest X", else "Release 26" or "Build 43"; the stage comes only from the other parts, so a version
  // such as 0.5.2-beta never decides the channel
  let version = null, at = -1;
  for (const [i, p] of parts.entries()) {
    const m = p.match(/^Latest\s+(\S.*)$/) || p.match(/^Release\s+(\d\S*)$/) || p.match(/^(Build\s+\S+)$/);
    if (m && version == null) { version = m[1].trim(); at = i; }
  }
  const words = parts.filter((_, i) => i !== at).join(" · ").toLowerCase();
  const stage = STAGES.find(([, re]) => re.test(words));
  return { status, version, channel: stage ? stage[0] : version ? "release" : "unversioned" };
}

// the page -> { entries, problems }. Throws StructureError when the page is not the structure this parser knows.
export function parse(html) {
  const at = html.indexOf(GRID);
  if (at < 0) throw new StructureError(`the directory grid (${GRID}) is not on the page`);
  const grid = html.slice(at);
  const opened = (grid.match(/<article\b/g) || []).length;
  const blocks = [...grid.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)];
  if (!blocks.length) throw new StructureError("the directory grid holds no entries");
  if (blocks.length !== opened) throw new StructureError(`${opened} entries open but ${blocks.length} close`);
  const entries = [], problems = [];
  for (const [, head, body] of blocks) {
    const cls = attr(head, "class") || "";
    if (!/\bfirmware-entry\b/.test(cls)) throw new StructureError(`an entry without the firmware-entry class (${cls})`);
    const key = attr(head, "id");
    const title = body.match(/<a\s+class="firmware-title-link"[^>]*>([\s\S]*?)<\/a\s*>/);
    if (!key || !title) throw new StructureError(`an entry without ${!key ? "an id" : "a title"} (${key || cls})`);
    const kicker = body.match(/<p\s+class="synthwave-kicker">([\s\S]*?)<\/p>/);
    const statusP = body.match(/<p\s+class="firmware-status">([\s\S]*?)<\/p>/);
    const blurb = body.match(/<p\s+class="firmware-blurb">([\s\S]*?)<\/p>/);
    // the status line: the paragraph without its date, stars and support tags
    // (the stars come last and hold spans of their own, so everything from them on goes first)
    const statusText = statusP ? text(statusP[1]
      .replace(/<span\s+class="firmware-stars"[\s\S]*$/, " ")
      .replace(/<span\s+class="firmware-updated"[\s\S]*?<\/span\s*>/g, " ")
      .replace(/<span\s+class="firmware-tag"[^>]*>[\s\S]*?<\/span\s*>/g, " ")) : "";
    const updated = attr(head, "data-updated");
    const kinds = (attr(head, "data-categories") || "").split(/\s+/).filter(Boolean);
    const stars = attr(head, "data-stars");
    const links = [];
    for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/g)) {
      const href = attr(m[1], "href");
      if (!href || href.startsWith("#")) continue;
      const label = text(m[2]).replace(/\s*↗\s*$/, "").trim();
      links.push({ label, role: linkRole(label), url: href });
    }
    const repos = [...new Set(links.map((l) => repository(l.url)).filter(Boolean))];
    const source = links.find((l) => l.role === "source" && repository(l.url));
    const release = links.find((l) => l.role === "release" && repository(l.url));
    const e = {
      key,
      name: text(title[1]),
      maker: kicker ? text(kicker[1]) : null,
      ...statusLine(statusText),
      updated: updated && /^\d{4}-\d{2}-\d{2}$/.test(updated) ? updated : null,
      stars: stars != null && /^\d+$/.test(stars) ? +stars : null,
      kinds,
      description: blurb ? text(blurb[1]) : null,
      repository: repository((source || release || {}).url) || (repos.length === 1 ? repos[0] : null),
      repositories: repos,
      links,
    };
    for (const k of kinds) if (!KINDS.includes(k)) problems.push(`${key}: a kind this parser does not know (${k})`);
    if (updated && !e.updated) problems.push(`${key}: an update date that is not YYYY-MM-DD (${updated})`);
    entries.push(e);
  }
  return { entries, problems };
}

// the checks a new snapshot must pass; returns the reasons to refuse it (none: accept)
export function refusals(entries, previous = null) {
  const out = [];
  if (entries.length < MIN_ENTRIES) out.push(`only ${entries.length} entries (at least ${MIN_ENTRIES} expected)`);
  const keys = new Map();
  for (const e of entries) keys.set(e.key, (keys.get(e.key) || 0) + 1);
  const dup = [...keys].filter(([, n]) => n > 1).map(([k]) => k);
  if (dup.length) out.push(`entries share an id: ${dup.join(", ")}`);
  for (const e of entries) if (!e.name) out.push(`${e.key}: no name`);
  for (const [field, max] of Object.entries(MAX_MISSING)) {
    const missing = entries.filter((e) => !e[field]).length;
    if (entries.length && missing / entries.length > max) out.push(`${missing} of ${entries.length} entries have no ${field} (more than ${Math.round(max * 100)}%)`);
  }
  const prev = previous && previous.entries ? previous.entries.length : 0;
  if (prev && entries.length < prev * (1 - MAX_DROP)) out.push(`${entries.length} entries, down from ${prev} (more than ${Math.round(MAX_DROP * 100)}% fewer)`);
  return out;
}

// the repository licence must still be the MIT licence that lets us reuse the directory (descriptions included)
export function licence(textOfLicence) {
  const t = String(textOfLicence || "");
  if (!/^\s*MIT License/.test(t) || !/Permission is hereby granted, free of charge/.test(t)) return null;
  const c = t.match(/^\s*(Copyright .+)$/m);
  return { spdx: "MIT", copyright: c ? c[1].trim() : null };
}

// a snapshot from the page at a commit; throws StructureError, or Error with the refusals
export function snapshot({ html, licenceText, commit, committed, checked = new Date().toISOString(), previous = null }) {
  const lic = licence(licenceText);
  if (!lic) throw new Error(`the repository's licence is no longer the MIT licence (commit ${commit})`);
  const { entries, problems } = parse(html);
  const why = refusals(entries, previous);
  if (why.length) throw new Error(why.join("; "));
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const tally = (f) => Object.fromEntries(Object.entries(entries.reduce((m, e) => { for (const v of [].concat(f(e))) m[v] = (m[v] || 0) + 1; return m; }, {})).sort());
  return {
    schema: 1,
    note: "FM1 Editor's firmware directory, read from its source repository and checked by FM-1 Pocket Player (pocket/editor.mjs). `updated` is the date the Editor last changed an entry, never the firmware's release date.",
    source: {
      name: "FM1 Editor", site: SITE, repository: `https://github.com/${REPO}`, path: PATH, commit, committed,
      url: `https://github.com/${REPO}/blob/${commit}/${PATH}`,
      license: { ...lic, url: `https://github.com/${REPO}/blob/${commit}/LICENSE`,
        notice: `FM1 Editor's firmware directory (descriptions included) is ${lic.copyright || "by its author"}, under the MIT License.` },
    },
    status: { ok: true, checked },
    counts: { entries: entries.length, withRepository: entries.filter((e) => e.repository).length, kinds: tally((e) => e.kinds), channels: tally((e) => e.channel) },
    problems,
    entries,
  };
}

// the snapshot without its clock, for "did anything change" and reproducibility
export const content = (s) => JSON.stringify({ ...s, status: undefined });

async function get(url, { json = false, token } = {}) {
  const r = await fetch(url, { headers: { "user-agent": UA, ...(json ? { accept: "application/vnd.github+json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
                              signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return json ? r.json() : r.text();
}

// the latest commit that changed the directory, then that commit's page and licence (two raw reads, one API call; none
// of the raw reads when the commit is the one we already have)
export async function fetchLatest(previous, token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
  const commits = await get(`https://api.github.com/repos/${REPO}/commits?path=${encodeURIComponent(PATH)}&per_page=1`, { json: true, token });
  if (!Array.isArray(commits) || !commits[0]?.sha) throw new Error("GitHub returned no commit for the directory");
  const commit = commits[0].sha, committed = commits[0].commit?.committer?.date || null;
  if (previous && previous.source && previous.source.commit === commit && previous.status?.ok !== false) return { unchanged: true, commit };
  const raw = (p) => get(`https://raw.githubusercontent.com/${REPO}/${commit}/${p}`);
  const [html, licenceText] = await Promise.all([raw(PATH), raw("LICENSE")]);
  return { html, licenceText, commit, committed };
}

// keep the last good snapshot, recording why the new one was not taken
export function fallback(previous, reason, checked = new Date().toISOString()) {
  if (!previous) return null;
  return { ...previous, status: { ok: true, checked: previous.status?.checked || null, kept: true, refused: { at: checked, reason } } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const out = arg("--out");
  if (!out) { console.error("usage: node pocket/editor.mjs --out FILE [--previous FILE] [--html FILE --license FILE --commit SHA --committed ISO]"); process.exit(2); }
  const prevFile = arg("--previous") || out;
  const previous = existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, "utf8")) : null;
  const say = (line) => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n", { flag: "a" }); };
  say("## FM1 Editor directory\n");
  let result;
  try {
    const got = arg("--html")
      ? { html: readFileSync(arg("--html"), "utf8"), licenceText: readFileSync(arg("--license"), "utf8"), commit: arg("--commit") || "local", committed: arg("--committed") || null }
      : await fetchLatest(previous);
    if (got.unchanged) {
      result = { ...previous, status: { ...previous.status, ok: true, checked: new Date().toISOString(), kept: undefined, refused: undefined } };
      say(`Unchanged since commit ${got.commit.slice(0, 7)}: ${previous.counts.entries} entries.`);
    } else {
      result = snapshot({ ...got, previous });
      const before = previous && previous.entries ? new Set(previous.entries.map((e) => e.key)) : null;
      const added = before ? result.entries.filter((e) => !before.has(e.key)).length : null;
      const removed = before ? [...before].filter((k) => !result.entries.some((e) => e.key === k)).length : null;
      say(`Read commit ${got.commit.slice(0, 7)} (${got.committed || "date unknown"}): ${result.counts.entries} entries, ${result.counts.withRepository} with a GitHub repository.` +
          (before ? ` ${added} added and ${removed} removed since the last snapshot.` : ""));
      if (result.problems.length) say(`Notes: ${result.problems.slice(0, 10).join("; ")}${result.problems.length > 10 ? "; …" : ""}`);
    }
  } catch (err) {
    result = fallback(previous, err.message);
    say(`**Refused**: ${err.message}. ${result ? `Keeping the last good snapshot (commit ${String(result.source.commit).slice(0, 7)}, ${result.counts.entries} entries).` : "No earlier snapshot to keep: none is written."}`);
  }
  if (result) writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
}
