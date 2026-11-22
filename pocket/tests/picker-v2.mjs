// FM-1 Pocket Player: checks the picker with catalog-v2.json in Chromium, against a local copy of the site.
// Run by .github/workflows/pocket-check.yml on pull requests.
//
//   node pocket/tests/picker-v2.mjs URL [OUTDIR]
//
// The page opens on h1; the library lists only passing platform results; a library firmware
// downloads (checksum checked) and runs; listing-only and experimental entries stay internal;
// the Hub's credit remains; and nothing logs a page error. Without v2, no platform pass is inferred from v1.
import { chromium } from "playwright";
import { mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const URL_ = process.argv[2] || "http://localhost:8000/";
const OUT = process.argv[3] || "picker-shots";
const DATA = process.argv[4] || "_site/data";
mkdirSync(OUT, { recursive: true });
const v2 = JSON.parse(readFileSync(join(DATA, "catalog-v2.json"), "utf8"));
const v1 = JSON.parse(readFileSync(join(DATA, "catalog.json"), "utf8"));
const playable = v2.firmwares.filter((f) => f.file && f.status.web.state === "playable").length;
// Option B keeps hidden records internal.

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const steps = [];
const step = async (name, fn) => {
  try { const note = await fn(); steps.push({ name, ok: true, note: note || "" }); }
  catch (e) { steps.push({ name, ok: false, note: String(e.message || e).split("\n")[0].slice(0, 200) }); }
};
const openDrawer = async () => {
  if (await page.locator("#drawer").isHidden()) await page.click("#fwbtn");
  await page.waitForSelector("#pk-q", { state: "visible" });
};
const count = () => page.locator("#fwlist .pk-item").count();

await step("opens on h1", async () => {
  await page.goto(URL_, { waitUntil: "load" });
  await page.waitForFunction(() => /h1/.test(document.getElementById("fwname").textContent), null, { timeout: 30000 });
});
await step("the library lists passing platform results, plus h1", async () => {
  await openDrawer();
  await page.click('.pk-filters [data-f="all"]');
  const n = await count();
  if (n !== playable + 1) throw new Error(`${n} rows, expected ${playable + 1}`);
  // v1 includes builds without current platform qualification; it is not the visible count.
  await page.screenshot({ path: join(OUT, "library.png") });
  return `${n} rows`;
});
await step("a library firmware downloads and runs", async () => {
  const target = v1.firmwares.find((f) => f.id === "fimba") || v1.firmwares[0];
  await page.fill("#pk-q", target.name);
  await page.locator("#fwlist .pk-row").first().click();
  await page.locator(".pk-play").first().click();
  await page.waitForFunction((n) => document.getElementById("fwname").textContent.includes(n), target.name, { timeout: 60000 });
  await page.waitForTimeout(1500);
  return target.name;
});
await step('listing-only and experimental-only records stay hidden', async () => {
  await openDrawer();
  await page.fill("#pk-q", "");
  if (await page.locator('.pk-filters [data-f="more"]').isVisible()) throw new Error("hidden records exposed by More");
  const hidden = v2.firmwares.find(f => !(f.file && f.status.web.state === "playable"));
  if (hidden) {
    await page.fill("#pk-q", hidden.name);
    const keys = await page.locator("#fwlist .pk-item").evaluateAll(rows => rows.map(r => r.dataset.key));
    if (keys.includes("cat:"+hidden.id) || keys.includes("more:"+hidden.id)) throw new Error("hidden firmware appeared in search");
  }
});
await step("the Hub's credit shows exactly when the catalogue used the Hub", async () => {
  const info = await page.locator("#pk-info").textContent();
  const credited = /The Firmware Hub/.test(info) && /CC BY 4\.0/.test(info);
  if (!!v2.attribution !== credited) throw new Error(`attribution ${!!v2.attribution}, credit shown ${credited}`);
  return credited ? "shown" : "not needed (no Hub data)";
});
await step("no page errors", async () => { if (errors.length) throw new Error(errors.join(" | ")); });

// the same page without catalog-v2.json: the picker falls back to catalog.json
const fb = await browser.newPage();
await fb.route("**/data/catalog-v2.json", (r) => r.fulfill({ status: 404, body: "" }));
await step("without platform results the built-in remains and unverified library entries stay hidden", async () => {
  await fb.goto(URL_, { waitUntil: "load" });
  await fb.waitForFunction(() => /h1/.test(document.getElementById("fwname").textContent), null, { timeout: 30000 });
  await fb.click("#fwbtn");
  await fb.waitForSelector("#pk-q", { state: "visible" });
  const n = await fb.locator("#fwlist .pk-item").count();
  if (n !== 1) throw new Error(`${n} rows, expected only built-in h1 without platform results`);
  if (await fb.locator('.pk-filters [data-f="more"]').isVisible()) throw new Error('"more" shown without v2');
  return `${n} rows`;
});
await browser.close();

const failures = steps.filter((s) => !s.ok).length;
const lines = ["## Picker with catalog-v2.json (Chromium)", "", ...steps.map((s) => `- ${s.ok ? "✅" : "❌"} ${s.name}${s.note ? `: ${s.note}` : ""}`), ""];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
process.exit(failures ? 1 : 0);
