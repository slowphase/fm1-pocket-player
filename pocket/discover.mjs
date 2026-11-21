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
// catalog.json, compat.json, The Firmware Hub's catalogue (hub.mjs; at most once a day; optional), and FM1 Editor's
// directory (editor.mjs; optional), which only ever adds listing-only entries (editor-catalogue.mjs).
//
//   node pocket/discover.mjs --data DIR --upstream FILE --report FILE --ledger FILE [--hub FILE] [--previous FILE] [--releases FILE]
//                            [--editor FILE] [--editor-releases FILE] [--editor-aliases FILE] [--reconciliation FILE] [--reconciliation-md FILE]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { idFromFile, licenceOk } from "./validate.mjs";
import { classify, norm } from "./radar.mjs";
import { normaliseCategory } from "./catalog.mjs";
import { ATTRIBUTION, HUB } from "./hub.mjs";
import { webRuntime, nativeRuntime, macosFor, NATIVE } from "./compat.mjs";
import { editorListings, carriedOver, CREDIT } from "./editor-catalogue.mjs";
import { editorOnly, markdown } from "./reconcile.mjs";
import { repository as editorRepo } from "./editor.mjs";

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
  "listing-only": "Listed from FM1 Editor's directory. FM-1 Pocket hasn't reviewed it, so it isn't offered here: get it from its maker.",
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

// "92 playable (31 tested individually on macOS, 61 covered by the macOS sample), 3 experimental (...)"
export function macLine(k) {
  const by = k.macByVerification || {};
  const part = (st) => {
    const v = by[st] || {};
    const bits = [v.macos ? `${v.macos} tested individually on macOS` : "", v.representative ? `${v.representative} covered by the macOS sample` : "",
      v.linux ? `${v.linux} Linux only` : "", v.none ? `${v.none} untested` : ""].filter(Boolean);
    return `${k.mac[st]} ${st}${bits.length ? ` (${bits.join(", ")})` : ""}`;
  };
  return `${part("playable")}, ${part("experimental")}`;
}

export function build({ v1, upstream, report = {}, policy, ledger = { builds: {} }, hub = null, now = new Date(), previous = null, releases = {},
                        editor = null, editorAliases = null, editorReleases = {} }) {
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

  // 2b. FM1 Editor: only the entries Pocket doesn't have, listing-only; every entry above is left exactly as it is
  let editorInfo = null;
  if (editor && editor.entries) {
    const reserved = [...Object.keys(policy.approved || {}), ...Object.keys(policy.excluded || {}), ...Object.keys(policy.withdrawn || {}), ...builtIn];
    const players = builtIn.map((id) => ({ id, repositories: items.filter((it) => idFromFile(it.file) === id).map((it) => editorRepo(it.source)).filter(Boolean) }));
    const got = editorListings({ firmwares: [...byId.values()], directory: editor, aliases: editorAliases || {}, reserved, builtIn: players, previous, releases: editorReleases,
                                 today: now.toISOString().slice(0, 10), catalogueDate: now.toISOString() });
    for (const e of got.entries) byId.set(e.id, e);
    editorInfo = { commit: editor.source?.commit || null, checked: editor.status?.checked || null, listed: (editor.entries || []).length, added: got.entries.length,
                   kept: !!editor.status?.kept, reconciliation: got.report };
  } else {
    // no snapshot tonight (none written, or the read failed before any was kept): keep last night's Editor entries
    for (const e of carriedOver(previous, new Set(byId.keys()))) byId.set(e.id, e);
  }

  // 3. makers, linked to their repositories
  const firmwares = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  for (const e of firmwares) e.makers = e.authors.map((name) => ({ name, url: e.source || null }));

  // 4. discovery dates (both additive; catalog.json's own fields are untouched):
  //    release  the firmware's latest release: its version and the date its maker published it. From the Hub's list
  //             (`published`), or for firmware the Hub does not list, from the maker's GitHub release of that version
  //             (pocket/releases.mjs). Never a catalogue, rebuild or commit date: unknown stays unknown (null).
  //    listed   the day it first appeared in the library: the day the Hub added it, else the day Pocket first saw it
  //             (kept from the previous catalogue). "New to Library" means listed in the last 14 days.
  const rawHub = new Map(((hub && hub.catalog && hub.catalog.firmwares) || []).map((h) => [h.id, h]));
  const prevById = new Map(((previous && previous.firmwares) || []).map((f) => [f.id, f]));
  const today = now.toISOString().slice(0, 10);
  for (const e of firmwares) {
    if (editorOnly(e)) continue;                        // editor-catalogue.mjs set these: maker's release, backfilled listing
    const hid = e.provenance.hub && e.provenance.hub.id, h = hid ? rawHub.get(hid) : null;
    const gh = releases[e.id];
    if (h && h.published) e.release = { version: h.version || null, date: h.published, source: "The Firmware Hub" };
    else if (gh && gh.date) e.release = { version: gh.version || null, date: gh.date, source: "GitHub release", url: gh.url || null };
    else e.release = null;
    const seen = prevById.get(e.id)?.listed;
    e.listed = (h && h.added) || seen || pub.get(e.id)?.added || today;
  }

  const count = (player) => Object.fromEntries(STATES.map((s) => [s, firmwares.filter((e) => e.status[player].state === s).length]));
  const counts = {
    discovered: firmwares.length + builtIn.length,
    builtIn: builtIn.length,
    withBuild: firmwares.filter((e) => e.provenance.remotefm1fw && !e.provenance.remotefm1fw.fantasy).length,
    downloadable: firmwares.filter((e) => e.file).length,
    onHub: hubInfo ? hubInfo.listed : null,
    ...(editorInfo || firmwares.some(editorOnly) ? { fromEditor: firmwares.filter(editorOnly).length } : {}),
    web: count("web"),
    mac: count("mac"),
    // how the Mac statuses of downloadable builds were established
    macVerification: {
      macos: firmwares.filter((e) => e.file && e.status.mac.verification === "macos").length,
      representative: firmwares.filter((e) => e.file && e.status.mac.verification === "representative").length,
      linux: firmwares.filter((e) => e.file && e.status.mac.verification === "linux").length,
      mayStutter: firmwares.filter((e) => e.file && e.status.mac.performance === "may-stutter").length,
    },
    // each Mac state split by how it was established, so individual macOS tests are never reported as sample coverage
    macByVerification: Object.fromEntries(STATES.map((st) => [st, Object.fromEntries(["macos", "representative", "linux", "none"].map((v) =>
      [v, firmwares.filter((e) => e.status.mac.state === st && e.status.mac.verification === v).length]))])),
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
      ...(editorInfo || firmwares.some(editorOnly) ? [{ name: "FM1 Editor", url: CREDIT.url, role: "discovery (listing only)", credit: CREDIT.text,
                         license: "MIT", copyright: (editor && editor.source && editor.source.license && editor.source.license.copyright) || "Copyright (c) 2026 Ben Sparrow",
                         commit: editorInfo ? editorInfo.commit : null, read: editorInfo ? editorInfo.checked : null }] : []),
      { name: "FM-1 Pocket Player", url: "https://github.com/slowphase/fm1-pocket-player", role: "review, checks and hosting" },
    ],
    runtimes: {
      web: ledger.runtimes?.web || webRuntime(),
      mac: { ...(ledger.runtimes?.native || nr), macos: macos ? { verified: macos.verified, date: macos.date, environment: macos.environment, checked: Object.keys(macos.results).length } : null },
    },
    builtIn,
    counts,
    firmwares,
    ...(editorInfo ? { [RECONCILIATION]: editorInfo.reconciliation } : {}),
  };
}
// the reconciliation rides along on the build result for the CLI's report, and is removed before writing
export const RECONCILIATION = Symbol("reconciliation");

// the parts of a v2 catalogue that matter for deciding whether it changed (not its timestamps)
export function fingerprint(c) {
  // `listed` falls back to "today" for a firmware first seen now, so it is a timestamp too: left out
  return JSON.stringify({ c: c.counts, f: c.firmwares.map(({ listed, ...e }) => e), r: { ...c.runtimes, web: { id: c.runtimes.web.id }, mac: { id: c.runtimes.mac.id, macos: c.runtimes.mac.macos && c.runtimes.mac.macos.verified } }, a: !!c.attribution });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const read = (f, d) => (f && existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d);
  const dataDir = arg("--data");
  const v1 = read(join(dataDir, "catalog.json"));
  const policy = read(join(here, "policy.json"));
  const hubCache = read(arg("--hub"), null);
  const c = build({ v1, upstream: read(arg("--upstream"), { items: [] }), report: read(arg("--report"), {}), policy, ledger: read(arg("--ledger"), { builds: {} }), hub: hubCache && hubCache.catalog ? hubCache : null,
                    previous: read(arg("--previous"), null), releases: read(arg("--releases"), {}),
                    editor: read(arg("--editor"), null), editorAliases: read(arg("--editor-aliases") || join(here, "editor-aliases.json"), {}),
                    editorReleases: (read(arg("--editor-releases"), {}) || {}).releases || {} });
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
  // the Editor reconciliation behind tonight's listing-only entries (report only; not part of the catalogue)
  const rec = c[RECONCILIATION];
  if (rec && arg("--reconciliation")) writeFileSync(arg("--reconciliation"), JSON.stringify(rec, null, 1) + "\n");
  if (rec && arg("--reconciliation-md")) writeFileSync(arg("--reconciliation-md"), markdown(rec) + "\n");
  const k = c.counts;
  const line = (p) => STATES.map((s) => `${k[p][s]} ${s}`).join(", ");
  const text = [`## Catalogue v2`, ``,
    `Snapshot ${c.snapshot}. **${k.discovered}** firmwares discovered (${k.builtIn} built in), ${k.withBuild} with a browser build, **${k.downloadable} downloadable** (the same as catalog.json).`,
    k.onHub == null ? `The Firmware Hub: no copy available, so discovery covers RemoteFM1FW only.` : `The Firmware Hub lists ${k.onHub} (read ${c.attribution.read}).`,
    `Web: ${line("web")}.`,
    `Mac: ${macLine(k)}; ${k.mac.unsupported} unsupported, ${k.mac["source-only"]} source-only.`,
    `Mac, of the ${k.downloadable} downloadable: ${k.macVerification.macos} tested individually on macOS, ${k.macVerification.representative} tested on Linux and covered by the representative macOS sample (not run on macOS themselves), ${k.macVerification.linux} Linux only; ${k.macVerification.mayStutter} may stutter.`,
    k.fromEditor == null ? `FM1 Editor: no snapshot, so no listing-only entries.` : `FM1 Editor: ${k.fromEditor} listing-only entries Pocket's other sources don't have (under More Firmware, never downloadable).`,
    `${changed ? "Changed since the last v2." : "No change since the last v2."}`, ``].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, text, { flag: "a" });
  console.log(text);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: "a" });
}
