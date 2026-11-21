// FM-1 Pocket Player: permanent Pocket ids for firmware first discovered through FM1 Editor.
//
// A firmware Pocket first listed from FM1 Editor's directory keeps its Pocket id for good. When The Firmware Hub or
// RemoteFM1FW later offers the same firmware, that source is joined to the existing record ("promotion"): the record
// keeps its id, its listed date and its Editor credit, and gains the new source's verified package information and
// playback capabilities. The Editor id is never retired, no duplicate is made, and the record never reads
// "No longer listed" just because another source now offers it.
//
// The ids each source uses are kept apart from the Pocket id:
//   upstreamIds   { hub: <The Firmware Hub's id>, remotefm1fw: <the build's file/manifest id> }
//   aliases       every other id the firmware is known by, so catalog.json (whose ids are baked into the .rfm1 files)
//                 and older links still resolve to the same record
// Package resolution keeps using the source ids: the emulator layer finds packages by provenance.hub.id, and
// RemoteFM1FW builds keep their own file and manifest id in catalog.json.
//
// Identity is remembered in three places, so it survives a lost night:
//   1. identities.json (pocket-current, a protected state asset): grows only, one record per Editor-first id
//   2. the previous catalogue (the same facts, on every record that carries provenance.editor)
//   3. pocket/editor-aliases.json "identities": hand-made mappings, which win
// A newcomer is joined to a record by its recorded upstream id, else by repository when exactly one newcomer shares
// it. Ambiguous cases are reported and the record stays listed as it is, until a hand-made mapping settles them.
// Firmware already established in the catalogue under its own id is never renamed.
import { pocketRepositories, editorOnly } from "./reconcile.mjs";
import { attributedDescription } from "./editor-catalogue.mjs";

const SOURCES = ["hub", "remotefm1fw"];

// Pocket id -> { editor, repository, hub, remotefm1fw, since }, from the ledger, the previous catalogue and the table
export function identities({ ledger = null, previous = null, aliases = {} } = {}) {
  const out = new Map();
  const merge = (id, rec) => {
    if (!id || !rec) return;
    const cur = out.get(id) || {};
    for (const [k, v] of Object.entries(rec)) if (v != null && v !== "") cur[k] = cur[k] ?? v;
    out.set(id, cur);
  };
  // hand-made mappings first, so they win
  for (const [id, rec] of Object.entries((aliases && aliases.identities) || {})) merge(id, { ...rec, explicit: true });
  for (const [id, rec] of Object.entries((ledger && ledger.ids) || {})) merge(id, rec);
  for (const f of (previous && previous.firmwares) || []) {
    const ed = f.provenance && f.provenance.editor;
    if (!ed || !ed.key) continue;
    merge(f.id, { editor: ed.key, repository: ed.repository || null, hub: f.upstreamIds?.hub || f.provenance.hub?.id || null,
                  remotefm1fw: f.upstreamIds?.remotefm1fw || null, since: f.listed || null, backfill: ed.listedBackfill ? true : null });
  }
  return out;
}

// the id a source gives a record: the Hub's id, or the RemoteFM1FW build's id
function sourceIds(e) {
  const ids = {};
  if (e.provenance && e.provenance.hub && e.provenance.hub.id) ids.hub = e.provenance.hub.id;
  if (e.provenance && e.provenance.remotefm1fw) ids.remotefm1fw = (e.upstreamIds && e.upstreamIds.remotefm1fw) || e.id;
  return ids;
}

// Join newcomers from the Hub or RemoteFM1FW to the Editor-first records they belong to, in place.
//   byId       discover.mjs's entries from the Hub and RemoteFM1FW (before the Editor's listings are added)
//   known      identities()
//   previous   last night's catalogue: ids it carried under their own name are established and never renamed
//   directory  tonight's Editor snapshot, for the record's Editor credit and description
// Returns the report: promoted, kept (already joined), ambiguous, guarded (newcomers kept off an Editor id).
export function preserveIds({ byId, known, previous = null, directory = null, moved = {} }) {
  const prevEntries = (previous && previous.firmwares) || [];
  // ids last night's catalogue carried as a firmware's own (not as an alias): those are never renamed
  const established = new Set(prevEntries.filter((f) => !editorOnly(f) && !known.has(f.id)).map((f) => f.id));
  const prevById = new Map(prevEntries.map((f) => [f.id, f]));
  const byKey = new Map(((directory && directory.entries) || []).map((e) => [e.key, e]));
  const report = { promoted: [], ambiguous: [], guarded: [] };
  const joinable = (e) => !established.has(e.id) && !editorOnly(e);
  const bySource = (e, rec) => { const ids = sourceIds(e); return (rec.hub && ids.hub === rec.hub) || (rec.remotefm1fw && ids.remotefm1fw === rec.remotefm1fw); };
  const byRepo = (e, rec) => !!rec.repository && pocketRepositories(e, moved).includes(rec.repository);

  // a newcomer that would take an Editor-first id but is a different firmware gets a source-specific id instead
  for (const [id, rec] of known) {
    const e = byId.get(id);
    if (!e || !joinable(e) || bySource(e, rec) || byRepo(e, rec)) continue;
    const ids = sourceIds(e), src = ids.hub ? "hub" : "rfm1";
    let nid = `${id}-${src}`;
    for (let n = 2; byId.has(nid) || known.has(nid); n++) nid = `${id}-${src}-${n}`;
    byId.delete(id);
    e.id = nid;
    e.upstreamIds = { ...(e.upstreamIds || {}), ...ids };
    e.aliases = [...new Set([...(e.aliases || []), id])];
    byId.set(nid, e);
    report.guarded.push({ id: nid, was: id, reason: `"${id}" is the Pocket id of a firmware first listed by FM1 Editor (${rec.editor}), so this different firmware gets its own id` });
  }

  for (const [id, rec] of known) {
    // the record itself, when a source already uses its id; else the newcomer carrying a recorded upstream id; else the
    // one newcomer sharing its repository (unless a hand-made mapping names the upstream ids, which then must match)
    const self = byId.get(id);
    let cands = self && joinable(self) ? [self] : [];
    if (!cands.length) cands = [...byId.values()].filter((e) => joinable(e) && bySource(e, rec));
    if (!cands.length && !(rec.explicit && (rec.hub || rec.remotefm1fw))) cands = [...byId.values()].filter((e) => joinable(e) && byRepo(e, rec));
    if (!cands.length) continue;
    if (cands.length > 1 || (self && !editorOnly(self) && cands[0] !== self)) {
      report.ambiguous.push({ id, editor: rec.editor, repository: rec.repository || null, candidates: [...new Set([...(self ? [self.id] : []), ...cands.map((e) => e.id)])].sort() });
      continue;
    }
    const e = cands[0], was = e.id, ids = sourceIds(e);
    byId.delete(was);
    e.id = id;
    e.upstreamIds = { ...(e.upstreamIds || {}), ...ids };
    const aliases = [...new Set([...(e.aliases || []), was, ...Object.values(ids)])].filter((a) => a !== id);
    if (aliases.length) e.aliases = aliases; else delete e.aliases;
    // the record keeps its Editor credit, its first-listed day (and whether that was the backfill) and the Editor's
    // description with its credit
    const before = prevById.get(id);
    const live = rec.editor && byKey.get(rec.editor);
    const prevEd = before && before.provenance && before.provenance.editor;
    e.provenance.editor = live
      ? { key: live.key, url: `https://fm1-editor.com/firmware/#${encodeURIComponent(live.key)}`, commit: (directory.source && directory.source.commit) || null,
          version: live.version || null, channel: live.channel || null, updated: live.updated || null, kinds: live.kinds || [], repository: live.repository || null }
      : { ...(prevEd || { key: rec.editor || null, url: rec.editor ? `https://fm1-editor.com/firmware/#${encodeURIComponent(rec.editor)}` : null, repository: rec.repository || null }) };
    if ((prevEd && prevEd.listedBackfill) || rec.backfill) e.provenance.editor.listedBackfill = true;
    e.credit = (before && before.credit) || { text: "Listed by FM1 Editor", url: "https://fm1-editor.com/firmware/" };
    // the Editor's description rides along with its credit (never in `about`, which the new source owns)
    const desc = live ? attributedDescription(live.description, live.key, directory) : (before && before.attributedDescription) || null;
    if (desc) e.attributedDescription = desc;
    e.promoted = { from: "FM1 Editor", sources: Object.keys(ids).sort(), listed: (before && before.listed) || rec.since || null };
    byId.set(id, e);
    report.promoted.push({ id, was, sources: Object.keys(ids).sort(), editor: rec.editor || null });
  }
  return report;
}

// tonight's identity ledger: every record that carries provenance.editor, merged into the old ledger (never shrinks)
export function nextLedger(old, firmwares, today) {
  const ids = { ...((old && old.ids) || {}) };
  for (const f of firmwares) {
    const ed = f.provenance && f.provenance.editor;
    if (!ed || !ed.key) continue;
    const cur = ids[f.id] || {};
    const src = f.upstreamIds || {};
    ids[f.id] = { editor: cur.editor || ed.key, repository: cur.repository || ed.repository || null,
                  hub: cur.hub || src.hub || null, remotefm1fw: cur.remotefm1fw || src.remotefm1fw || null, since: cur.since || f.listed || today,
                  ...((cur.backfill || ed.listedBackfill) ? { backfill: true } : {}) };
  }
  return { schema: 1, note: "Permanent Pocket ids for firmware first discovered through FM1 Editor (pocket/identity.mjs). Records are only ever added.",
           ids: Object.fromEntries(Object.entries(ids).sort(([a], [b]) => a.localeCompare(b))) };
}

// catalog.json's downloadable entries must be exactly catalog-v2's, matched by id or, for a promoted record, by alias
// (catalog.json's ids are the .rfm1 files' own; catalog-v2 keeps the Pocket id and lists the build's id as an alias)
export function checkAgainstV1(c, v1) {
  const fields = Object.keys((v1.firmwares || [])[0] || {});
  const find = (id) => c.firmwares.find((x) => x.id === id && x.file) || c.firmwares.find((x) => x.file && (x.aliases || []).includes(id)) ||
                       c.firmwares.find((x) => x.id === id);
  const seen = new Set();
  for (const f of v1.firmwares || []) {
    const e = find(f.id);
    if (!e) throw new Error(`catalog-v2 is missing ${f.id}`);
    seen.add(e);
    for (const k of fields) {
      if (k === "id" && e.id !== f.id && (e.aliases || []).includes(f.id)) continue;
      if (JSON.stringify(e[k]) !== JSON.stringify(f[k])) throw new Error(`catalog-v2's ${f.id}.${k} differs from catalog.json`);
    }
  }
  for (const e of c.firmwares) if (e.file && !seen.has(e)) throw new Error(`catalog-v2 offers ${e.id} for download, but catalog.json does not`);
}

export { SOURCES };
