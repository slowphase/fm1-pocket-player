#!/usr/bin/env node
// FM-1 Pocket Player: the missing-firmware radar.
//
// Compares The Firmware Hub's catalogue (thefirmwarehub.com/catalog.json) with RemoteFM1FW's browser
// builds and with what this site publishes, and sorts every Hub firmware into one of:
//   published         playable here
//   excluded          a browser build exists, but policy keeps it off the site (restricted, fantasy,
//                     built in, withdrawn): never asked about
//   not-published     a browser build exists but isn't on the site (failed checks, or awaiting review):
//                     the failure and review issues cover it
//   not-open          the Hub lists it as link-only or without an open licence: never asked about
//   no-browser-build  no .rfm1 anywhere: a `needs-rfm1` issue, unless it was already missing when the
//                     radar started (the baseline), so the first run doesn't open a flood of issues
// An issue closes itself, naming the published version, once a browser build is on the site.
// The radar never downloads a .fwsc and never compiles anything, and it no longer fetches the Hub itself: it reads
// the copy pocket/hub.mjs keeps (fetched at most once a day, as the Hub asks).
//
//   node pocket/radar.mjs [--dry]      (--dry: print the sorting, touch no issues or state)
//
// State (the baseline) is kept as radar-state.json in the rolling release pocket-current.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseTable, RAW } from "./upstream.mjs";
import { licenceOk, idFromFile } from "./validate.mjs";
import { readCache } from "./hub.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const HUB = "https://thefirmwarehub.com/";
const HUB_CACHE = process.env.HUB_CACHE || "hub-catalog.json";
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const DRY = process.argv.includes("--dry");

export const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const repoKey = (u) => {
  const m = String(u || "").match(/(?:github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/|$)/);
  return m && !/^https?:$/.test(m[1]) ? `${m[1]}/${m[2]}`.toLowerCase() : null;
};

// rows: RemoteFM1FW's table; published: this site's catalogue entries; policy: pocket/policy.json
export function classify(hubFirmwares, rows, published, policy) {
  const builds = rows.map((r) => ({ ...r, id: idFromFile(r.file) })).filter((r) => r.id);
  const byRepo = new Map(), byId = new Map(), byName = new Map();
  for (const b of builds) {
    const k = repoKey(b.source);
    if (k) (byRepo.get(k) || byRepo.set(k, []).get(k)).push(b);
    byId.set(norm(b.id), b);
    byName.set(norm(b.name.replace(/\s+v?\d[\w.+-]*$/i, "")), b);
  }
  const pub = new Map(published.map((f) => [f.id, f]));
  const hubPerRepo = new Map();
  for (const h of hubFirmwares) { const k = repoKey(h.repo || h.source); if (k) hubPerRepo.set(k, (hubPerRepo.get(k) || 0) + 1); }
  return hubFirmwares.map((h) => {
    // the same repository can hold several firmwares (Hortator and Hortator Bluetooth): prefer the
    // build whose id or name also matches, else the only one
    const candidates = byRepo.get(repoKey(h.repo || h.source)) || [];
    const build = candidates.find((b) => norm(b.id) === norm(h.id) || norm(b.name).startsWith(norm(h.name)))
      || (candidates.length === 1 && hubPerRepo.get(repoKey(h.repo || h.source)) === 1 ? candidates[0] : null)
      || byId.get(norm(h.id)) || byName.get(norm(h.name)) || null;
    const base = { hub: h.id, name: h.name, author: h.author, repo: h.repo || null, version: h.version || null, release: h.release || null, what: h.what || "" };
    if (build) {
      const id = build.id;
      if (pub.has(id)) return { ...base, status: "published", id, published: pub.get(id).version };
      if (build.restricted || build.fantasy || policy.excluded[id] || policy.withdrawn[id]) return { ...base, status: "excluded", id };
      return { ...base, status: "not-published", id };
    }
    if (h.linkOnly || !licenceOk(String(h.lic || "").replace(/\s*\+.*$/, "").replace(/^GPL-3\.0$/, "GPL-3.0-only"))) return { ...base, status: "not-open" };
    return { ...base, status: "no-browser-build" };
  });
}

// ---- GitHub ----
async function api(method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method, headers: { accept: "application/vnd.github+json", authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 410) throw Object.assign(new Error("Issues are switched off"), { issuesOff: true });
  if (!r.ok && r.status !== 422) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
async function openIssues(label) {
  const out = [];
  for (let page = 1; page < 20; page++) {
    const xs = await api("GET", `/issues?labels=${label}&state=open&per_page=100&page=${page}`);
    out.push(...xs.filter((i) => !i.pull_request));
    if (xs.length < 100) break;
  }
  return out;
}
const marker = (id) => `<!-- pocket:radar id=${id} -->`;
const idOf = (body) => (String(body || "").match(/<!-- pocket:radar id=([A-Za-z0-9_.-]+) -->/) || [])[1];

function body(f) {
  return [
    marker(f.hub),
    `**${f.name}**${f.version ? " " + f.version : ""} by ${f.author} is on The Firmware Hub, but there's no browser (\`.rfm1\`) build of it yet, so FM-1 Pocket Player can't offer it.`,
    ``,
    `| | |`, `| --- | --- |`,
    `| On the Hub | ${HUB}firmware/${f.hub}/ |`,
    f.repo ? `| Source | https://github.com/${f.repo} |` : "",
    f.release ? `| Latest release | ${f.release} |` : "",
    ``,
    f.what ? `**What it is:** ${f.what}\n` : "",
    `**Nothing to do here.** Browser builds come from [RemoteFM1FW](https://github.com/Quixotic7/RemoteFM1FW), or from the firmware's author, who can attach an \`.rfm1\` to their own releases (see RemoteFM1FW's [docs/AUTHOR-RFM1.md](https://github.com/Quixotic7/RemoteFM1FW/blob/main/docs/AUTHOR-RFM1.md)). When one appears and passes the checks, it goes through the usual review, and this issue closes itself.`,
    ``,
    `<sub>Opened by the nightly radar. It never downloads the Hub's \`.fwsc\` packages or builds anything itself.</sub>`,
  ].filter((l) => l !== "").join("\n");
}

async function loadState() {
  try {
    const out = execFileSync("gh", ["release", "download", "pocket-current", "-p", "radar-state.json", "-O", "-", "--repo", REPO], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(out);
  } catch { return null; }
}
function saveState(state) {
  writeFileSync("radar-state.json", JSON.stringify(state, null, 1) + "\n");
  execFileSync("gh", ["release", "upload", "pocket-current", "radar-state.json", "--clobber", "--repo", REPO], { stdio: "inherit" });
}

async function main() {
  const policy = JSON.parse(readFileSync(join(here, "policy.json"), "utf8"));
  // the copy hub.mjs keeps (read at most once a day by the sync job); the radar never fetches the Hub itself
  let cached = readCache(HUB_CACHE);
  if (!cached) {
    try { execFileSync("gh", ["release", "download", "pocket-current", "-p", "hub-catalog.json", "-O", HUB_CACHE, "--clobber", "--repo", REPO], { stdio: "ignore" }); } catch { /* none yet */ }
    cached = readCache(HUB_CACHE);
  }
  if (!cached) { console.log("Firmware radar: no copy of The Firmware Hub's catalogue yet (the sync job keeps one); nothing to compare."); return; }
  const hub = cached.catalog;
  const rows = parseTable(await (await fetch(RAW + "README.md")).text());
  const published = existsSync("_site/data/catalog.json") ? JSON.parse(readFileSync("_site/data/catalog.json", "utf8")).firmwares
    : JSON.parse(execFileSync("gh", ["release", "download", "pocket-current", "-p", "catalog.json", "-O", "-", "--repo", REPO], { encoding: "utf8" })).firmwares;
  const sorted = classify(hub.firmwares || [], rows, published, policy);
  const count = (s) => sorted.filter((f) => f.status === s).length;
  const missing = sorted.filter((f) => f.status === "no-browser-build");

  const lines = [`## Firmware radar`, ``, `The Hub lists **${sorted.length}** firmwares: ${count("published")} playable here, ${count("excluded")} excluded by policy, ${count("not-published")} with a browser build that isn't on the site, ${count("not-open")} not open source, **${missing.length} without a browser build**.`, ``];
  if (DRY) {
    console.log(lines.join("\n"));
    for (const s of ["no-browser-build", "not-published", "excluded", "not-open"]) console.log(`\n${s}: ${sorted.filter((f) => f.status === s).map((f) => f.hub + (f.id && f.id !== f.hub ? `(${f.id})` : "")).join(", ")}`);
    return;
  }

  let state = await loadState();
  const first = !state;
  if (first) state = { since: new Date().toISOString().slice(0, 10), baseline: missing.map((f) => f.hub).sort() };
  const baseline = new Set(state.baseline);
  const fresh = missing.filter((f) => !baseline.has(f.hub));

  const open = await openIssues("needs-rfm1").catch((e) => { if (e.issuesOff) return null; throw e; });
  if (open) {
    await api("POST", "/labels", { name: "needs-rfm1", color: "c5def5", description: "On the Hub, but no browser build exists yet" });
    for (const f of fresh) {
      const cur = open.find((i) => idOf(i.body) === f.hub), b = body(f);
      if (cur) { if (cur.body !== b) await api("PATCH", `/issues/${cur.number}`, { body: b }); }
      else await api("POST", "/issues", { title: `No browser build yet: ${f.name}`, body: b, labels: ["needs-rfm1"] });
    }
    for (const i of open) {                                // published now, or gone from the Hub: close
      const id = idOf(i.body), f = sorted.find((x) => x.hub === id);
      if (!id || (f && f.status === "no-browser-build")) continue;
      const why = !f ? "It's no longer listed on The Firmware Hub." : f.status === "published" ? `**${f.name} ${f.published}** is now playable on FM-1 Pocket Player.` : "A browser build now exists; any review or check results are in their own issues.";
      await api("POST", `/issues/${i.number}/comments`, { body: `${why} Closing.` });
      await api("PATCH", `/issues/${i.number}`, { state: "closed", state_reason: "completed" });
    }
  } else lines.push("**Issues are switched off**, so no radar issues were opened.");
  lines.push(first ? `First run: the ${missing.length} firmwares already without a browser build are the baseline, so no issues were opened for them.` : `${fresh.length} firmware(s) new to the Hub without a browser build${fresh.length ? ": " + fresh.map((f) => f.name).join(", ") : ""}.`);
  state.checked = new Date().toISOString();
  saveState(state);
  const text = lines.join("\n") + "\n";
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, text, { flag: "a" });
  console.log(text);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!DRY && (!REPO || !TOKEN)) { console.error("needs GITHUB_REPOSITORY and GITHUB_TOKEN (or --dry)"); process.exit(2); }
  main().catch((e) => { console.error(e); process.exit(1); });
}
