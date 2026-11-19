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
