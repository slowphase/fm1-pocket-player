#!/usr/bin/env node
// FM-1 Pocket Player: the nightly sync. Decides what the site publishes and builds its data folder.
//
//   node pocket/sync.mjs --out _site/data --store pocket-store [--local DIR --readme FILE --cards FILE]
//
// 1. Reads pocket/policy.json and what was published last time (catalog.json in this repository's
//    rolling release `pocket-current`; nothing on the first run).
// 2. Reads what RemoteFM1FW offers now (pocket/upstream.mjs).
// 3. For each firmware: excluded or withdrawn -> never published. Not approved, or its licence
//    changed -> "pending review" (tested, reported, not published). Unchanged -> kept as is.
//    New or updated -> downloaded, checked and boot-tested; it replaces the old version only if it
//    passes; a first-time failure is not published.
// 4. Builds OUT (catalog.json, fw/, shots/) and writes pocket-report.json for the workflow: what
//    changed, what to upload to / delete from the release, what needs review, what failed; and
//    pocket-upstream.json (what RemoteFM1FW offered) for discover.mjs, which builds catalog-v2.json.
//
// --local runs it from a folder of .rfm1 files and copies of RemoteFM1FW's README and catalog,
// with no network: for trying it on a computer.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { offer, parseTable } from "./upstream.mjs";
import { checkFile, smokeTest, judgeSmoke, idFromFile } from "./validate.mjs";
import { build } from "./catalog.mjs";

// pocket-current also holds the pipeline's own state, written by other steps and jobs; never prune it
export const STATE_ASSETS = new Set(["compat.json", "hub-catalog.json", "native-macos.json", "catalog-v2.json", "radar-state.json"]);

const here = dirname(fileURLToPath(import.meta.url));
const RELEASE = "pocket-current";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("--out", "_site/data"), STORE = arg("--store", "pocket-store"), LOCAL = arg("--local");
const REPO = process.env.GITHUB_REPOSITORY || "slowphase/fm1-pocket-player";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const gh = (path) => fetch(`https://api.github.com/repos/${REPO}${path}`, { headers: { accept: "application/vnd.github+json", ...(TOKEN && { authorization: `Bearer ${TOKEN}` }) } });

// fetch with a time limit, a size limit and a few patient retries
async function download(url, maxBytes = 32 << 20) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
      if (r.ok) {
        const b = Buffer.from(await r.arrayBuffer());
        if (b.length > maxBytes) throw new Error(`larger than ${maxBytes >> 20} MiB`);
        return b;
      }
      if (r.status !== 429 && r.status < 500) throw new Error(`${url}: ${r.status}`);
      if (i === 3) throw new Error(`${url}: ${r.status}`);
    } catch (e) { if (i === 3 || /MiB|: 4\d\d/.test(e.message)) throw e; }
    await new Promise((ok) => setTimeout(ok, 3000 << i));
  }
}

// last time's catalogue and where its files are kept
async function previous() {
  if (LOCAL) {
    const f = join(STORE, "catalog.json");          // the store folder stands in for the release
    const assets = new Map(existsSync(STORE) ? readdirSync(STORE).filter((n) => !n.startsWith(".")).map((n) => [n, join(STORE, n)]) : []);
    return { catalog: existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null, assets };
  }
  const r = await gh(`/releases/tags/${RELEASE}`);
  if (r.status === 404) return { catalog: null, assets: new Map() };
  if (!r.ok) throw new Error(`could not read release ${RELEASE}: ${r.status}`);
  const rel = await r.json(), assets = new Map((rel.assets || []).map((a) => [a.name, a.browser_download_url]));
  const cat = assets.has("catalog.json") ? JSON.parse(String(await download(assets.get("catalog.json")))) : null;
  return { catalog: cat, assets };
}

// a published file, from the cache folder or the release
async function stored(name, assets) {
  const p = join(STORE, name);
  if (existsSync(p)) return readFileSync(p);
  if (!assets.has(name)) return null;
  const b = await download(assets.get(name));
  writeFileSync(p, b);
  return b;
}

async function upstreamOffer() {
  if (!LOCAL) return offer();
  const md = readFileSync(arg("--readme"), "utf8"), cards = JSON.parse(readFileSync(arg("--cards"), "utf8")).firmwares || {};
  const items = parseTable(md).map((row) => {
    const f = join(LOCAL, row.file);
    return { ...row, asset: existsSync(f) ? { size: 0, sha256: sha256(readFileSync(f)), url: f, local: true } : null };
  });
  return { items, cards, problems: [], published: null };
}

async function main() {
  const policy = JSON.parse(readFileSync(join(here, "policy.json"), "utf8"));
  const hostingHolds = JSON.parse(readFileSync(join(here, "hosting-holds.json"), "utf8")).holds;
  mkdirSync(STORE, { recursive: true });
  const prev = await previous();
  const prevById = new Map((prev.catalog?.firmwares || []).map((f) => [f.id, f]));
  const up = await upstreamOffer();
  const report = { changed: false, kept: [], updated: [], added: [], removed: [], rejected: [], pending: [], skipped: [], problems: up.problems, upload: [], remove: [] };

  // the staging folder catalog.mjs reads: one .rfm1 per published firmware, and shots/<id>.png
  const stage = join(STORE, ".stage");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, "shots"), { recursive: true });
  const publish = new Map();                          // id -> { file name in release, bytes, shot }

  const keep = async (id, why) => {                   // carry last time's version forward
    const p = prevById.get(id);
    if (!p) return false;
    const base = p.file.replace(/^fw\//, "");
    const bytes = await stored(base, prev.assets);
    if (!bytes || sha256(bytes) !== p.sha256) { report.problems.push(`${id}: the published file could not be recovered`); return false; }
    const shotName = p.image ? p.image.replace(/^shots\//, "") : null;
    const shot = shotName ? await stored(shotName, prev.assets) : null;
    publish.set(id, { base, bytes, shot, shotName });
    if (why) report.kept.push(why);
    return true;
  };

  for (const it of up.items) {
    const id = idFromFile(it.file);
    if (!id) { report.problems.push(`${it.file}: no firmware id in the file name`); continue; }
    if (policy.excluded[id] || policy.withdrawn[id] || it.restricted || it.fantasy || hostingHolds.some(h => h.ids.includes(id))) { report.skipped.push(id); continue; }
    if (!it.asset) { if (await keep(id)) report.problems.push(`${id}: missing from RemoteFM1FW's release; kept the last good version`); continue; }
    const p = prevById.get(id);
    if (p && it.asset.sha256 && p.sha256 === it.asset.sha256 && policy.approved[id]) { await keep(id); continue; }

    // new or changed: fetch and test it
    let bytes;
    try { bytes = it.asset.local ? readFileSync(it.asset.url) : await download(it.asset.url); }
    catch (e) { if (!(await keep(id))) report.rejected.push({ id, why: [`could not download: ${e.message}`] }); continue; }
    if (p && p.sha256 === sha256(bytes) && policy.approved[id]) { await keep(id); continue; }
    const chk = checkFile(bytes, it, it.asset.sha256);
    const ap = policy.approved[id];
    const licenceChanged = ap && chk.manifest && ap.license !== chk.manifest.license;
    const tmp = join(stage, `${id}.candidate.rfm1`);
    writeFileSync(tmp, bytes);
    const shotPath = join(stage, "shots", `${id}.png`);
    const smoke = chk.problems.length ? null : await smokeTest(tmp, shotPath);
    const exc = policy.smokeExceptions[id];
    const smokeProblems = smoke ? judgeSmoke(smoke, exc && exc.checks.includes("sound")).filter((x) => !(exc && exc.checks.includes("redraw") && /did not change/.test(x))) : [];
    const problems = [...chk.problems, ...smokeProblems];
    rmSync(tmp, { force: true });

    if (!ap || licenceChanged) {                       // a person decides; nothing is published meanwhile
      report.pending.push({ id, file: it.file, name: chk.manifest?.name || it.name, version: chk.manifest?.version, authors: chk.manifest?.authors || [it.author],
        license: chk.manifest?.license || it.license, previousLicense: ap?.license || null, source: it.source, commit: it.commit,
        problems, warnings: chk.warnings, card: up.cards[id] || null });
      if (licenceChanged) await keep(id, `${id}: licence changed, waiting for review; kept the last approved version`);
      continue;
    }
    if (problems.length) {
      if (await keep(id)) report.rejected.push({ id, version: chk.manifest?.version, why: problems, kept: true });
      else report.rejected.push({ id, version: chk.manifest?.version, why: problems, kept: false });
      continue;
    }
    const base = `${id}-${chk.sha.slice(0, 8)}.rfm1`;
    const shot = existsSync(shotPath) ? readFileSync(shotPath) : null;
    publish.set(id, { base, bytes, shot, shotName: shot ? `${id}-${chk.sha.slice(0, 8)}.png` : null });
    (p ? report.updated : report.added).push({ id, version: chk.manifest.version, from: p?.version || null });
  }
  // approved firmwares no longer offered upstream come down (a takedown wins over an old build)
  for (const id of prevById.keys()) if (!publish.has(id)) report.removed.push(id);

  // stage and build
  for (const [id, f] of publish) {
    writeFileSync(join(stage, f.base), f.bytes);
    writeFileSync(join(STORE, f.base), f.bytes);
    if (f.shot) { writeFileSync(join(stage, "shots", `${id}.png`), f.shot); writeFileSync(join(STORE, f.shotName), f.shot); }
    else rmSync(join(stage, "shots", `${id}.png`), { force: true });
  }
  const cardsFile = join(stage, "..", ".cards.json");
  writeFileSync(cardsFile, JSON.stringify({ firmwares: up.cards }));
  const prevFile = join(stage, "..", ".previous.json");
  writeFileSync(prevFile, JSON.stringify(prev.catalog || { firmwares: [] }));
  rmSync(OUT, { recursive: true, force: true });
  const cat = build({ rfm1Dir: stage, metaFile: cardsFile, outDir: OUT, previousFile: prevFile, shotsDir: join(stage, "shots") });

  // every entry points at a file that is there and is what it says
  for (const f of cat.firmwares) {
    const p = join(OUT, f.file);
    if (!existsSync(p) || sha256(readFileSync(p)) !== f.sha256) throw new Error(`catalogue entry ${f.id} does not match its file`);
    if (f.image && !existsSync(join(OUT, f.image))) throw new Error(`catalogue entry ${f.id} names a missing image`);
  }

  // what the release should hold now
  const want = new Set(["catalog.json"]);
  for (const f of cat.firmwares) { want.add(f.file.replace(/^fw\//, "")); if (f.image) want.add(f.image.replace(/^shots\//, "")); }
  for (const name of want) if (name !== "catalog.json" && !prev.assets.has(name)) report.upload.push(join(STORE, name));
  for (const name of prev.assets.keys()) if (!want.has(name) && !STATE_ASSETS.has(name)) report.remove.push(name);
  const before = JSON.stringify((prev.catalog?.firmwares || []).map((f) => [f.id, f.sha256, f.about, f.category, f.tag]));
  const after = JSON.stringify(cat.firmwares.map((f) => [f.id, f.sha256, f.about, f.category, f.tag]));
  report.changed = before !== after || !prev.catalog;
  if (!report.changed && prev.catalog) {               // nothing new: keep last time's dates exactly
    cat.updated = prev.catalog.updated;
    writeFileSync(join(OUT, "catalog.json"), JSON.stringify(cat, null, 1) + "\n");
  }
  copyFileSync(join(OUT, "catalog.json"), join(STORE, "catalog.json"));
  report.upload.push(join(STORE, "catalog.json"));
  report.count = cat.count;
  report.checked = new Date().toISOString();
  rmSync(stage, { recursive: true, force: true });
  writeFileSync("pocket-report.json", JSON.stringify(report, null, 1) + "\n");
  // what RemoteFM1FW offered, for discover.mjs (catalog-v2.json) so it need not read it again
  writeFileSync("pocket-upstream.json", JSON.stringify({
    read: report.checked,
    items: up.items.map(({ asset, ...row }) => ({ ...row, asset: asset ? { size: asset.size, sha256: asset.sha256 } : null })),
    cards: up.cards,
  }) + "\n");
  summary(report);
}

function summary(r) {
  const lines = [
    `## FM-1 Pocket Player sync`,
    ``,
    `**${r.count} firmwares published.** ${r.changed ? "The library changed." : "No changes since last time."}`,
    ``,
  ];
  const list = (title, xs, fmt) => { if (xs.length) lines.push(`**${title}** (${xs.length})`, ...xs.map((x) => `- ${fmt(x)}`), ``); };
  list("Added", r.added, (x) => `${x.id} ${x.version}`);
  list("Updated", r.updated, (x) => `${x.id} ${x.from} → ${x.version}`);
  list("Removed", r.removed, (x) => x);
  list("Rejected", r.rejected, (x) => `${x.id} ${x.version || ""}: ${x.why.join("; ")}${x.kept ? " (the last good version stays up)" : " (not published)"}`);
  list("Waiting for review", r.pending, (x) => `${x.id} ${x.version || ""} (${x.license})`);
  list("Notes", [...r.kept, ...r.problems], (x) => x);
  const text = lines.join("\n") + "\n";
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  console.log(text);
}

main().catch((e) => { console.error(e); process.exit(1); });
