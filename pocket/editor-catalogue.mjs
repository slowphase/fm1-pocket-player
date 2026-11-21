// FM-1 Pocket Player: FM1 Editor's directory as listing-only catalogue entries (Phase 2).
//
// An adapter, not a rewrite: discover.mjs builds every existing entry exactly as before, then hands its entries to
// editorListings(), which adds only the Editor entries Pocket doesn't have (pocket/reconcile.mjs decides which, by
// repository and the alias table). Existing entries are never touched.
//
// Every new entry is listing-only: source-only for both players, never downloadable, never offered to the emulator,
// never auto-approved. It appears under More Firmware with the restriction code "listing-only".
//
// Field priorities (CATALOGUE-SOURCES.md):
//   packages, checksums, licence   The Firmware Hub, then the maker; never the Editor. An Editor-only entry has none.
//   release date                   the maker's GitHub release (pocket/editor-releases.mjs), then the Hub; never the
//                                  Editor's "updated" date (that is when the Editor last edited its card).
//   everything else                the Editor fills gaps only: name, maker, version, channel, kinds, links.
// Descriptions: the Editor's own text is MIT licensed, but whether to show it is still an open choice, so by default
// entries carry facts and links only (DESCRIPTIONS below).
//
// Credit: each entry says it was listed by FM1 Editor (provenance.editor and credit), and never carries the Hub's
// provenance, so no app shows The Firmware Hub's credit on it.
//
// Listed dates: the first import is backfilled to the day the Editor's directory began (BACKFILL_LISTED), so 160
// entries don't all appear as New to Library at once; after that, an entry keeps the day it was first listed, and an
// entry the Editor adds later is listed on the day Pocket first sees it.
import { reconcile, previousIds, editorOnly } from "./reconcile.mjs";
import { SITE } from "./editor.mjs";

export const DESCRIPTIONS = false;
export const BACKFILL_LISTED = "2026-10-07";
export const CREDIT = { text: "Listed by FM1 Editor", url: SITE };
export const REASON = "Listed from FM1 Editor's directory. FM-1 Pocket hasn't reviewed it, so it isn't offered here: get it from its maker.";
export const UTILITY_TAG = "Tool or utility";

// Editor kinds -> Pocket categories, for new entries only: the first kind the Editor gives decides
const CATEGORY = { synths: "Synth", grooveboxes: "Groovebox", chords: "Chords" };
export function editorCategory(kinds = []) {
  if (kinds.includes("tools")) return "Other";
  return CATEGORY[kinds[0]] || "Other";
}
const RELEASED = new Set(["release", "unversioned"]);

// the best link to the firmware itself: its repository, else the Editor's source, install or release page, else its
// card. Never a direct file download (a .zip or package), so opening "source" in an app shows a page.
const FILE = /\.(zip|fwsc|rfm1|bin|hex|uf2|tar|gz|tgz|7z)(\?.*)?$/i;
export function sourceOf(e) {
  if (e.repository) return `https://github.com/${e.repository}`;
  const by = (role) => (e.links || []).find((l) => l.role === role && !FILE.test(l.url))?.url;
  return by("source") || by("install") || by("release") || `${SITE}#${encodeURIComponent(e.key)}`;
}

// one listing-only entry; makers, release and listed are filled in by discover.mjs's common steps
export function listing(e, id, source) {
  const reason = REASON;
  const entry = {
    id, name: e.name, version: e.version || "", authors: e.maker ? [e.maker] : [],
    category: editorCategory(e.kinds),
    tag: (e.kinds || []).includes("tools") ? UTILITY_TAG : "",
    about: DESCRIPTIONS ? e.description || "" : "",
    license: "", source: sourceOf(e), commit: null,
    beta: !!e.channel && !RELEASED.has(e.channel),
    restriction: { code: "listing-only", reason },
    status: { web: { state: "source-only", reason }, mac: { state: "source-only", reason } },
    provenance: { editor: {
      key: e.key, url: `${SITE}#${encodeURIComponent(e.key)}`, commit: source.commit || null,
      version: e.version || null, channel: e.channel || null, updated: e.updated || null, kinds: e.kinds || [],
      repository: e.repository || null,
    } },
    credit: CREDIT,
    links: (e.links || []).map((l) => ({ role: l.role, url: l.url })),
  };
  if ((e.kinds || []).includes("tools")) entry.utility = true;
  return entry;
}

// the Editor's new entries for this catalogue, and the reconciliation behind them
//   firmwares  discover.mjs's entries so far (RemoteFM1FW and the Hub)
//   reserved   ids no new entry may take (policy ids, built-in ids)
//   releases   Editor key -> { version, date, url } from editor-releases.mjs
//   builtIn    firmware built into the players: { id, repositories }
export function editorListings({ firmwares, directory, aliases, reserved = [], builtIn = [], previous = null, releases = {}, today, catalogueDate = null }) {
  const r = reconcile({ firmwares, updated: catalogueDate || today }, directory, aliases, { reserved, builtIn, published: previousIds(previous) });
  const byKey = new Map((directory.entries || []).map((e) => [e.key, e]));
  const prevById = new Map(((previous && previous.firmwares) || []).map((f) => [f.id, f]));
  const firstImport = !((previous && previous.firmwares) || []).some(editorOnly);
  const entries = r.new.map((n) => {
    const e = byKey.get(n.key);
    const entry = listing(e, n.id, directory.source || {});
    const gh = releases[n.key];
    entry.release = gh && gh.date ? { version: gh.version || null, date: gh.date, source: "GitHub release", url: gh.url || null } : null;
    const seen = prevById.get(n.id);
    if (seen && seen.listed && editorOnly(seen)) entry.listed = seen.listed;
    else if (firstImport) { entry.listed = BACKFILL_LISTED; entry.provenance.editor.listedBackfill = true; }
    else entry.listed = today;
    if (seen && editorOnly(seen) && seen.provenance.editor.listedBackfill) entry.provenance.editor.listedBackfill = true;
    return entry;
  });
  // the report shows each new entry's release date too (or that none is known)
  for (const n of r.new) n.released = (releases[n.key] && releases[n.key].date) || null;
  return { entries, report: r };
}

// when tonight has no Editor snapshot at all, keep last night's Editor entries as they were, rather than drop them
export function carriedOver(previous, ids) {
  return ((previous && previous.firmwares) || []).filter((f) => editorOnly(f) && !ids.has(f.id));
}
