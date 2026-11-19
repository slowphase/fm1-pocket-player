// node --test pocket/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseCategory, displayName, splitSource } from "../catalog.mjs";

test("categories outside RemoteFM1FW's set become Other, never an error", () => {
  assert.equal(normaliseCategory("Synth"), "Synth");
  assert.equal(normaliseCategory("synths"), "Synth");
  assert.equal(normaliseCategory("Groovebox"), "Groovebox");
  assert.equal(normaliseCategory("Something new"), "Other");
  assert.equal(normaliseCategory(undefined), "Other");
});

test("a name that ends with its version shows them apart", () => {
  assert.equal(displayName("AMB-1 1.3.2", "1.3.2"), "AMB-1");
  assert.equal(displayName("Felucca", "1.8.2"), "Felucca");
  assert.equal(displayName("FIZZ 0.12.0-beta.19", "0.12.0-beta.19"), "FIZZ");
});

test("a source URL with a commit splits into repository and commit", () => {
  assert.deepEqual(splitSource("https://github.com/hugelton/Felucca@6162de864075ad9edb8cd35e0e45ba75faa5d0db"),
    { repo: "https://github.com/hugelton/Felucca", commit: "6162de864075ad9edb8cd35e0e45ba75faa5d0db" });
  assert.deepEqual(splitSource("https://github.com/a/b"), { repo: "https://github.com/a/b", commit: null });
  assert.deepEqual(splitSource("not a url"), { repo: null, commit: null });
});

import { licenceOk, idFromFile, judgeSmoke } from "../validate.mjs";
import { parseTable } from "../upstream.mjs";

test("licences we can honour pass; unknown ones need a person", () => {
  assert.ok(licenceOk("GPL-3.0-only"));
  assert.ok(licenceOk("MPL-2.0 AND GPL-3.0-only AND MIT AND FTL AND OFL-1.1"));
  assert.ok(licenceOk("GPL-2.0-or-later"));
  assert.ok(!licenceOk("LicenseRef-proprietary"));
  assert.ok(!licenceOk(""));
});

test("the firmware id comes from the file name", () => {
  assert.equal(idFromFile("felucca-1.8.2.rfm1"), "felucca");
  assert.equal(idFromFile("kris_jangle-0.14.rfm1"), "kris_jangle");
  assert.equal(idFromFile("noversion.rfm1"), null);
});

test("the boot test's verdict honours documented exceptions only", () => {
  const ok = { halted: 0, draws: true, redraws: true, sounds: true };
  assert.deepEqual(judgeSmoke(ok), []);
  assert.equal(judgeSmoke({ ...ok, sounds: false }).length, 1);
  assert.deepEqual(judgeSmoke({ ...ok, sounds: false }, true), []);
  assert.equal(judgeSmoke({ crashed: "timeout" }, true).length, 1);
  assert.equal(judgeSmoke({ ...ok, halted: 1 }, true).length, 1);
});

test("RemoteFM1FW's table: restricted and fantasy marks, source commits", () => {
  const md = [
    "<!-- rfm1-table:start -->",
    "| `amb-1.3.2.rfm1` | AMB-1 1.3.2 | Charles Vestal | MPL-2.0 | [c/fm1-amb](https://github.com/c/fm1-amb/tree/7c538516d6c52216ff4c8a4881cf2f0dcb07c44b) |",
    "| `sloop-2.8.5.rfm1` | SLOOP 2.8.5 † | x | GPL-3.0-only | [x/s](https://github.com/x/s/tree/abcdef1) |",
    "| `ripple-0.6.1.rfm1` | Ripple 0.6.1 ‡ | y | GPL-3.0-only | [y/r](https://github.com/y/r/tree/1234567) |",
    "<!-- rfm1-table:end -->",
  ].join("\n");
  const rows = parseTable(md);
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].restricted, rows[1].restricted, rows[2].fantasy], [false, true, true]);
  assert.equal(rows[0].commit, "7c538516d6c52216ff4c8a4881cf2f0dcb07c44b");
  assert.equal(rows[1].name, "SLOOP 2.8.5");
});
