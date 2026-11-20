#!/usr/bin/env node
// FM-1 Pocket Player: the expanded catalogue, catalog-v2.json.
//
// catalog.json (schema 1) stays exactly as it was: the firmwares both players may download and play, under the same
// rules. catalog-v2.json lists everything discovered, one entry per firmware identity, with:
//
//   the v1 fields         for downloadable builds, identical to their catalog.json entry (so a v2 client downloads
//                         the very same files)
//   status.web/mac        per player: playable | experimental | unsupported | source-only, why, and the test record
//                         (build SHA-256, runtime, environment, date, outcome) from compat.json
//   restriction           why it cannot be downloaded here, when it cannot (restricted, not an FM-1 firmware, awaiting
//                         review, failed checks, no build exists, no open licence, excluded by policy)
//   makers                each maker, linked to their repository (the Hub's terms ask for this)
//   provenance            which source said what: RemoteFM1FW (the build), The Firmware Hub (discovery), this site
//
// Sources: RemoteFM1FW's table and cards (as sync.mjs read them), pocket/policy.json, sync's report, the published
// catalog.json, compat.json, and The Firmware Hub's catalogue (hub.mjs; at most once a day; optional).
//
//   node pocket/discover.mjs --data DIR --upstream FILE --report FILE --ledger FILE [--hub FILE] [--previous FILE]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { idFromFile, licenceOk } from "./validate.mjs";
import { classify, norm } from "./radar.mjs";
import { normaliseCategory } from "./catalog.mjs";
import { ATTRIBUTION, HUB } from "./hub.mjs";
import { webRuntime, nativeRuntime, macosFor, NATIVE } from "./compat.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const STATES = ["playable", "experimental", "unsupported", "source-only"];
// below this many times real time in the native engine's boot test (which includes compiling and booting), a
// build may stutter on a Mac
export const SLOW = 1.2;
// builds below this native speed on Linux are also run individually on macOS (borderline ones get a real measure)
export const SLOW_CHECK = 2;

// the reason a firmware cannot be downloaded here, by code (the text players show)
export const RESTRICTIONS = {
  "restricted": "RemoteFM1FW marks this build as containing material its licences don't let anyone freely redistribute, so it is not hosted here. Get it from its source.",
  "not-fm1": "A build for RemoteFM1's own apps only, never an FM-1 firmware.",
  "excluded": "Not published here by FM-1 Pocket Player's policy.",
  "withdrawn": "Withdrawn from this site.",
  "awaiting-review": "A browser build exists and is waiting for FM-1 Pocket Player's review.",
  "failed-checks": "A browser build exists but did not pass FM-1 Pocket Player's checks, so it is not hosted.",
  "no-build": "No browser (.rfm1) build of this firmware exists yet, so neither player can run it. Get it from its source.",
  "not-open": "The Firmware Hub lists no open licence for it, so it is not offered here.",
};

const versionFromFile = (file, id) => String(file).replace(/\.rfm1$/, "").slice(id.length + 1) || "";
const repoUrl = (r) => !r ? null : /^https?:\/\//.test(r) ? r.replace(/\/tree\/.*$/, "") : `https://github.com/${String(r).replace(/\/tree\/.*$/, "")}`;

// a Hub "kind" as one of RemoteFM1FW's categories (catalog.mjs's normaliseCategory turns "Drums" into "Other",
// because it strips the plural before comparing; v1 keeps that behaviour unchanged, v2 maps Hub kinds here)
export function hubCategory(kind) {
  const k = String(kind || "").toLowerCase();
  return { synth: "Synth", groove: "Groovebox", groovebox: "Groovebox", drums: "Drums", drum: "Drums", chords: "Chords", chord: "Chords" }[k] || "Other";
}

// one player's status for a downloadable build, from its compat.json record
// How the Mac status was established (status.mac.verification):
//   "macos"          this exact build ran on macOS in the native engine (the macOS job tests it individually)
//   "representative" this build passed the native engine on Linux, and a representative sample passed on macOS
//                    for the same engine commit; this build itself has not been run on macOS
//   "linux"          native engine on Linux only; macOS has not verified this engine commit
// status.mac.performance is "may-stutter" when the build ran below SLOW times real time (macOS speed when this
// build was measured on macOS, else the Linux speed).
export function playerStatus(player, rec, macos) {
  if (!rec) return { state: "experimental", reason: `Not tested in the ${player === "web" ? "web" : "native"} player yet.`, ...(player === "mac" ? { verification: "none" } : {}) };
  const tested = { sha256: rec.sha256, runtime: rec.runtime, environment: rec.environment, date: rec.date, outcome: rec.outcome };
  const note = rec.exception ? ` ${rec.exception}` : "";
  if (player !== "mac") {
    if (rec.outcome === "fail") return { state: "unsupported", reason: `Did not pass the web player's checks: ${rec.problems.join("; ")}.`, tested };
    return { state: "playable", reason: `Passed the web player's checks.${note}`, tested };
  }
  const sameEngine = macos && macos.runtime === rec.runtime;
  const mine = sameEngine && macos.results ? macos.results[rec.id] : null;
  // a macOS result counts for this build only if it was this exact build (same sha256)
  const own = mine && mine.sha256 && mine.sha256 === rec.sha256 ? mine : null;
  const verification = own ? "macos" : sameEngine && macos.verified ? "representative" : "linux";
  const macTested = own
    ? { date: macos.date, environment: macos.environment, outcome: own.outcome, ...(own.result && typeof own.result.speed === "number" ? { speed: own.result.speed } : {}) }
    : sameEngine ? { date: macos.date, environment: macos.environment, sample: true } : null;
  const t = macTested ? { ...tested, macos: macTested } : tested;
  if (rec.outcome === "fail") return { state: "unsupported", verification, reason: `Did not pass the native engine's checks on Linux: ${rec.problems.join("; ")}.`, tested: t };
  if (own && own.outcome === "fail") return { state: "unsupported", verification, reason: `Passed on Linux but did not pass the native engine's checks on macOS: ${(own.problems || []).join("; ")}.`, tested: t };
  // the native engine interprets WebAssembly, so a heavy firmware can pass its checks and still run too slowly
  const linuxSpeed = rec.result && typeof rec.result.speed === "number" ? rec.result.speed : null;
  const macSpeed = own && own.result && typeof own.result.speed === "number" ? own.result.speed : null;
  const speed = macSpeed != null ? macSpeed : linuxSpeed;
  if (speed != null && speed < SLOW) {
    const where = macSpeed != null ? `ran at ${macSpeed}x real time when tested on macOS` : `ran at ${linuxSpeed}x real time on the Linux test machine and has not been timed on macOS yet`;
    return { state: "experimental", verification, performance: "may-stutter", reason: `Passed the native engine's checks, but ${where}, so it may stutter on a Mac.${note}`, tested: t };
  }
  if (verification === "linux") {
    const why = !sameEngine ? "this engine version has not yet been verified on macOS" : "the macOS check for this engine version did not fully pass";
    return { state: "experimental", verification, reason: `Passed the native engine's checks on Linux; ${why}.${note}`, tested: t };
  }
  if (verification === "macos") return { state: "playable", verification, reason: `Tested individually on macOS (and on Linux) with the Mac app's engine.${note}`, tested: t };
  return { state: "playable", verification, reason: `Passed the Mac app's engine on Linux; not run individually on macOS, but a representative sample passed there with the same engine version.${note}`, tested: t };
}

export function build({ v1, upstream, report = {}, policy, ledger = { builds: {} }, hub = null, now = new Date() }) {
  const items = upstream.items || [], cards = upstream.cards || {};
  const pub = new Map((v1.firmwares || []).map((f) => [f.id, f]));
  const pending = new Map((report.pending || []).map((p) => [p.id, p]));
  const rejected = new Map((report.rejected || []).filter((r) => !r.kept).map((r) => [r.id, r]));
  const macos = macosFor(ledger, nativeRuntime().id);
  const byId = new Map();
  const builtIn = [];

  // 1. every RemoteFM1FW build, by firmware id (the identity its file and manifest carry)
  for (const it of items) {
    const id = idFromFile(it.file);
    if (!id) continue;
    if (id === "h1" || /built into/i.test(policy.excluded[id] || "")) { builtIn.push(id); continue; }
    const p = pub.get(id), card = cards[id] || {};
    const source = p?.source || repoUrl(it.source);
    const e = {
      id,
      name: p?.name || it.name.replace(/\s+v?\d[\w.+-]*$/, "") || id,
      version: p?.version || versionFromFile(it.file, id),
      authors: p?.authors || (it.author ? [it.author] : []),
      category: p?.category || normaliseCategory(card.category),
      tag: p?.tag ?? card.tag ?? "",
      about: p?.about ?? card.what ?? "",
      license: p?.license || it.license || "",
      source, commit: p?.commit || it.commit || null,
      beta: p ? p.beta : card.beta === true,
      provenance: { remotefm1fw: { file: it.file, version: versionFromFile(it.file, id), commit: it.commit || null, source: it.source || null, restricted: !!it.restricted, fantasy: !!it.fantasy, sha256: it.asset?.sha256 || null } },
    };
    if (p) {
      Object.assign(e, { glue: p.glue, builtBy: p.builtBy, abi: p.abi, file: p.file, sha256: p.sha256, size: p.size, added: p.added, updated: p.updated, image: p.image });
      e.provenance.pocket = { published: p.version, sha256: p.sha256 };
      const rec = ledger.builds[p.sha256];
      e.status = {
        web: playerStatus("web", rec?.web && { ...rec.web, sha256: p.sha256, id }, null),
        mac: playerStatus("mac", rec?.native && { ...rec.native, sha256: p.sha256, id }, macos),
      };
    } else {
      let code = "excluded";
      if (it.restricted) code = "restricted";
      else if (it.fantasy) code = "not-fm1";
      else if (policy.withdrawn[id]) code = "withdrawn";
      else if (policy.excluded[id]) code = "excluded";
      else if (pending.has(id)) code = "awaiting-review";
      else if (rejected.has(id)) code = "failed-checks";
      else if (!it.asset) code = "no-build";
      const reason = code === "failed-checks" ? `${RESTRICTIONS[code]} (${rejected.get(id).why.join("; ")})`
        : code === "excluded" && policy.excluded[id] ? policy.excluded[id] : RESTRICTIONS[code];
      e.restriction = { code, reason };
      const state = code === "not-fm1" ? "unsupported" : "source-only";
      const web = code === "failed-checks" ? { state: "unsupported", reason } : { state, reason };
      e.status = { web, mac: { state, reason } };
    }
    byId.set(id, e);
  }

  // 2. The Firmware Hub: attach it to the build it describes, or add it as its own entry
  let hubInfo = null;
  if (hub && hub.catalog) {
    const rows = items.map((it) => ({ ...it }));
    const sorted = classify(hub.catalog.firmwares || [], rows, v1.firmwares || [], policy);
    const raw = new Map((hub.catalog.firmwares || []).map((h) => [h.id, h]));
    hubInfo = { read: hub.fetchedAt, listed: sorted.length };
    for (const s of sorted) {
      const h = raw.get(s.hub) || {};
      const hubProv = { id: s.hub, url: `${HUB}firmware/${encodeURIComponent(s.hub)}/`, version: h.version || null, release: h.release || null, kind: Array.isArray(h.kind) ? h.kind[0] : (h.kind || null), license: h.lic || null };
      const repo = repoUrl(h.repo || h.source);
      if (s.id && byId.has(s.id)) {
        const e = byId.get(s.id);
        e.provenance.hub = hubProv;
        if (!e.source && repo) e.source = repo;
        continue;
      }
      if (s.id && builtIn.includes(s.id)) continue;
      let id = s.hub;
      if (byId.has(id)) id = "hub-" + id;               // a different firmware that happens to share a build's id
      const code = s.status === "not-open" ? "not-open" : "no-build";
      const kind = Array.isArray(h.kind) ? h.kind[0] : h.kind;
      byId.set(id, {
        id, name: h.name || s.hub, version: h.version || "", authors: h.author ? [h.author] : [],
        category: hubCategory(kind),
        tag: "", about: "", license: h.lic || "", source: repo, commit: null, beta: h.beta === true,
        restriction: { code, reason: RESTRICTIONS[code] },
        status: { web: { state: "source-only", reason: RESTRICTIONS[code] }, mac: { state: "source-only", reason: RESTRICTIONS[code] } },
        provenance: { hub: hubProv },
      });
    }
  }

  // 3. makers, linked to their repositories
  const firmwares = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  for (const e of firmwares) e.makers = e.authors.map((name) => ({ name, url: e.source || null }));

  const count = (player) => Object.fromEntries(STATES.map((s) => [s, firmwares.filter((e) => e.status[player].state === s).length]));
  const counts = {
    discovered: firmwares.length + builtIn.length,
    builtIn: builtIn.length,
    withBuild: firmwares.filter((e) => e.provenance.remotefm1fw && !e.provenance.remotefm1fw.fantasy).length,
    downloadable: firmwares.filter((e) => e.file).length,
    onHub: hubInfo ? hubInfo.listed : null,
    web: count("web"),
    mac: count("mac"),
    // how the Mac statuses of downloadable builds were established
    macVerification: {
      macos: firmwares.filter((e) => e.file && e.status.mac.verification === "macos").length,
      representative: firmwares.filter((e) => e.file && e.status.mac.verification === "representative").length,
      linux: firmwares.filter((e) => e.file && e.status.mac.verification === "linux").length,
      mayStutter: firmwares.filter((e) => e.file && e.status.mac.performance === "may-stutter").length,
    },
  };
  const nr = nativeRuntime();
  return {
    schema: 2,
    snapshot: now.toISOString(),
    updated: v1.updated,
    since: v1.since,
    note: "Downloadable entries carry exactly their catalog.json fields. Clients that read schema 1 keep using catalog.json, which is unchanged.",
    attribution: hubInfo ? { ...ATTRIBUTION, read: hubInfo.read } : null,
    sources: [
      { name: "RemoteFM1FW", url: "https://github.com/Quixotic7/RemoteFM1FW", role: "browser (.rfm1) builds" },
      ...(hubInfo ? [{ name: "The Firmware Hub", url: ATTRIBUTION.url, role: "discovery", read: hubInfo.read, license: ATTRIBUTION.license }] : []),
      { name: "FM-1 Pocket Player", url: "https://github.com/slowphase/fm1-pocket-player", role: "review, checks and hosting" },
    ],
    runtimes: {
      web: ledger.runtimes?.web || webRuntime(),
      mac: { ...(ledger.runtimes?.native || nr), macos: macos ? { verified: macos.verified, date: macos.date, environment: macos.environment, checked: Object.keys(macos.results).length } : null },
    },
    builtIn,
    counts,
    firmwares,
  };
}

// the parts of a v2 catalogue that matter for deciding whether it changed (not its timestamps)
export function fingerprint(c) {
  return JSON.stringify({ c: c.counts, f: c.firmwares, r: { ...c.runtimes, web: { id: c.runtimes.web.id }, mac: { id: c.runtimes.mac.id, macos: c.runtimes.mac.macos && c.runtimes.mac.macos.verified } }, a: !!c.attribution });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const read = (f, d) => (f && existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d);
  const dataDir = arg("--data");
  const v1 = read(join(dataDir, "catalog.json"));
  const policy = read(join(here, "policy.json"));
  const hubCache = read(arg("--hub"), null);
  const c = build({ v1, upstream: read(arg("--upstream"), { items: [] }), report: read(arg("--report"), {}), policy, ledger: read(arg("--ledger"), { builds: {} }), hub: hubCache && hubCache.catalog ? hubCache : null });
  // the downloadable entries must be exactly catalog.json's
  const fields = Object.keys((v1.firmwares || [])[0] || {});
  const v1ids = new Set(v1.firmwares.map((f) => f.id));
  for (const f of v1.firmwares) {
    const e = c.firmwares.find((x) => x.id === f.id);
    if (!e) throw new Error(`catalog-v2 is missing ${f.id}`);
    for (const k of fields) if (JSON.stringify(e[k]) !== JSON.stringify(f[k])) throw new Error(`catalog-v2's ${f.id}.${k} differs from catalog.json`);
  }
  for (const e of c.firmwares) if (e.file && !v1ids.has(e.id)) throw new Error(`catalog-v2 offers ${e.id} for download, but catalog.json does not`);
  const prev = read(arg("--previous"), null);
  const changed = !prev || prev.schema !== 2 || fingerprint(prev) !== fingerprint(c);
  if (!changed) c.snapshot = prev.snapshot;
  writeFileSync(join(dataDir, "catalog-v2.json"), JSON.stringify(c, null, 1) + "\n");
  const k = c.counts;
  const line = (p) => STATES.map((s) => `${k[p][s]} ${s}`).join(", ");
  const text = [`## Catalogue v2`, ``,
    `Snapshot ${c.snapshot}. **${k.discovered}** firmwares discovered (${k.builtIn} built in), ${k.withBuild} with a browser build, **${k.downloadable} downloadable** (the same as catalog.json).`,
    k.onHub == null ? `The Firmware Hub: no copy available, so discovery covers RemoteFM1FW only.` : `The Firmware Hub lists ${k.onHub} (read ${c.attribution.read}).`,
    `Web: ${line("web")}.`, `Mac: ${line("mac")}.`,
    `Mac, of the ${k.downloadable} downloadable: ${k.macVerification.macos} tested individually on macOS, ${k.macVerification.representative} tested on Linux and covered by the representative macOS sample, ${k.macVerification.linux} Linux only; ${k.macVerification.mayStutter} may stutter.`,
    `${changed ? "Changed since the last v2." : "No change since the last v2."}`, ``].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, text, { flag: "a" });
  console.log(text);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: "a" });
}
