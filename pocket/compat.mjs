#!/usr/bin/env node
// FM-1 Pocket Player: per-player compatibility, recorded per build.
//
// Two players run the same .rfm1 files in different engines, so a firmware that works in one is not assumed to work
// in the other. For every published build (by SHA-256) this keeps, separately for each player, which runtime tested
// it, where, when, and what happened:
//
//   web     the page's own runtime (src/rfm1.js) in Node, through pocket/smoke.mjs
//   native  the Mac app's engine (fm1host + wasm3, pinned in pocket/native.json) built for Linux, through its
//           Tests/ctest/native_smoke (the same steps and thresholds as smoke.mjs)
//   macos   the same native engine on macOS (Apple Silicon), for pocket/native.json's representative set only. The
//           Mac app's native results count as verified only for an engine commit whose representative set passed
//           on macOS too.
//
// A build is tested again only when it is new or the runtime changed. The ledger (compat.json) lives in the
// pocket-current release.
//
//   node pocket/compat.mjs --data DIR --ledger FILE [--native BIN] [--macos-results FILE]
//   node pocket/compat.mjs --macos --data DIR --native BIN --out FILE [--ledger FILE]
//        (the macOS job: the representative set, plus every build slow or borderline on Linux per the ledger)
//   node pocket/compat.mjs --macos-list --data DIR [--ledger FILE]   (the files that job needs)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { smokeTest, judgeSmoke } from "./validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const NATIVE = JSON.parse(readFileSync(join(here, "native.json"), "utf8"));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

export const webRuntime = () => ({
  id: "rfm1.js@" + sha256(readFileSync(join(here, "..", "src", "rfm1.js"))).slice(0, 12),
  engine: "src/rfm1.js (the page's own runtime) on WebAssembly",
  environment: `Node ${process.versions.node} on ${process.platform} ${process.arch}`,
});
export const nativeRuntime = (platform = process.platform, arch = process.arch) => ({
  id: `fm1-pocket-mac@${NATIVE.commit.slice(0, 12)}`,
  engine: NATIVE.engine,
  environment: platform === "darwin" ? `macOS ${arch}` : `${platform === "linux" ? "Linux" : platform} ${arch} (the Mac app's C engine, built for this machine)`,
});

export function emptyLedger() { return { schema: 1, builds: {}, macos: {} }; }
export function readLedger(file) {
  if (!file || !existsSync(file)) return emptyLedger();
  try { const l = JSON.parse(readFileSync(file, "utf8")); return l && l.schema === 1 ? { builds: {}, macos: {}, ...l } : emptyLedger(); }
  catch { return emptyLedger(); }
}

// smoke output + documented exceptions -> a recorded outcome
export function outcome(result, exception) {
  const checks = exception ? exception.checks : [];
  const problems = judgeSmoke(result, checks.includes("sound")).filter((x) => !(checks.includes("redraw") && /did not change/.test(x)));
  return {
    outcome: problems.length ? "fail" : (checks.length ? "pass-with-exception" : "pass"),
    problems,
    exception: exception && !problems.length ? exception.reason : null,
    result: result.crashed ? { crashed: result.crashed } : {
      halted: result.halted, draws: result.draws, redraws: result.redraws, sounds: result.sounds,
      soundFrom: result.soundFrom || null, speed: result.speed,
    },
  };
}

export function nativeSmoke(bin, file, timeout = 90_000) {
  return new Promise((ok) => {
    execFile(bin, [file], { timeout, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err && err.killed) return ok({ crashed: `no answer within ${timeout / 1000} s` });
      try { ok(JSON.parse(String(stdout).trim().split("\n").pop())); } catch { ok({ crashed: err ? String(err.message) : "no report" }); }
    });
  });
}

// Tests whatever is new for these entries (catalog.json entries, their files under dataDir) and drops builds
// that are no longer published. Returns { ledger, tested: { web, native } }.
export async function update({ ledger, entries, dataDir, policy, nativeBin, now = new Date(), runWeb = smokeTest, runNative = nativeSmoke }) {
  const web = webRuntime(), native = nativeRuntime();
  const tested = { web: 0, native: 0 };
  const keep = {};
  for (const e of entries) {
    const rec = ledger.builds[e.sha256] || { id: e.id, version: e.version };
    rec.id = e.id;
    rec.version = e.version;
    const file = join(dataDir, e.file);
    const exc = policy.smokeExceptions[e.id];
    if (!rec.web || rec.web.runtime !== web.id) {
      const r = await runWeb(file, null);
      rec.web = { runtime: web.id, environment: web.environment, date: now.toISOString(), ...outcome(r, exc) };
      tested.web++;
    }
    if (nativeBin && (!rec.native || rec.native.runtime !== native.id)) {
      const r = await runNative(nativeBin, file);
      rec.native = { runtime: native.id, environment: native.environment, date: now.toISOString(), ...outcome(r, exc) };
      tested.native++;
    }
    keep[e.sha256] = rec;
  }
  ledger.builds = keep;
  ledger.runtimes = { web, native };
  return { ledger, tested };
}

// The macOS job's results for one engine commit: { runtime, environment, date, results: { id: outcome }, verified }
// Which published builds the macOS job runs: the representative set, plus every build that ran below
// `threshold` times real time in the native engine on Linux (so borderline builds are timed on macOS itself).
export function macosSet(entries, ledger, threshold = 2) {
  const want = new Set(NATIVE.representative);
  for (const e of entries) {
    const b = ledger && ledger.builds && ledger.builds[e.sha256];
    const sp = b && b.native && b.native.result && b.native.result.speed;
    if (typeof sp === "number" && sp < threshold) want.add(e.id);
  }
  return want;
}

export async function macosRun({ entries, dataDir, policy, nativeBin, extra = [], also = [], now = new Date(), runNative = nativeSmoke }) {
  const rt = nativeRuntime("darwin", process.arch);
  const results = {};
  const want = new Set([...NATIVE.representative, ...also]);
  const list = entries.filter((e) => want.has(e.id)).map((e) => ({ id: e.id, sha256: e.sha256, file: join(dataDir, e.file) })).concat(extra);
  for (const e of list) {
    const r = await runNative(nativeBin, e.file);
    results[e.id] = { sha256: e.sha256 || null, ...outcome(r, policy.smokeExceptions[e.id]) };
  }
  const missing = NATIVE.representative.filter((id) => !results[id]);
  const verified = missing.length === 0 && Object.values(results).every((x) => x.outcome !== "fail");
  return { runtime: rt.id, engine: rt.engine, environment: rt.environment, date: now.toISOString(), verified, missing, results };
}

// what the macOS job last said about this engine commit, if anything
export function macosFor(ledger, runtimeId) { return (ledger.macos || {})[runtimeId] || null; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const dataDir = arg("--data");
  const policy = JSON.parse(readFileSync(join(here, "policy.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(join(dataDir, "catalog.json"), "utf8"));
  if (process.argv.includes("--macos-list")) {
    // the files the macOS job needs (fw/... paths), one per line
    const led = arg("--ledger") && existsSync(arg("--ledger")) ? readLedger(arg("--ledger")) : null;
    const want = macosSet(catalog.firmwares, led);
    for (const f of catalog.firmwares) if (want.has(f.id)) console.log(f.file);
    process.exit(0);
  }
  if (process.argv.includes("--macos")) {
    const h1 = join(here, "..", "firmware", "h1.rfm1");
    const extra = existsSync(h1) ? [{ id: "h1", sha256: sha256(readFileSync(h1)), file: h1 }] : [];
    const led = arg("--ledger") && existsSync(arg("--ledger")) ? readLedger(arg("--ledger")) : null;
    const also = [...macosSet(catalog.firmwares, led)];
    const run = await macosRun({ entries: catalog.firmwares, dataDir, policy, nativeBin: arg("--native"), extra, also });
    writeFileSync(arg("--out"), JSON.stringify(run, null, 1) + "\n");
    console.log(`macOS native run (${run.runtime}, ${run.environment}): ${Object.keys(run.results).length} checked individually, representative set ${run.verified ? "passed" : "did not fully pass"}`);
    for (const [id, r] of Object.entries(run.results)) console.log(`  ${id}: ${r.outcome}${r.result && typeof r.result.speed === "number" ? ` (${r.result.speed}x)` : ""}${r.problems.length ? " - " + r.problems.join("; ") : ""}`);
    process.exit(0);
  }
  const ledgerFile = arg("--ledger");
  const ledger = readLedger(ledgerFile);
  const macFile = arg("--macos-results");
  if (macFile && existsSync(macFile)) {
    try { const m = JSON.parse(readFileSync(macFile, "utf8")); if (m.runtime) ledger.macos = { ...(ledger.macos || {}), [m.runtime]: m }; } catch { /* ignore a broken file */ }
  }
  const before = JSON.stringify(ledger);
  const { tested } = await update({ ledger, entries: catalog.firmwares, dataDir, policy, nativeBin: arg("--native") });
  writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1) + "\n");
  const count = (k, o) => Object.values(ledger.builds).filter((b) => b[k] && b[k].outcome === o).length;
  const lines = [`## Compatibility`, ``,
    `Tested now: ${tested.web} in the web runtime, ${tested.native} in the native engine (the rest unchanged since their last test).`,
    `Web (${ledger.runtimes.web.id}): ${count("web", "pass")} pass, ${count("web", "pass-with-exception")} pass with a documented exception, ${count("web", "fail")} fail.`,
    ledger.runtimes.native && arg("--native") ? `Native (${ledger.runtimes.native.id}, ${ledger.runtimes.native.environment}): ${count("native", "pass")} pass, ${count("native", "pass-with-exception")} with an exception, ${count("native", "fail")} fail.` : `Native: not run.`,
    (() => { const m = macosFor(ledger, nativeRuntime().id); return m ? `macOS (${m.environment}, ${m.date}): ${Object.keys(m.results || {}).length} builds run individually; representative set ${m.verified ? "passed, so the rest count as covered by the sample (not run on macOS themselves)" : "did not fully pass: native results stay experimental"}.` : `macOS: no representative run yet for this engine commit, so native results stay experimental.`; })(),
    ``];
  for (const b of Object.values(ledger.builds)) for (const k of ["web", "native"]) if (b[k] && b[k].outcome === "fail") lines.push(`- ${b.id} ${b.version} (${k}): ${b[k].problems.join("; ")}`);
  const text = lines.join("\n") + "\n";
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, text, { flag: "a" });
  console.log(text);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `changed=${before !== JSON.stringify(ledger)}\n`, { flag: "a" });
}
