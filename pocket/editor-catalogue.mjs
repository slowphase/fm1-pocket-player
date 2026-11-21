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
// Descriptions: Pocket is a discovery tool, so each listing carries the Editor's own description (MIT licensed), in
// attributedDescription: { text, credit, url, license, licenseUrl, copyright, source }. It is never put in `about`,
// which apps up to FM-1 Pocket 0.9.0 show without any credit: a client shows the text only if it also shows the credit,
// so no release order can put the Editor's words on screen unattributed. The text is normalised for safe, readable display without changing
// its meaning: Unicode NFC, any leftover markup or entities decoded or removed, control, zero-width and direction
// characters removed, whitespace collapsed, and an over-long text (over MAX_ABOUT) shortened at a word with an ellipsis.
//
// Credit: each entry says it was listed by FM1 Editor (provenance.editor and credit), and never carries the Hub's
// provenance, so no app shows The Firmware Hub's credit on it.
//
// Listed dates: the first import is backfilled to the day the Editor's directory began (BACKFILL_LISTED), so 160
// entries don't all appear as New to Library at once; after that, an entry keeps the day it was first listed, and an
// entry the Editor adds later is listed on the day Pocket first sees it.
import { reconcile, previousIds, editorOnly } from "./reconcile.mjs";
import { SITE } from "./editor.mjs";

export const DESCRIPTIONS = true;
export const MAX_ABOUT = 1200;
export const BACKFILL_LISTED = "2026-10-07";
export const CREDIT = { text: "Listed by FM1 Editor", url: SITE };
export const REASON = "Listed from FM1 Editor's directory. FM-1 Pocket hasn't reviewed it, so it isn't offered here: get it from its maker.";
export const UTILITY_TAG = "Tool or utility";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function normaliseDescription(text, max = MAX_ABOUT) {
  if (text == null) return "";
  let t = String(text).normalize("NFC");
  t = t.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");                       // leftover markup: scripts and styles go,
  t = t.replace(/<\/?(br|p|div|li|ul|ol|h[1-6]|tr|td|blockquote)\b[^>]*>/gi, " ");       // block tags become a space,
  t = t.replace(/<[^>]*>/g, "");                                                        // inline tags go
  t = t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, c) => {
    if (c[0] === "#") { const n = c[1].toLowerCase() === "x" ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " "; }
    return ENTITIES[c.toLowerCase()] ?? m;
  });
  t = t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");          // control characters
  t = t.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, "");  // zero-width and direction marks
  t = t.replace(/[\s\u00a0\u2028\u2029]+/g, " ").trim();
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "").replace(/[\s,;:.\-]+$/, "") + "…";
  return t;
}
// a description taken from the Editor, with its credit and licence (null when there is no text)
export function attributedDescription(text, key, directory) {
  const t = normaliseDescription(text);
  if (!t) return null;
  const src = (directory && directory.source) || {};
  const lic = src.license || {};
  return { text: t, credit: "Description from FM1 Editor", source: "FM1 Editor", url: key ? `${SITE}#${encodeURIComponent(key)}` : SITE,
           license: "MIT", licenseUrl: `https://github.com/benny-sparra/fm1-dx7-patch-importer/blob/${src.commit || "main"}/LICENSE`,
           copyright: lic.copyright || "Copyright (c) 2026 Ben Sparrow" };
}

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
export function listing(e, id, source, directory = null) {
  const reason = REASON;
  const entry = {
    id, name: e.name, version: e.version || "", authors: e.maker ? [e.maker] : [],
    category: editorCategory(e.kinds),
    tag: (e.kinds || []).includes("tools") ? UTILITY_TAG : "",
    about: "",
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
  const desc = DESCRIPTIONS ? attributedDescription(e.description, e.key, directory || { source }) : null;
  if (desc) entry.attributedDescription = desc;
  return entry;
}

// the Editor's new entries for this catalogue, and the reconciliation behind them
//   firmwares  discover.mjs's entries so far (RemoteFM1FW and the Hub)
//   reserved   ids no new entry may take (policy ids, built-in ids)
//   releases   Editor key -> { version, date, url } from editor-releases.mjs
//   builtIn    firmware built into the players: { id, repositories }
//   known      permanent Editor-first ids (identity.mjs): Editor key -> Pocket id, and ids no new entry may take
export function editorListings({ firmwares, directory, aliases, reserved = [], builtIn = [], previous = null, releases = {}, today, catalogueDate = null, known = null }) {
  const published = { ...previousIds(previous) };
  for (const [id, rec] of known || []) if (rec.editor && !published[rec.editor]) published[rec.editor] = id;
  const r = reconcile({ firmwares, updated: catalogueDate || today }, directory, aliases,
                      { reserved: [...reserved, ...((known && known.keys()) || [])], builtIn, published });
  // an Editor-first record is never retired because something else matched it: if its own id isn't in the catalogue
  // tonight (it wasn't joined to a new source), it stays listed under that id
  const present = new Set(firmwares.map((f) => f.id));
  for (const m of [...r.matched, ...r.ambiguous]) {
    const id = published[m.key];
    if (!id || present.has(id)) continue;
    const e = (directory.entries || []).find((x) => x.key === m.key);
    r.new.push({ id, key: m.key, name: e.name, maker: e.maker, repository: e.repository || null, kinds: e.kinds || [], channel: e.channel || null,
                 version: e.version || null, updated: e.updated || null, frozen: true, keptListed: true });
  }
  r.counts.new = r.new.length;
  const byKey = new Map((directory.entries || []).map((e) => [e.key, e]));
  const prevById = new Map(((previous && previous.firmwares) || []).map((f) => [f.id, f]));
  const firstImport = !((previous && previous.firmwares) || []).some(editorOnly);
  const entries = r.new.map((n) => {
    const e = byKey.get(n.key);
    const entry = listing(e, n.id, directory.source || {}, directory);
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
