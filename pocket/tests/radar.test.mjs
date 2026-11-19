// node --test pocket/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, repoKey, norm } from "../radar.mjs";

const rows = [
  { file: "felucca-1.8.2.rfm1", name: "Felucca 1.8.2", source: "https://github.com/hugelton/Felucca", restricted: false, fantasy: false },
  { file: "hortator-1.0.1.rfm1", name: "Hortator 1.0.1", source: "https://github.com/deadactive/hortator", restricted: false, fantasy: false },
  { file: "sloop-2.8.5.rfm1", name: "SLOOP 2.8.5", source: "https://github.com/isod89/sloop-fm1", restricted: true, fantasy: false },
  { file: "h1-0.2.1.rfm1", name: "h1 0.2.1", source: "https://github.com/jakehandy/h1", restricted: false, fantasy: false },
  { file: "kris_jangle-0.14.rfm1", name: "Kris Jangle 0.14", source: "https://github.com/someone/elsewhere", restricted: false, fantasy: false },
  { file: "pigeon-0.4.1.rfm1", name: "PIGEON 0.4.1", source: "https://github.com/TheShrimpBlimp/pigeon", restricted: false, fantasy: false },
];
const published = [{ id: "felucca", version: "1.8.2" }, { id: "hortator", version: "1.0.1" }, { id: "kris_jangle", version: "0.14" }];
const policy = { excluded: { h1: "built in" }, withdrawn: {} };
const hub = [
  { id: "felucca", name: "Felucca", author: "Leo", repo: "hugelton/Felucca", lic: "GPL-3.0" },
  { id: "hortator", name: "Hortator", author: "D", repo: "deadactive/hortator", lic: "GPL-3.0" },
  { id: "hortator-bt", name: "Hortator (Bluetooth)", author: "D", repo: "deadactive/hortator", lic: "GPL-3.0" },
  { id: "sloop", name: "SLOOP", author: "isod89", repo: "isod89/sloop-fm1", lic: "GPL-3.0" },
  { id: "h1", name: "h1", author: "Jake Handy", repo: "jakehandy/h1", lic: "MIT" },
  { id: "krisjangle", name: "Kris Jangle", author: "w", repo: "doohinkus/kris-jangle", lic: "MPL-2.0" },
  { id: "pigeon", name: "PIGEON", author: "S", repo: "TheShrimpBlimp/pigeon", lic: "GPL-3.0" },
  { id: "zp12", name: "zp12", author: "zvenson", repo: "zvenson/zp12", lic: "GPL-3.0" },
  { id: "vesper", name: "VESPER", author: "F", repo: "fatcat/vesper-fm1", lic: "" },
  { id: "closed", name: "Closed One", author: "C", repo: "c/closed", lic: "GPL-3.0", linkOnly: true },
  { id: "dx747", name: "DX747", author: "E", repo: "esbenvb/fm1-dx747", lic: "GPL-3.0 + SDK exception" },
];

test("each Hub firmware lands in exactly one sensible group", () => {
  const s = Object.fromEntries(classify(hub, rows, published, policy).map((f) => [f.hub, f.status]));
  assert.equal(s.felucca, "published");
  assert.equal(s.hortator, "published");
  assert.equal(s["hortator-bt"], "no-browser-build");   // same repository, different firmware: not confused with Hortator
  assert.equal(s.sloop, "excluded");                    // restricted (†): never asked about
  assert.equal(s.h1, "excluded");                       // built in
  assert.equal(s.krisjangle, "published");              // matched by name across a different id and repository
  assert.equal(s.pigeon, "not-published");              // has a build, not on the site: other issues cover it
  assert.equal(s.zp12, "no-browser-build");
  assert.equal(s.vesper, "not-open");                   // no licence on the Hub
  assert.equal(s.closed, "not-open");                   // link-only
  assert.equal(s.dx747, "no-browser-build");            // GPL with an SDK exception counts as open
});

test("repository keys and names compare loosely", () => {
  assert.equal(repoKey("https://github.com/Hugelton/Felucca"), "hugelton/felucca");
  assert.equal(repoKey("hugelton/Felucca"), "hugelton/felucca");
  assert.equal(repoKey("https://github.com/a/b.git"), "a/b");
  assert.equal(norm("K-WA SUB"), "kwasub");
});
