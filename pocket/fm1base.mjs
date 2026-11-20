// Checks .rfm1 files built from fm1base-builds.json (see .github/workflows/pocket-fm1base.yml) with the same checks
// as RemoteFM1FW's builds: the file checks (validate.mjs checkFile), the web boot test, and the Mac app's native
// engine when given. Writes a JSON report and a summary. Never publishes anything.
//
//   node pocket/fm1base.mjs --built DIR --out report.json [--native BIN]
//   DIR/<hub id>/*.rfm1 (or DIR/<hub id>/FAILED.txt when the build failed)
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFile, smokeTest, judgeSmoke } from "./validate.mjs";
import { nativeSmoke } from "./compat.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const recipes = JSON.parse(readFileSync(join(here, "fm1base-builds.json"), "utf8"));
const built = arg("--built"), nativeBin = arg("--native");
const report = { checked: new Date().toISOString(), emsdk: recipes.emsdk, firmwares: [] };

for (const r of recipes.firmwares) {
  const dir = join(built, r.hub);
  const row = { hub: r.hub, name: r.name, repo: r.repo, tag: r.tag, commit: r.commit, license: r.license };
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".rfm1")) : [];
  if (!files.length) {
    row.outcome = "build-failed";
    row.problems = [existsSync(join(dir, "FAILED.txt")) ? readFileSync(join(dir, "FAILED.txt"), "utf8").trim().split("\n").slice(-8).join("\n") : "no .rfm1 produced"];
    report.firmwares.push(row); continue;
  }
  row.source = existsSync(join(dir, "SOURCE.txt")) ? readFileSync(join(dir, "SOURCE.txt"), "utf8").trim() : "built here";
  let name = files[0], file = join(dir, name);
  const bytes = readFileSync(file);
  // Pocket names a file <manifest id>-<version>.rfm1; fm1-base names it after fm1.toml's name, which can differ
  // (VNL-1: "vnl" against the id "vnl_1"). The bytes are not touched, only the file name.
  try {
    const m0 = checkFile(bytes, { file: "x", commit: r.commit }, null).manifest;
    if (m0 && m0.id && m0.version && name !== `${m0.id}-${m0.version}.rfm1`) {
      name = `${m0.id}-${m0.version}.rfm1`; file = join(dir, name); writeFileSync(file, bytes); row.renamedFrom = files[0];
    }
  } catch { /* checkFile below reports it */ }
  const chk = checkFile(bytes, { file: name, commit: r.commit }, null);
  row.file = name; row.sha256 = chk.sha; row.size = bytes.length;
  row.manifest = chk.manifest ? { id: chk.manifest.id, name: chk.manifest.name, version: chk.manifest.version, license: chk.manifest.license, source_url: chk.manifest.source_url, built_by: chk.manifest.built_by, authors: chk.manifest.authors } : null;
  row.fileProblems = chk.problems; row.fileWarnings = chk.warnings;
  const web = await smokeTest(file, join(dir, "screen.png"));
  row.web = { result: web, problems: judgeSmoke(web, null) };
  if (nativeBin) { const nat = await nativeSmoke(nativeBin, file); row.native = { result: nat, problems: judgeSmoke(nat, null) }; }
  const all = [...chk.problems, ...row.web.problems, ...(row.native ? row.native.problems : [])];
  row.outcome = all.length ? "built-with-problems" : "built-and-passed";
  report.firmwares.push(row);
}
writeFileSync(arg("--out"), JSON.stringify(report, null, 1) + "\n");
const n = (o) => report.firmwares.filter((f) => f.outcome === o).length;
const lines = [`## fm1-base builds (not published)`, ``,
  `${report.firmwares.length} recipes: ${n("built-and-passed")} built and passed every check, ${n("built-with-problems")} built with problems, ${n("build-failed")} did not build. Emscripten ${recipes.emsdk.version}.`, ``,
  `| Firmware | Tag | Source | Result | Web | Native (Linux) | Notes |`, `| --- | --- | --- | --- | --- | --- | --- |`];
for (const f of report.firmwares) {
  const sp = (x) => (x && x.result && typeof x.result.speed === "number" ? ` ${x.result.speed}x` : "");
  const ok = (x) => (!x ? "-" : x.problems.length ? `fail${sp(x)}` : `pass${sp(x)}`);
  const notes = [...(f.problems || []), ...(f.fileProblems || []), ...(f.web ? f.web.problems : []), ...(f.native ? f.native.problems.map((p) => "native: " + p) : [])].join("; ").replace(/\n/g, " ").replace(/\|/g, "/");
  lines.push(`| ${f.name} (${f.repo}) | ${f.tag} | ${f.source || "-"} | ${f.outcome} | ${ok(f.web)} | ${ok(f.native)} | ${notes.slice(0, 300)} |`);
}
const text = lines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, text, { flag: "a" });
console.log(text);
