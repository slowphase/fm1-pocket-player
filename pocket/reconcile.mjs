#!/usr/bin/env node
// FM-1 Pocket Player: reconcile FM1 Editor's directory with the Pocket catalogue (Phase 2, report only).
//
// Reads catalog-v2.json and editor-directory.json and says, for every Editor entry, whether Pocket already has it,
// and for every Pocket firmware, whether the Editor lists it. Nothing is changed: this is the review step before any
// Editor entry reaches the catalogue.
//
// Identity is by GitHub repository (owner/repo, lower case), plus the hand-kept table pocket/editor-aliases.json:
//   pairs         Editor key -> the Pocket ids it stands for, where one repository holds several firmwares
//   repositories  old owner/repo -> new owner/repo, for repositories that moved
//   distinct      Editor keys that must never be matched to the Pocket id of the same name
//   ids           Editor key -> the Pocket id a new entry was given (once frozen, never changes)
// Names are never used to match. A repository that points at several Pocket firmwares without a pair is reported as
// ambiguous and kept out of the new entries, so nothing is added twice.
//
// New entries keep the id they were published with (from the previous catalogue), else the table's frozen id, else a
// proposed one: the Editor key, unless an existing Pocket id, a Hub id, a policy id or an id already given has it, in
// which case the repository owner is added (glitch -> glitch-ttreu). An Editor entry that was listed under its own id
// and now matches a Pocket firmware (the Hub or RemoteFM1FW picked it up) is reported as promoted.
//
//   node pocket/reconcile.mjs --catalogue catalog-v2.json --editor editor-directory.json [--aliases FILE] [--out FILE] [--md FILE]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { repository } from "./editor.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const EMPTY = { pairs: {}, repositories: {}, distinct: {}, ids: {} };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// every GitHub repository a Pocket firmware is known by: its source link, and each source's release or source link
export function pocketRepositories(fw, moved = {}) {
  const urls = [fw.source];
  for (const p of Object.values(fw.provenance || {})) if (p && typeof p === "object") urls.push(p.release, p.source);
  const out = new Set();
  for (const u of urls) { const r = repository(u); if (r) out.add(moved[r] || r); }
  return [...out].sort();
}

// a firmware that is in the catalogue only because the Editor listed it
export const editorOnly = (fw) => !!(fw.provenance && fw.provenance.editor) && Object.keys(fw.provenance).length === 1;

// the ids Editor entries were published with last time: Editor key -> id
export function previousIds(previous) {
  const out = {};
  for (const f of (previous && previous.firmwares) || []) if (editorOnly(f) && f.provenance.editor.key) out[f.provenance.editor.key] = f.id;
  return out;
}

// catalogue: the Pocket firmwares (Editor-only ones are left out, so they never match themselves)
// reserved: more ids a new entry must not take (Hub ids, policy ids, built-in ids)
// published: Editor key -> the id it was published with before (previousIds)
// builtIn: firmware built into the players ({ id, repositories }), which the catalogue doesn't list but the Editor may
export function reconcile(catalogue, directory, aliases = EMPTY, { reserved = [], published = {}, builtIn = [] } = {}) {
  const a = { ...EMPTY, ...aliases };
  const moved = a.repositories || {};
  const firmwares = (catalogue.firmwares || []).filter((f) => !editorOnly(f));
  const entries = directory.entries || [];
  const pocketIds = new Set(firmwares.map((f) => f.id));

  const byRepo = new Map();
  for (const fw of firmwares) for (const r of pocketRepositories(fw, moved)) {
    if (!byRepo.has(r)) byRepo.set(r, new Set());
    byRepo.get(r).add(fw.id);
  }

  const matched = [], ambiguous = [], fresh = [], problems = [], promoted = [], inPlayers = [];
  const builtInRepo = new Map(builtIn.flatMap((b) => (b.repositories || []).map((r) => [moved[r] || r, b.id])));
  const covered = new Map();   // Pocket id -> Editor keys
  for (const e of entries) {
    const repos = [...new Set((e.repositories || (e.repository ? [e.repository] : [])).map((r) => moved[r] || r))];
    let ids;
    if (a.pairs[e.key]) {
      ids = a.pairs[e.key].filter((id) => pocketIds.has(id));
      const missing = a.pairs[e.key].filter((id) => !pocketIds.has(id));
      if (missing.length) problems.push(`alias pair ${e.key} names Pocket ids that don't exist: ${missing.join(", ")}`);
    } else {
      ids = [...new Set(repos.flatMap((r) => [...(byRepo.get(r) || [])]))].sort();
    }
    const player = !ids.length && repos.map((r) => builtInRepo.get(r)).find(Boolean);
    if (player) { inPlayers.push({ key: e.key, name: e.name, repositories: repos, builtIn: player }); continue; }
    if (ids.length > 1 && !a.pairs[e.key]) { ambiguous.push({ key: e.key, name: e.name, repositories: repos, pocket: ids }); continue; }
    if (ids.length) {
      matched.push({ key: e.key, name: e.name, repositories: repos, pocket: ids });
      if (published[e.key]) promoted.push({ key: e.key, name: e.name, was: published[e.key], pocket: ids });
      for (const id of ids) covered.set(id, [...(covered.get(id) || []), e.key]);
      continue;
    }
    fresh.push(e);
  }

  // proposed ids for new entries: frozen ones first, then the key, then key-owner, then key-owner-2 ...
  const hubIds = firmwares.map((f) => f.provenance && f.provenance.hub && f.provenance.hub.id).filter(Boolean);
  const taken = new Set([...pocketIds, ...hubIds, ...reserved, ...Object.values(a.ids), ...fresh.map((e) => published[e.key]).filter(Boolean)]);
  const clashes = [];
  const added = fresh.map((e) => {
    let id = published[e.key] || a.ids[e.key];
    if (!id) {
      // at most 40 + 1 + 20 (+ "-NN") characters: the apps accept ids up to 64
      const base = slug(e.key).slice(0, 40).replace(/-+$/, "") || "firmware";
      const owner = (e.repository ? slug(e.repository.split("/")[0]) : "editor").slice(0, 20).replace(/-+$/, "");
      id = base;
      if (taken.has(id) || a.distinct[e.key]) {
        clashes.push({ key: e.key, name: e.name, clashesWith: pocketIds.has(base) ? base : null, reason: a.distinct[e.key] || null });
        id = `${base}-${owner}`;
        for (let n = 2; taken.has(id); n++) id = `${base}-${owner}-${n}`;
      }
      taken.add(id);
    }
    return { id, key: e.key, name: e.name, maker: e.maker, repository: e.repository || null, kinds: e.kinds || [], channel: e.channel || null,
             version: e.version || null, updated: e.updated || null, frozen: !!(published[e.key] || a.ids[e.key]) };
  }).sort((x, y) => x.id.localeCompare(y.id));

  const pocketOnly = firmwares.filter((f) => !covered.has(f.id))
    .map((f) => ({ id: f.id, name: f.name, repositories: pocketRepositories(f, moved), sources: Object.keys(f.provenance || {}).sort() }));
  const sharedPocket = [...covered].filter(([, keys]) => keys.length > 1).map(([id, keys]) => ({ pocket: id, editor: keys }));
  const sharedEditorRepos = [...entries.reduce((m, e) => { if (e.repository) m.set(e.repository, [...(m.get(e.repository) || []), e.key]); return m; }, new Map())]
    .filter(([, keys]) => keys.length > 1).map(([repo, keys]) => ({ repository: repo, editor: keys }));
  for (const key of Object.keys(a.pairs)) if (!entries.some((e) => e.key === key)) problems.push(`alias pair ${key} is not in the Editor's directory any more`);
  for (const key of Object.keys(a.distinct)) if (!entries.some((e) => e.key === key)) problems.push(`distinct key ${key} is not in the Editor's directory any more`);

  return {
    schema: 1,
    inputs: { catalogue: catalogue.updated || catalogue.snapshot || null, editor: directory.source?.commit || null, editorChecked: directory.status?.checked || null },
    counts: { editor: entries.length, pocket: firmwares.length, editorMatched: matched.length, pocketMatched: covered.size,
              ambiguous: ambiguous.length, builtIn: inPlayers.length, promoted: promoted.length, new: added.length, newWithRepository: added.filter((x) => x.repository).length, pocketOnly: pocketOnly.length, idClashes: clashes.length },
    matched, ambiguous, builtIn: inPlayers, promoted, new: added, idClashes: clashes, pocketOnly, sharedPocket, sharedEditorRepos, problems,
  };
}

export function markdown(r) {
  const L = [];
  const c = r.counts;
  L.push("# FM1 Editor reconciliation report", "");
  L.push(`Editor commit ${String(r.inputs.editor || "?").slice(0, 7)}, catalogue ${r.inputs.catalogue || "?"}. New entries are listing-only (under More Firmware, never downloadable); existing entries are unchanged.`, "");
  L.push("| | Count |", "| --- | --- |");
  L.push(`| Editor entries | ${c.editor} |`, `| Pocket firmwares | ${c.pocket} |`, `| Editor entries Pocket already has | ${c.editorMatched} (covering ${c.pocketMatched} Pocket firmwares) |`);
  L.push(`| Built into the players | ${c.builtIn || 0} |`, `| Ambiguous (need an alias pair) | ${c.ambiguous} |`, `| New, listing-only candidates | ${c.new} (${c.newWithRepository} with a GitHub repository) |`);
  L.push(`| Pocket firmwares the Editor doesn't list | ${c.pocketOnly} |`, `| New entries whose Editor key clashes with a Pocket id | ${c.idClashes} |`, "");
  if (r.problems.length) L.push("## Problems", "", ...r.problems.map((p) => `- ${p}`), "");
  const idr = r.identity;
  if (idr && idr.promoted.length) L.push("## Promoted: now also offered by another source, Pocket id kept", "", ...idr.promoted.map((x) => `- ${x.id}: joined to ${x.sources.join(" and ")} (their id ${x.was}); id, listed date and Editor credit kept`), "");
  if (idr && idr.ambiguous.length) L.push("## Identity ambiguous (kept listed under its id; needs a hand-made mapping)", "", ...idr.ambiguous.map((x) => `- ${x.id} (${x.editor}): ${x.candidates.join(", ")}`), "");
  if (idr && idr.guarded.length) L.push("## Kept off an Editor-first id", "", ...idr.guarded.map((x) => `- ${x.id}: ${x.reason}`), "");
  if (r.builtIn && r.builtIn.length) L.push("## Built into the players (not listed again)", "", ...r.builtIn.map((x) => `- ${x.name} (${x.key}): built-in ${x.builtIn}`), "");
  if (r.promoted.length && !(idr && idr.promoted.length)) L.push("## Listed by the Editor under their own id, now matching Pocket's other sources", "", ...r.promoted.map((x) => `- ${x.name}: ${x.was}, matching ${x.pocket.join(", ")}`), "");
  if (r.ambiguous.length) L.push("## Ambiguous", "", ...r.ambiguous.map((x) => `- ${x.name} (${x.key}): ${x.repositories.join(", ")} -> Pocket ${x.pocket.join(", ")}`), "");
  if (r.idClashes.length) L.push("## Id clashes (new entries get the owner added)", "", ...r.idClashes.map((x) => `- ${x.name} (${x.key})${x.clashesWith ? `: Pocket already uses "${x.clashesWith}"` : ""}${x.reason ? `. ${x.reason}` : ""}`), "");
  if (r.sharedPocket.length) L.push("## One Pocket firmware, several Editor entries", "", ...r.sharedPocket.map((x) => `- ${x.pocket}: ${x.editor.join(", ")}`), "");
  if (r.sharedEditorRepos.length) L.push("## One repository, several Editor entries", "", ...r.sharedEditorRepos.map((x) => `- ${x.repository}: ${x.editor.join(", ")}`), "");
  L.push("## Pocket firmwares the Editor doesn't list (unchanged)", "", ...r.pocketOnly.map((x) => `- ${x.name} (${x.id}), from ${x.sources.join(" and ") || "?"}`), "");
  L.push("## New, listing-only candidates", "");
  const kinds = {};
  for (const x of r.new) { const k = x.kinds[0] || "unsorted"; (kinds[k] ||= []).push(x); }
  for (const k of Object.keys(kinds).sort()) {
    L.push(`### ${k} (${kinds[k].length})`, "");
    for (const x of kinds[k]) L.push(`- ${x.name} (id ${x.id}) by ${x.maker || "?"}${x.repository ? `, ${x.repository}` : ", no repository"}${x.channel ? `, ${x.channel}` : ""}${x.version ? ` ${x.version}` : ""}${x.released !== undefined ? (x.released ? `, released ${x.released.slice(0, 10)}` : ", release date unknown") : ""}`);
    L.push("");
  }
  return L.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  if (!arg("--catalogue") || !arg("--editor")) { console.error("usage: node pocket/reconcile.mjs --catalogue FILE --editor FILE [--aliases FILE] [--out FILE] [--md FILE]"); process.exit(2); }
  const read = (f) => JSON.parse(readFileSync(f, "utf8"));
  const r = reconcile(read(arg("--catalogue")), read(arg("--editor")), read(arg("--aliases") || `${HERE}editor-aliases.json`));
  if (arg("--out")) writeFileSync(arg("--out"), JSON.stringify(r, null, 1) + "\n");
  const md = markdown(r);
  if (arg("--md")) writeFileSync(arg("--md"), md + "\n"); else console.log(md);
}
