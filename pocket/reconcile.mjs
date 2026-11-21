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
// New entries get a proposed id: the Editor key, unless an existing Pocket id (or an id already given) has it, in
// which case the repository owner is added (glitch -> glitch-ttreu).
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

export function reconcile(catalogue, directory, aliases = EMPTY) {
  const a = { ...EMPTY, ...aliases };
  const moved = a.repositories || {};
  const firmwares = catalogue.firmwares || [];
  const entries = directory.entries || [];
  const pocketIds = new Set(firmwares.map((f) => f.id));

  const byRepo = new Map();
  for (const fw of firmwares) for (const r of pocketRepositories(fw, moved)) {
    if (!byRepo.has(r)) byRepo.set(r, new Set());
    byRepo.get(r).add(fw.id);
  }

  const matched = [], ambiguous = [], fresh = [], problems = [];
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
    if (ids.length > 1 && !a.pairs[e.key]) { ambiguous.push({ key: e.key, name: e.name, repositories: repos, pocket: ids }); continue; }
    if (ids.length) {
      matched.push({ key: e.key, name: e.name, repositories: repos, pocket: ids });
      for (const id of ids) covered.set(id, [...(covered.get(id) || []), e.key]);
      continue;
    }
    fresh.push(e);
  }

  // proposed ids for new entries: frozen ones first, then the key, then key-owner, then key-owner-2 ...
  const taken = new Set([...pocketIds, ...Object.values(a.ids)]);
  const clashes = [];
  const added = fresh.map((e) => {
    let id = a.ids[e.key];
    if (!id) {
      const base = slug(e.key);
      const owner = e.repository ? slug(e.repository.split("/")[0]) : "editor";
      id = base;
      if (taken.has(id) || a.distinct[e.key]) {
        clashes.push({ key: e.key, name: e.name, clashesWith: pocketIds.has(base) ? base : null, reason: a.distinct[e.key] || null });
        id = `${base}-${owner}`;
        for (let n = 2; taken.has(id); n++) id = `${base}-${owner}-${n}`;
      }
      taken.add(id);
    }
    return { id, key: e.key, name: e.name, maker: e.maker, repository: e.repository || null, kinds: e.kinds || [], channel: e.channel || null,
             version: e.version || null, updated: e.updated || null, frozen: !!a.ids[e.key] };
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
              ambiguous: ambiguous.length, new: added.length, newWithRepository: added.filter((x) => x.repository).length, pocketOnly: pocketOnly.length, idClashes: clashes.length },
    matched, ambiguous, new: added, idClashes: clashes, pocketOnly, sharedPocket, sharedEditorRepos, problems,
  };
}

export function markdown(r) {
  const L = [];
  const c = r.counts;
  L.push("# FM1 Editor reconciliation report", "");
  L.push(`Editor commit ${String(r.inputs.editor || "?").slice(0, 7)}, catalogue ${r.inputs.catalogue || "?"}. Report only: nothing here is in the catalogue yet.`, "");
  L.push("| | Count |", "| --- | --- |");
  L.push(`| Editor entries | ${c.editor} |`, `| Pocket firmwares | ${c.pocket} |`, `| Editor entries Pocket already has | ${c.editorMatched} (covering ${c.pocketMatched} Pocket firmwares) |`);
  L.push(`| Ambiguous (need an alias pair) | ${c.ambiguous} |`, `| New, listing-only candidates | ${c.new} (${c.newWithRepository} with a GitHub repository) |`);
  L.push(`| Pocket firmwares the Editor doesn't list | ${c.pocketOnly} |`, `| New entries whose Editor key clashes with a Pocket id | ${c.idClashes} |`, "");
  if (r.problems.length) L.push("## Problems", "", ...r.problems.map((p) => `- ${p}`), "");
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
    for (const x of kinds[k]) L.push(`- ${x.name} (id ${x.id}) by ${x.maker || "?"}${x.repository ? `, ${x.repository}` : ", no repository"}${x.channel ? `, ${x.channel}` : ""}${x.version ? ` ${x.version}` : ""}`);
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
