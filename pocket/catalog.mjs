#!/usr/bin/env node
// FM-1 Pocket Player: builds the site's firmware catalogue.
//
// Reads a folder of approved .rfm1 files, takes each one's facts from its own manifest (through
// Jake Handy's src/rfm1.js, the same parser the player uses) and its card text from RemoteFM1FW's
// catalog/catalog.json, and writes:
//   OUT/catalog.json             the list the picker loads (small: no firmware bytes)
//   OUT/fw/<id>-<sha8>.rfm1      each firmware, under a name that changes when its bytes do
//
//   node pocket/catalog.mjs --rfm1 DIR --meta catalog.json --out DIR [--previous old-catalog.json]
//                           [--shots DIR]
//
// --previous keeps each firmware's first-added date across updates. --shots is a folder of
// <id>.png screen captures (made by the nightly test); a firmware without one gets no image and
// the picker shows a placeholder.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const R = createRequire(import.meta.url)(join(here, "..", "src", "rfm1.js"));

export const CATEGORIES = ["Synth", "Groovebox", "Drums", "Chords", "Other"];   // RemoteFM1FW's own set

// "Synths" or "synth" or something new: one of CATEGORIES, never an error
export function normaliseCategory(c) {
  const s = String(c || "").trim().toLowerCase().replace(/s$/, "");
  return CATEGORIES.find((k) => k.toLowerCase() === s) || "Other";
}

// the manifest's name often ends with its version ("AMB-1 1.3.2"): the picker shows them apart
export function displayName(name, version) {
  const n = String(name || "").trim(), v = String(version || "").trim();
  return v && n.endsWith(" " + v) ? n.slice(0, -(v.length + 1)) : n;
}

// "https://github.com/a/b@<sha>" -> { repo: "https://github.com/a/b", commit: "<sha>" }
export function splitSource(u) {
  const m = String(u || "").match(/^(https:\/\/[^@\s]+?)(?:@([0-9a-f]{7,40}))?$/);
  return m ? { repo: m[1], commit: m[2] || null } : { repo: null, commit: null };
}

export function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

// one catalogue entry from an .rfm1's bytes, its card text, and what the last catalogue said
export function entryFor(bytes, meta, prev, today) {
  const fw = R.parse(bytes), m = fw.manifest, hash = sha256(bytes), src = splitSource(m.source_url);
  const card = meta || {};
  const changed = !prev || prev.sha256 !== hash;
  return {
    id: m.id,
    name: displayName(m.name, m.version),
    version: String(m.version),
    authors: Array.isArray(m.authors) && m.authors.length ? m.authors : (card.author ? [card.author] : []),
    category: normaliseCategory(card.category),
    tag: card.tag || "",
    about: card.what || "",
    license: m.license,
    source: src.repo,
    commit: src.commit,
    glue: m.glue_url || null,
    builtBy: m.built_by || null,
    abi: m.abi,
    beta: card.beta === true || /(^|[^a-z])(alpha|beta|rc)/i.test(String(m.version)),
    file: `fw/${m.id}-${hash.slice(0, 8)}.rfm1`,
    sha256: hash,
    size: bytes.length,
    added: prev?.added || today,          // first published here; an update never resets it
    updated: changed ? today : prev.updated,
    image: null,
  };
}

export function build({ rfm1Dir, metaFile, outDir, previousFile, shotsDir, now = new Date() }) {
  const today = now.toISOString().slice(0, 10);
  const meta = existsSync(metaFile || "") ? JSON.parse(readFileSync(metaFile, "utf8")).firmwares || {} : {};
  const prev = existsSync(previousFile || "") ? JSON.parse(readFileSync(previousFile, "utf8")) : { firmwares: [] };
  const prevById = new Map((prev.firmwares || []).map((f) => [f.id, f]));
  mkdirSync(join(outDir, "fw"), { recursive: true });
  const out = [];
  for (const f of readdirSync(rfm1Dir).filter((n) => n.endsWith(".rfm1")).sort()) {
    const bytes = readFileSync(join(rfm1Dir, f));
    const e = entryFor(bytes, meta[R.parse(bytes).manifest.id], prevById.get(R.parse(bytes).manifest.id), today);
    if (out.some((x) => x.id === e.id)) throw new Error(`two files carry the firmware id "${e.id}"`);
    copyFileSync(join(rfm1Dir, f), join(outDir, e.file));
    if (shotsDir && existsSync(join(shotsDir, `${e.id}.png`))) {
      mkdirSync(join(outDir, "shots"), { recursive: true });
      e.image = `shots/${e.id}-${e.sha256.slice(0, 8)}.png`;
      copyFileSync(join(shotsDir, `${e.id}.png`), join(outDir, e.image));
    }
    out.push(e);
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  // `since`: the day this catalogue was first published. Firmwares there from the start are not
  // "new"; only those added after it get the picker's New badge (for 14 days).
  const catalog = { schema: 1, updated: now.toISOString(), since: prev.since || today, count: out.length, firmwares: out };
  writeFileSync(join(outDir, "catalog.json"), JSON.stringify(catalog, null, 1) + "\n");
  return catalog;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  if (!arg("--rfm1") || !arg("--out")) {
    console.error("usage: node pocket/catalog.mjs --rfm1 DIR --meta catalog.json --out DIR [--previous FILE] [--shots DIR]");
    process.exit(2);
  }
  const c = build({ rfm1Dir: arg("--rfm1"), metaFile: arg("--meta"), outDir: arg("--out"), previousFile: arg("--previous"), shotsDir: arg("--shots") });
  console.log(`catalogue: ${c.count} firmwares -> ${join(arg("--out"), "catalog.json")}`);
}
