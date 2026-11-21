// FM-1 Pocket Player: checks the picker with catalog-v2.json in Chromium, against a local copy of the site.
// Run by .github/workflows/pocket-check.yml on pull requests.
//
//   node pocket/tests/picker-v2.mjs URL [OUTDIR]
//
// The page opens on h1; the library still lists exactly catalog.json's playable firmware; a library firmware
// downloads (checksum checked) and runs; the "more" filter lists only what can't be played here, each with its
// reason and a source link and no play button; the Hub's credit shows when the catalogue used the Hub; and nothing
// logs a page error. With ?v1 the site serves no catalog-v2.json and the picker falls back to catalog.json.
import { chromium } from "playwright";
import { mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const URL_ = process.argv[2] || "http://localhost:8000/";
const OUT = process.argv[3] || "picker-shots";
const DATA = process.argv[4] || "_site/data";
mkdirSync(OUT, { recursive: true });
const v2 = JSON.parse(readFileSync(join(DATA, "catalog-v2.json"), "utf8"));
const v1 = JSON.parse(readFileSync(join(DATA, "catalog.json"), "utf8"));
const playable = v2.firmwares.filter((f) => f.file && ["playable", "experimental"].includes(f.status.web.state)).length;
const moreCount = v2.firmwares.length - playable;

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
await step("the library lists catalog.json's playable firmware, plus h1", async () => {
  await openDrawer();
  await page.click('.pk-filters [data-f="all"]');
  const n = await count();
  if (n !== playable + 1) throw new Error(`${n} rows, expected ${playable + 1}`);
  if (playable !== v1.count) throw new Error(`v2 offers ${playable} for play, catalog.json ${v1.count}`);
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
await step(`"more" lists what can't be played here (${moreCount}), each with a reason and a source link`, async () => {
  await openDrawer();
  await page.fill("#pk-q", "");
  const chip = page.locator('.pk-filters [data-f="more"]');
  if (!moreCount) { if (await chip.isVisible()) throw new Error("chip shown with nothing behind it"); return "nothing to show"; }
  await chip.click();
  const n = await count();
  if (n !== moreCount) throw new Error(`${n} rows, expected ${moreCount}`);
  await page.locator("#fwlist .pk-row").first().click();
  const why = await page.locator(".pk-preview .pk-why").first().textContent();
  if (!why || why.length < 10) throw new Error("no reason shown");
  if (await page.locator(".pk-preview .pk-play").count()) throw new Error("a play button on something that can't be played");
  const withSource = v2.firmwares.find((f) => !(f.file && ["playable", "experimental"].includes(f.status.web.state)) && f.source);
  if (withSource) {
    await page.fill("#pk-q", withSource.name);
    // the row may already be open from the click above (a second click would close it)
    if (!(await page.locator("#fwlist .pk-item.open").count())) await page.locator("#fwlist .pk-row").first().click();
    const href = await page.locator('.pk-preview a:text("source")').first().getAttribute("href");
    if (href !== withSource.source) throw new Error(`source link ${href}, expected ${withSource.source}`);
  }
  await page.screenshot({ path: join(OUT, "more.png") });
  return `${n} rows; e.g. "${why.slice(0, 60)}…"`;
});
await step("the Hub's credit shows exactly when the catalogue used the Hub", async () => {
  const info = await page.locator("#pk-info").textContent();
  const credited = /The Firmware Hub/.test(info) && /CC BY 4\.0/.test(info);
  if (!!v2.attribution !== credited) throw new Error(`attribution ${!!v2.attribution}, credit shown ${credited}`);
  return credited ? "shown" : "not needed (no Hub data)";
});
await step("an FM1 Editor listing credits the Editor and never the Hub", async () => {
  const ed = v2.firmwares.find((f) => f.provenance && f.provenance.editor && Object.keys(f.provenance).length === 1);
  const info = await page.locator("#pk-info").textContent();
  const listed = (v2.sources || []).some((s) => s.name === "FM1 Editor");
  if (listed !== /FM1 Editor/.test(info)) throw new Error(`Editor in sources ${listed}, credit shown ${/FM1 Editor/.test(info)}`);
  if (!ed) return "no Editor entries in this catalogue";
  await openDrawer();
  await page.click('.pk-filters [data-f="more"]');
  await page.fill("#pk-q", ed.name);
  if (!(await page.locator("#fwlist .pk-item.open").count())) await page.locator("#fwlist .pk-row").first().click();
  const prev = page.locator(".pk-preview").first();
  const text = await prev.textContent();
  if (!/listed by FM1 Editor/.test(text)) throw new Error("no Editor credit on " + ed.id);
  if (/The Firmware Hub/.test(text)) throw new Error("the Hub's credit on Editor-only " + ed.id);
  const d = ed.attributedDescription;
  if (ed.about) throw new Error("an Editor description in about, where 0.9.0 would show it without credit: " + ed.id);
  if (d && !text.includes(d.text.slice(0, 40))) throw new Error("the Editor's description is not shown for " + ed.id);
  if (d && !(/Description from FM1 Editor/.test(text) && /MIT/.test(text))) throw new Error("no credit and licence with the Editor's description on " + ed.id);
  if (await prev.locator(".pk-play").count()) throw new Error("a play button on a listing-only entry");
  await page.screenshot({ path: join(OUT, "editor-listing.png") });
  return ed.name;
});
await step("no page errors", async () => { if (errors.length) throw new Error(errors.join(" | ")); });

// the same page without catalog-v2.json: the picker falls back to catalog.json
const fb = await browser.newPage();
await fb.route("**/data/catalog-v2.json", (r) => r.fulfill({ status: 404, body: "" }));
await step("without catalog-v2.json it falls back to catalog.json", async () => {
  await fb.goto(URL_, { waitUntil: "load" });
  await fb.waitForFunction(() => /h1/.test(document.getElementById("fwname").textContent), null, { timeout: 30000 });
  await fb.click("#fwbtn");
  await fb.waitForSelector("#pk-q", { state: "visible" });
  const n = await fb.locator("#fwlist .pk-item").count();
  if (n !== v1.count + 1) throw new Error(`${n} rows, expected ${v1.count + 1}`);
  if (await fb.locator('.pk-filters [data-f="more"]').isVisible()) throw new Error('"more" shown without v2');
  return `${n} rows`;
});
// a promoted firmware: catalog-v2.json keeps a permanent Pocket id and lists the build's own id (catalog.json's) as an
// alias. A favourite under the Pocket id must still show on a night with catalog.json alone.
const ctx = await browser.newContext();
const pp = await ctx.newPage();
const target = v1.firmwares[0];
const promoted = { ...v2, firmwares: v2.firmwares.map((f) => (f.id === target.id ? { ...f, id: target.id + "-pocket", aliases: [target.id] } : f)) };
await pp.route("**/data/catalog-v2.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(promoted) }));
await step("a promoted firmware keeps its Pocket id and its favourite, also on catalog.json alone", async () => {
  await pp.addInitScript((id) => { if (!localStorage.getItem("pocket.favs")) localStorage.setItem("pocket.favs", JSON.stringify([id, "more:legacy-listed"])); }, target.id + "-pocket");
  await pp.goto(URL_, { waitUntil: "load" });
  await pp.waitForFunction(() => /h1/.test(document.getElementById("fwname").textContent), null, { timeout: 30000 });
  await pp.click("#fwbtn");
  await pp.waitForSelector("#pk-q", { state: "visible" });
  await pp.click('.pk-filters [data-f="fav"]');
  const withV2 = await pp.locator("#fwlist .pk-item").count();
  const aliases = await pp.evaluate(() => JSON.parse(localStorage.getItem("pocket.aliases") || "{}"));
  if (aliases[target.id] !== target.id + "-pocket") throw new Error("the alias was not remembered");
  await pp.unroute("**/data/catalog-v2.json");
  await pp.route("**/data/catalog-v2.json", (r) => r.fulfill({ status: 404, body: "" }));
  await pp.reload({ waitUntil: "load" });
  await pp.waitForFunction(() => /h1/.test(document.getElementById("fwname").textContent), null, { timeout: 30000 });
  await pp.click("#fwbtn");
  await pp.waitForSelector("#pk-q", { state: "visible" });
  await pp.click('.pk-filters [data-f="fav"]');
  const rows = await pp.locator("#fwlist .pk-item").count();
  const text = await pp.locator("#fwlist").textContent();
  if (withV2 !== 1 || rows !== 1 || !text.includes(target.name)) throw new Error(`favourites: ${withV2} with v2, ${rows} on catalog.json alone`);
  return `${target.name} (${target.id} in catalog.json) stays ${target.id}-pocket`;
});
await browser.close();

const failures = steps.filter((s) => !s.ok).length;
const lines = ["## Picker with catalog-v2.json (Chromium)", "", ...steps.map((s) => `- ${s.ok ? "✅" : "❌"} ${s.name}${s.note ? `: ${s.note}` : ""}`), ""];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
process.exit(failures ? 1 : 0);
