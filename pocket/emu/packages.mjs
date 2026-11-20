// Finds each Hub firmware's original package (.fwsc) in its maker's release, as The Firmware Hub's rules ask
// ("download the packages from the makers' releases, not from the hub"), and keeps it only if its SHA-256 is the
// one the Hub lists. Reads the Hub's catalogue from a saved copy (pocket/hub.mjs keeps it); never fetches it.
//
//   node pocket/emu/packages.mjs --hub hub-catalog.json --out DIR [--only id,id]
//   DIR/<hub id>.fwsc for each one found, DIR/packages.json: every Hub firmware and what happened.
// GitHub releases are read with the GitHub API (GITHUB_TOKEN); a maker release elsewhere is reported, not guessed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const out = arg("--out"); mkdirSync(out, { recursive: true });
const hubCopy = JSON.parse(readFileSync(arg("--hub"), "utf8"));
const cat = hubCopy.catalog || hubCopy;
const only = arg("--only") ? new Set(arg("--only").split(",")) : null;
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const UA = "FM-1 Pocket Player emulator evaluation (+https://github.com/slowphase/fm1-pocket-player)";
const sha = (b) => createHash("sha256").update(b).digest("hex");

async function api(path) {
  const r = await fetch(`https://api.github.com/${path}`, { headers: { "User-Agent": UA, Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!r.ok) throw new Error(`GitHub API ${r.status} for ${path}`);
  return r.json();
}
async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/octet-stream", ...(token && url.startsWith("https://api.github.com") ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const rows = [];
for (const f of cat.firmwares) {
  if (only && !only.has(f.id)) continue;
  const row = { hub: f.id, name: f.name, version: f.version, author: f.author, repo: f.repo, license: f.lic, chip: f.chip, product: f.product,
    hubPackage: basename(f.pkg || ""), hubSha256: f.sha256, hubSize: f.size, release: f.release };
  const m = String(f.release || "").match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/tag\/(.+)$/);
  if (!m) { row.status = "maker release not on GitHub"; rows.push(row); continue; }
  try {
    const rel = await api(`repos/${m[1]}/releases/tags/${encodeURIComponent(decodeURIComponent(m[2]))}`);
    const assets = rel.assets || [];
    row.assets = assets.map((a) => a.name);
    // the Hub's file name first, then any package of the Hub's size, then any package at all
    const cands = [...assets.filter((a) => a.name === row.hubPackage), ...assets.filter((a) => a.name !== row.hubPackage && a.size === f.size),
      ...assets.filter((a) => a.name !== row.hubPackage && a.size !== f.size && /\.(fwsc|ufw)$/i.test(a.name))];
    let found = null;
    for (const a of cands) {
      const b = await get(a.browser_download_url);
      if (sha(b) === f.sha256) { found = { a, b }; break; }
      row.mismatched = [...(row.mismatched || []), a.name];
    }
    if (found) {
      writeFileSync(join(out, `${f.id}.fwsc`), found.b);
      row.status = "found"; row.url = found.a.browser_download_url; row.asset = found.a.name; row.sha256 = f.sha256;
    } else row.status = cands.length ? "maker's packages differ from the Hub's SHA-256" : "no package in the maker's release";
  } catch (e) { row.status = `release not readable: ${e.message}`; }
  rows.push(row);
  process.stdout.write(`${f.id}: ${row.status}\n`);
}
writeFileSync(join(out, "packages.json"), JSON.stringify({ read: new Date().toISOString(), hubRead: hubCopy.fetchedAt || null, firmwares: rows }, null, 1) + "\n");
const n = {}; for (const r of rows) n[r.status] = (n[r.status] || 0) + 1;
const text = `## Original packages from the makers' releases\n\n${rows.length} Hub firmwares: ${Object.entries(n).map(([k, v]) => `${v} ${k}`).join(", ")}.\n`;
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, text, { flag: "a" });
console.log(text);
