// FM-1 Pocket Player: what RemoteFM1FW (github.com/Quixotic7/RemoteFM1FW) offers right now.
//
//   README.md          its table of files (licence, source commit) and the marks on restricted (†) and
//                      RemoteFM1-only "fantasy" (‡) builds
//   catalog/catalog.json   card text (description, category, tag) by firmware id
//   release `current`  the .rfm1 files themselves, with their sizes and SHA-256 digests
//
// Pocket Player does not poll firmware authors itself: RemoteFM1FW's own nightly job already
// takes authors' release builds, checks them and keeps the last good one. We read its result.
export const REPO = "Quixotic7/RemoteFM1FW";
export const RAW = `https://raw.githubusercontent.com/${REPO}/main/`;
export const DOWNLOAD = `https://github.com/${REPO}/releases/download/current/`;
const API = `https://api.github.com/repos/${REPO}/releases/tags/current`;

// One row of the README's firmware table:
// | `file.rfm1` | Name 1.2 † | Author | Licence | [owner/repo](https://github.com/owner/repo/tree/<sha>) |
export function parseTable(md) {
  const rows = [];
  const start = md.indexOf("<!-- rfm1-table:start"), end = md.indexOf("<!-- rfm1-table:end");
  const body = start >= 0 ? md.slice(start, end > start ? end : undefined) : md;
  for (const line of body.split("\n")) {
    const m = line.match(/^\|\s*`([^`]+\.rfm1)`\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const cells = m[2].split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    const [name, author, license, source] = cells;
    const src = source.match(/\((https:\/\/[^)\s]+)\)/);
    const tree = src && src[1].match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/tree\/([0-9a-f]{7,40})$/);
    rows.push({
      file: m[1],
      name: name.replace(/\s*[†‡]+\s*$/, "").trim(),
      author,
      license,
      restricted: name.includes("†"),      // hosted there for download only: not freely redistributable
      fantasy: name.includes("‡"),         // runs in RemoteFM1 hosts only, never on an FM-1
      source: tree ? tree[1] : (src ? src[1] : null),
      commit: tree ? tree[2] : null,
    });
  }
  return rows;
}

// the release's files: name -> { size, sha256 (when GitHub gives a digest), url }
export async function releaseAssets(fetchFn = fetch, token = process.env.GITHUB_TOKEN) {
  const r = await fetchFn(API, { headers: { accept: "application/vnd.github+json", ...(token && { authorization: `Bearer ${token}` }) } });
  if (!r.ok) throw new Error(`${API}: ${r.status}`);
  const rel = await r.json();
  const out = new Map();
  for (const a of rel.assets || []) {
    if (!a.name.endsWith(".rfm1")) continue;
    const d = String(a.digest || "");
    out.set(a.name, { size: a.size, sha256: d.startsWith("sha256:") ? d.slice(7) : null, url: a.browser_download_url, updated: a.updated_at });
  }
  return { published: rel.published_at, assets: out };
}

export async function text(url, fetchFn = fetch) {
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

// Everything upstream offers, joined: [{ file, name, author, license, restricted, fantasy, source,
// commit, card, asset }]. A table row without a release file, or a file without a row, is reported.
export async function offer(fetchFn = fetch) {
  const [md, cat, rel] = await Promise.all([
    text(RAW + "README.md", fetchFn),
    text(RAW + "catalog/catalog.json", fetchFn).then(JSON.parse),
    releaseAssets(fetchFn),
  ]);
  const cards = cat.firmwares || {};
  const rows = parseTable(md);
  const problems = [];
  const seen = new Set();
  const items = rows.map((row) => {
    seen.add(row.file);
    const asset = rel.assets.get(row.file) || null;
    if (!asset) problems.push(`${row.file}: in the README table but not in the release`);
    return { ...row, asset };
  });
  for (const name of rel.assets.keys()) if (!seen.has(name)) problems.push(`${name}: in the release but not in the README table`);
  return { items, cards, problems, published: rel.published };
}
