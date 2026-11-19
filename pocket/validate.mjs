// FM-1 Pocket Player: decides whether an upstream .rfm1 may be published.
//
// Every file is treated as executable content from someone else. It must pass the file checks
// (format, ABI, identity, integrity, licences, credits, source) and then boot in Jake Handy's
// runtime in a separate process with a time limit (smoke.mjs).
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const R = createRequire(import.meta.url)(join(here, "..", "src", "rfm1.js"));

export const SUPPORTED_ABI = [5, 6];           // what src/rfm1.js runs (its ABI_MIN..ABI)
export const MAX_BYTES = 16 * 1024 * 1024;
export const SMOKE_TIMEOUT_MS = 90 * 1000;

// licences we know how to honour; anything else needs a person to look
const OPEN = /^(GPL-[23]\.0(-only|-or-later)?|LGPL-[23]\.[01](-only|-or-later)?|AGPL-3\.0(-only|-or-later)?|MPL-2\.0|MIT|BSD-[23]-Clause|Apache-2\.0|ISC|Zlib|CC0-1\.0|0BSD|OFL-1\.1|Unlicense|FTL)$/;
export function licenceOk(spdx) {
  const parts = String(spdx || "").split(/\s+(?:AND|OR)\s+|[()]/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => OPEN.test(p));
}

// the firmware id a file name promises ("felucca-1.8.2.rfm1" -> "felucca")
export const idFromFile = (f) => (String(f).match(/^([a-z0-9_]+)-/i) || [])[1] || null;

// file checks: no code runs
export function checkFile(bytes, item, expectSha) {
  const problems = [], warnings = [];
  if (bytes.length > MAX_BYTES) problems.push(`larger than ${MAX_BYTES >> 20} MiB`);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (expectSha && sha !== expectSha) problems.push("SHA-256 differs from the release's digest");
  let fw;
  try { fw = R.parse(bytes); } catch (e) { problems.push(`not a valid .rfm1: ${e.message}`); return { problems, warnings, sha }; }
  const m = fw.manifest;
  if (!SUPPORTED_ABI.includes(+m.abi)) problems.push(`unsupported fm1core ABI ${m.abi}`);
  const want = idFromFile(item.file);
  if (want && m.id !== want) problems.push(`manifest id "${m.id}" is not the file's "${want}"`);
  if (!m.name || !m.version) problems.push("no name or version");
  if (!Array.isArray(m.authors) || !m.authors.length) problems.push("no credited authors");
  if (!fw.licenses.length) problems.push("no licence texts inside the file");
  if (!licenceOk(m.license)) problems.push(`licence "${m.license}" needs review`);
  const src = String(m.source_url || "").match(/^(https:\/\/[^@\s]+)@([0-9a-f]{7,40})$/);
  if (!src) problems.push("source_url does not name an exact commit");
  else if (item.commit && !item.commit.startsWith(src[2]) && !src[2].startsWith(item.commit)) warnings.push("source commit differs from RemoteFM1FW's table");
  if (m.built_by && /RemoteFM1FW|RFM1Manager/i.test(m.built_by) && !m.glue_url) warnings.push("built by RemoteFM1FW without a build-glue link");
  return { problems, warnings, sha, manifest: m };
}

// the boot test, in its own process
export function smokeTest(file, shotPath, timeout = SMOKE_TIMEOUT_MS) {
  return new Promise((ok) => {
    execFile(process.execPath, [join(here, "smoke.mjs"), file, shotPath || ""], { timeout, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err && err.killed) return ok({ crashed: `no answer within ${timeout / 1000} s` });
      try { ok(JSON.parse(String(stdout).trim().split("\n").pop())); } catch { ok({ crashed: err ? String(err.message) : "no report" }); }
    });
  });
}

// smoke result -> problems. `exception` is policy.json's documented reason for a silent firmware.
export function judgeSmoke(r, exception) {
  if (r.crashed) return [`did not run: ${r.crashed}`];
  const p = [];
  if (r.halted) p.push(`stopped while booting${r.error ? `: ${r.error}` : ""}`);
  if (!r.draws) p.push("drew nothing on the screen");
  else if (!r.redraws) p.push("screen did not change after keys, knobs and HOME");
  if (!r.sounds && !exception) p.push("made no sound (if it is meant to be silent, add a smoke exception to pocket/policy.json)");
  return p;
}
