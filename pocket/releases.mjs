// Release dates for the few firmwares The Firmware Hub does not list (their dates come from the Hub otherwise):
// the maker's GitHub release of the version Pocket has, by GitHub's REST API (one call per firmware, only when its
// version is new; earlier answers are kept in the previous catalogue). A version with no matching release stays
// unknown: never a commit date or a guess.
//   node pocket/releases.mjs --catalogue catalog-v2.previous.json --hub hub-catalog.json --upstream pocket-upstream.json --out releases.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { idFromFile } from "./validate.mjs";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const read = (f, d) => (f && existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d);
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

export const tagMatches = (tag, version) => {
  // "v1.2", "1.2", "name-v1.2", "name 1.2": the tag ends with the version, after a start, "v", "-", "_" or a space
  const t = String(tag || "").toLowerCase().trim(), v = String(version || "").toLowerCase().trim().replace(/^v(?=\d)/, "");
  if (!v || !t.endsWith(v)) return false;
  const before = t.slice(0, t.length - v.length);
  return before === "" || /(^|[-_ ])v?$/.test(before) || before === "v";
};

// the maker's GitHub release of this version (or, with no version, the latest release), or null
export async function lookup(repo, version, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "fm1-pocket-player (github.com/slowphase/fm1-pocket-player)", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!r.ok) return null;
  const list = await r.json();
  if (!Array.isArray(list)) return null;
  const rel = version ? list.find((x) => !x.draft && tagMatches(x.tag_name, version)) : list.find((x) => !x.draft && x.published_at);
  return rel ? { version: version || rel.tag_name || null, date: rel.published_at, url: rel.html_url } : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const prev = read(arg("--catalogue"), null) || { firmwares: [] };
  const hub = read(arg("--hub"), null);
  const up = read(arg("--upstream"), { items: [] });
  const hubRepos = new Set(((hub && hub.catalog && hub.catalog.firmwares) || []).map((h) => String(h.repo || "").toLowerCase()));
  const out = {};
  const prevById = new Map((prev.firmwares || []).map((f) => [f.id, f]));
  for (const it of up.items || []) {
    const m = String(it.source || "").match(/github\.com\/([^/]+\/[^/#?]+)/);
    const id = idFromFile(it.file);
    if (!m || !id) continue;
    const repo = m[1].replace(/\.git$/, "");
    if (hubRepos.has(repo.toLowerCase())) continue;                        // the Hub gives this one's date
    const version = String(it.file).replace(/\.rfm1$/, "").slice(id.length + 1);
    if (!version) continue;                                                // no version: unknown, as before
    const old = prevById.get(id)?.release;
    if (old && old.source === "GitHub release" && old.version === version) { out[id] = old; continue; }
    try { const got = await lookup(repo, version); if (got) out[id] = got; } catch { /* unknown tonight */ }
  }
  writeFileSync(arg("--out"), JSON.stringify(out, null, 1) + "\n");
  console.log(`release dates from GitHub for ${Object.keys(out).length} firmwares the Hub does not list`);
}
