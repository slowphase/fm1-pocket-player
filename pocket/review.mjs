#!/usr/bin/env node
// FM-1 Pocket Player: the GitHub issues that let a person stay in charge without touching code.
//
//   node pocket/review.mjs approvals   before the sync: issues labelled `pocket-review` + `approved`
//                                      add their firmware to pocket/policy.json (the workflow then
//                                      commits it) and are closed
//   node pocket/review.mjs report      after the sync: one `pocket-review` issue per firmware waiting
//                                      for review, one `pocket-failure` issue per firmware whose update
//                                      was rejected; issues whose firmware is fine again are closed
//
// Each issue carries a hidden marker with the firmware id, so a rerun never opens a duplicate.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const SITE = `https://${(REPO || "/").split("/")[0]}.github.io/${(REPO || "/").split("/")[1]}/`;
const LABELS = {
  "pocket-review": ["0e8a16", "A firmware waiting for a person to approve it"],
  approved: ["2dd4bf", "Approve this firmware for publishing"],
  "pocket-failure": ["d93f0b", "A firmware update failed the checks"],
};

async function api(method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method, headers: { accept: "application/vnd.github+json", authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 410) throw Object.assign(new Error("Issues are switched off in this repository"), { issuesOff: true });
  if (!r.ok && r.status !== 422) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
async function issues(label, state = "open") {
  const out = [];
  for (let page = 1; page < 20; page++) {
    const xs = await api("GET", `/issues?labels=${label}&state=${state}&per_page=100&page=${page}`);
    out.push(...xs.filter((i) => !i.pull_request));
    if (xs.length < 100) break;
  }
  return out;
}
const marker = (kind, id, extra = "") => `<!-- pocket:${kind} id=${id}${extra} -->`;
const idOf = (kind, body) => (String(body || "").match(new RegExp(`<!-- pocket:${kind} id=([A-Za-z0-9_]+)`)) || [])[1];
const licOf = (body) => (String(body || "").match(/ license=([^\s]+) -->/) || [])[1];
async function ensureLabels() {
  for (const [name, [color, description]] of Object.entries(LABELS)) await api("POST", "/labels", { name, color, description });
}

async function approvals() {
  const policyFile = join(here, "policy.json"), policy = JSON.parse(readFileSync(policyFile, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;
  for (const i of await issues("approved", "open")) {
    const id = idOf("review", i.body), license = licOf(i.body);
    if (!id || !license || !i.labels.some((l) => l.name === "pocket-review")) continue;
    policy.approved[id] = { license: decodeURIComponent(license), reviewed: today, issue: i.number };
    changed = true;
    await api("POST", `/issues/${i.number}/comments`, { body: `Approved. **${id}** is now on the allowlist and will be published by this run if it passes the checks.` });
    await api("PATCH", `/issues/${i.number}`, { state: "closed", state_reason: "completed" });
  }
  if (changed) {
    policy.approved = Object.fromEntries(Object.entries(policy.approved).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(policyFile, JSON.stringify(policy, null, 2) + "\n");
  }
  console.log(changed ? "policy.json updated from approvals" : "no new approvals");
}

function reviewBody(p) {
  const card = p.card || {};
  return [
    marker("review", p.id, ` license=${encodeURIComponent(p.license)}`),
    `**${p.name}** ${p.version || ""} by ${(p.authors || []).join(", ")} is available as a browser build and is waiting for your OK before it goes on the site.`,
    ``,
    p.previousLicense ? `> **Why it's here:** its licence changed from \`${p.previousLicense}\` to \`${p.license}\`. The last approved version stays up until you decide.\n` : `> **Why it's here:** it's new to the library.\n`,
    card.what ? `**What it is:** ${card.what}\n` : "",
    `| | |`, `| --- | --- |`,
    `| Licence | \`${p.license}\` |`,
    `| Source | ${p.source ? `${p.source}${p.commit ? `/tree/${p.commit}` : ""}` : "not given"} |`,
    `| Checks | ${p.problems.length ? "⚠️ " + p.problems.join("; ") : "✅ file checks and boot test passed"} |`,
    p.warnings.length ? `| Notes | ${p.warnings.join("; ")} |` : "",
    ``,
    `**To publish it:** add the **approved** label to this issue (on the right, under *Labels*). The next nightly run, or a manual run from the *Actions* tab, adds it to the site.`,
    `**To leave it out:** close this issue. It won't be asked about again unless its licence changes.`,
    ``,
    `<sub>Opened by the nightly sync. Checks passing doesn't prove a firmware is safe or that it behaves as on a real FM-1.</sub>`,
  ].filter((l) => l !== "").join("\n");
}

function failureBody(f) {
  return [
    marker("failure", f.id),
    `The newest browser build of **${f.id}** ${f.version || ""} failed the checks, so ${f.kept ? "the last good version stays on the site" : "it isn't on the site yet"}.`,
    ``,
    `**What went wrong:**`, ...f.why.map((w) => `- ${w}`),
    ``,
    `Nothing to do unless this keeps happening: the nightly run tries again, and this issue closes itself when a build passes. If a firmware is meant to be silent or to keep a still screen, a *smoke exception* in \`pocket/policy.json\` lets it through.`,
    ``, `Site: ${SITE}`,
  ].join("\n");
}

async function report() {
  const r = JSON.parse(readFileSync("pocket-report.json", "utf8"));
  await ensureLabels();
  // review requests: one per firmware, never twice (a closed one means "no", until its licence changes)
  const allReview = await issues("pocket-review", "all");
  for (const p of r.pending) {
    const same = allReview.filter((i) => idOf("review", i.body) === p.id);
    const open = same.find((i) => i.state === "open");
    const declined = same.some((i) => i.state === "closed" && licOf(i.body) === encodeURIComponent(p.license) && !i.labels.some((l) => l.name === "approved"));
    if (declined) continue;
    const body = reviewBody(p);
    if (open) { if (open.body !== body) await api("PATCH", `/issues/${open.number}`, { body }); }
    else await api("POST", "/issues", { title: `Review: ${p.name}${p.version ? " " + p.version : ""} (${p.id})`, body, labels: ["pocket-review"] });
  }
  // failures: open or update one per firmware; close the rest
  const failing = new Map(r.rejected.map((f) => [f.id, f]));
  const openFail = await issues("pocket-failure", "open");
  for (const [id, f] of failing) {
    const cur = openFail.find((i) => idOf("failure", i.body) === id), body = failureBody(f);
    if (cur) { if (cur.body !== body) await api("PATCH", `/issues/${cur.number}`, { body }); }
    else await api("POST", "/issues", { title: `Update failed checks: ${id}${f.version ? " " + f.version : ""}`, body, labels: ["pocket-failure"] });
  }
  for (const i of openFail) {
    const id = idOf("failure", i.body);
    if (id && !failing.has(id)) {
      await api("POST", `/issues/${i.number}/comments`, { body: `The latest build of **${id}** passed the checks. Closing.` });
      await api("PATCH", `/issues/${i.number}`, { state: "closed", state_reason: "completed" });
    }
  }
  console.log(`review requests: ${r.pending.length}, failures: ${failing.size}`);
}

if (!REPO || !TOKEN) { console.error("needs GITHUB_REPOSITORY and GITHUB_TOKEN"); process.exit(2); }
const cmd = process.argv[2];
(cmd === "approvals" ? approvals() : cmd === "report" ? (existsSync("pocket-report.json") ? report() : Promise.resolve()) : Promise.reject(new Error("approvals | report")))
  .catch((e) => {
    if (e.issuesOff) {                                  /* a note, not a failure: the site is unaffected */
      const note = "**Issues are switched off in this repository**, so review requests and failure reports could not be opened. Turn them on: Settings > General > Features > Issues.\n";
      if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, note, { flag: "a" });
      console.warn("::warning::" + note.replace(/\*\*/g, "").trim());
      process.exit(0);
    }
    console.error(e); process.exit(1);
  });
