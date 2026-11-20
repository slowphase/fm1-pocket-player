// Release dates for the few firmwares The Firmware Hub does not list (their dates come from the Hub otherwise):
// the maker's GitHub release of the version Pocket has, by GitHub's REST API (one call per firmware, only when its
// version is new; earlier answers are kept in the previous catalogue). A version with no matching release stays
// unknown: never a commit date or a guess.
//   node pocket/releases.mjs --catalogue catalog-v2.previous.json --hub hub-catalog.json --upstream pocket-upstream.json --out releases.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { idFromFile } from "./validate.mjs";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const read = (f, d) => (f && existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d);
const prev = read(arg("--catalogue"), null) || { firmwares: [] };
const hub = read(arg("--hub"), null);
const up = read(arg("--upstream"), { items: [] });
const hubRepos = new Set(((hub && hub.catalog && hub.catalog.firmwares) || []).map((h) => String(h.repo || "").toLowerCase()));
const token = process.env.GITHUB_TOKEN;

export const tagMatches = (tag, version) => {
  // "v1.2", "1.2", "name-v1.2", "name 1.2": the tag ends with the version, after a start, "v", "-", "_" or a space
  const t = String(tag || "").toLowerCase().trim(), v = String(version || "").toLowerCase().trim().replace(/^v(?=\d)/, "");
  if (!v || !t.endsWith(v)) return false;
  const before = t.slice(0, t.length - v.length);
  return before === "" || /(^|[-_ ])v?$/.test(before) || before === "v";
};

async function lookup(repo, version) {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "fm1-pocket-player (github.com/slowphase/fm1-pocket-player)", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!r.ok) return null;
  const rel = (await r.json()).find((x) => !x.draft && tagMatches(x.tag_name, version));
  return rel ? { version, date: rel.published_at, url: rel.html_url } : null;
}

if (process.argv[1] && process.argv[1].endsWith("releases.mjs")) {
  const out = {};
  const prevById = new Map((prev.firmwares || []).map((f) => [f.id, f]));
  for (const it of up.items || []) {
    const m = String(it.source || "").match(/github\.com\/([^/]+\/[^/#?]+)/);
    const id = idFromFile(it.file);
    if (!m || !id) continue;
    const repo = m[1].replace(/\.git$/, "");
    if (hubRepos.has(repo.toLowerCase())) continue;                        // the Hub gives this one's date
    const version = String(it.file).replace(/\.rfm1$/, "").slice(id.length + 1);
    const old = prevById.get(id)?.release;
    if (old && old.source === "GitHub release" && old.version === version) { out[id] = old; continue; }
    try { const got = await lookup(repo, version); if (got) out[id] = got; } catch { /* unknown tonight */ }
  }
  writeFileSync(arg("--out"), JSON.stringify(out, null, 1) + "\n");
  console.log(`release dates from GitHub for ${Object.keys(out).length} firmwares the Hub does not list`);
}
