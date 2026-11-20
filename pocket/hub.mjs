#!/usr/bin/env node
// FM-1 Pocket Player: The Firmware Hub's catalogue, read at most once a day.
//
// The Hub's terms (thefirmwarehub.com/kb/#catalog): read catalog.json at most once a day with a User-Agent that
// says who you are; its compilation is CC BY 4.0 (credit "Firmware list: The Firmware Hub" with a working link,
// state the licence and whether you changed anything); the makers' card texts and pictures are not under that
// licence (name each maker and link its repository). Only this nightly job reads it; neither player ever does.
//
// The copy is kept as hub-catalog.json ({ fetchedAt, url, userAgent, catalog }) in the pocket-current release.
//
//   node pocket/hub.mjs --cache FILE [--no-fetch]     reuse FILE if it is less than a day old, else fetch
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const HUB = "https://thefirmwarehub.com/";
export const HUB_CATALOG = HUB + "catalog.json";
export const USER_AGENT = "FM-1 Pocket Player nightly sync (+https://github.com/slowphase/fm1-pocket-player)";
export const MAX_AGE_MS = 24 * 3600 * 1000;
export const ATTRIBUTION = {
  text: "Firmware list: The Firmware Hub – https://thefirmwarehub.com",
  url: "https://thefirmwarehub.com",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  changes: "FM-1 Pocket Player combines the Hub's list (names, makers, versions, kinds and repositories) with RemoteFM1FW's builds and its own checks. The makers' card texts and pictures are not copied; each maker is named and linked to their repository.",
};

export function readCache(file) {
  if (!file || !existsSync(file)) return null;
  try {
    const c = JSON.parse(readFileSync(file, "utf8"));
    return c && c.fetchedAt && c.catalog && Array.isArray(c.catalog.firmwares) ? c : null;
  } catch { return null; }
}

// -> { cache, fetched: bool, note }. Never fetches when the cached copy is younger than a day, or when allowFetch
// is false. A failed or malformed fetch keeps the old copy.
export async function hubCatalogue({ cacheFile, allowFetch = true, now = Date.now(), fetchFn = fetch } = {}) {
  const old = readCache(cacheFile);
  const age = old ? now - Date.parse(old.fetchedAt) : Infinity;
  if (old && age < MAX_AGE_MS) return { cache: old, fetched: false, note: `reused the copy from ${old.fetchedAt} (less than a day old)` };
  if (!allowFetch) return { cache: old, fetched: false, note: old ? `reused the copy from ${old.fetchedAt} (fetching not allowed here)` : "no copy, and fetching is not allowed here" };
  try {
    const r = await fetchFn(HUB_CATALOG, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const catalog = await r.json();
    if (!catalog || !Array.isArray(catalog.firmwares) || !catalog.firmwares.length) throw new Error("no firmware list in it");
    const cache = { fetchedAt: new Date(now).toISOString(), url: HUB_CATALOG, userAgent: USER_AGENT, catalog };
    if (cacheFile) writeFileSync(cacheFile, JSON.stringify(cache) + "\n");
    return { cache, fetched: true, note: `fetched ${catalog.firmwares.length} firmwares` };
  } catch (e) {
    return { cache: old, fetched: false, note: `could not fetch (${e.message})${old ? `; kept the copy from ${old.fetchedAt}` : ""}` };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const cacheFile = arg("--cache");
  if (!cacheFile) { console.error("usage: node pocket/hub.mjs --cache FILE [--no-fetch]"); process.exit(2); }
  const r = await hubCatalogue({ cacheFile, allowFetch: !process.argv.includes("--no-fetch") });
  console.log(`The Firmware Hub: ${r.note}`);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `fetched=${r.fetched}\nhave=${!!r.cache}\n`, { flag: "a" });
}
