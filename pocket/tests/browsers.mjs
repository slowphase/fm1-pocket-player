// FM-1 Pocket Player: checks the live site in Chromium, Firefox and WebKit (Safari's engine), at
// desktop and phone sizes. Run by .github/workflows/pocket-browsers.yml (by hand from the Actions tab).
//
//   node pocket/tests/browsers.mjs [URL] [OUTDIR]
//
// For each browser and size: the page opens on h1, the firmware dropdown opens without moving the
// player, search finds a library firmware, it downloads (checksum checked) and runs, its screen draws,
// a favourite survives a reload, Esc closes the dropdown, and nothing logs a page error.
import { chromium, firefox, webkit, devices } from "playwright";
import { mkdirSync, appendFileSync } from "node:fs";

const URL_ = process.argv[2] || "https://slowphase.github.io/fm1-pocket-player/";
const OUT = process.argv[3] || "browser-shots";
mkdirSync(OUT, { recursive: true });

const SIZES = [
  ["desktop", { viewport: { width: 1280, height: 900 } }],
  ["phone", { ...devices["iPhone 13"] }],
];
const ENGINES = [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]];

async function check(page) {
  const steps = [];
  const step = async (name, fn) => {
    try { const note = await fn(); steps.push({ name, ok: true, note: note || "" }); }
    catch (e) { steps.push({ name, ok: false, note: String(e.message || e).split("\n")[0].slice(0, 160) }); }
  };
  await step("opens on h1", async () => {
    await page.goto(URL_, { waitUntil: "load" });
    await page.waitForFunction(() => /h1/.test(document.getElementById("fwname").textContent), null, { timeout: 30000 });
  });
  await step("dropdown opens over the player", async () => {
    const before = await page.$eval("#device", (e) => Math.round(e.getBoundingClientRect().top));
    await page.click("#fwbtn");
    await page.waitForSelector("#drawer:not([hidden]) .pk-item", { timeout: 15000 });
    const after = await page.$eval("#device", (e) => Math.round(e.getBoundingClientRect().top));
    if (before !== after) throw new Error(`the player moved (${before} -> ${after})`);
    return `${await page.locator(".pk-item").count()} rows`;
  });
  await step("search finds Felucca first", async () => {
    await page.fill("#pk-q", "felucca");
    const first = (await page.locator(".pk-meta b").first().innerText()).trim();
    if (!/^Felucca\b/.test(first)) throw new Error(`first result was "${first}"`);
  });
  await step("library firmware downloads and runs", async () => {
    await page.locator(".pk-row").first().click();
    await page.click(".pk-item.open .pk-play");
    await page.waitForFunction(() => /^Felucca/.test(document.title), null, { timeout: 45000 });
    const err = await page.$eval("#err", (e) => e.textContent);
    if (err) throw new Error(err);
    if (await page.$eval("#halt", (e) => e.classList.contains("on"))) throw new Error("the firmware stopped");
  });
  await step("dropdown closed after playing", async () => {
    if (!(await page.$eval("#drawer", (e) => e.hidden))) throw new Error("still open");
  });
  await step("screen draws", async () => {
    await page.waitForTimeout(1500);
    const lit = await page.$eval("#lcd", (c) => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] | d[i + 1] | d[i + 2]) n++;
      return n;
    });
    if (!lit) throw new Error("the screen is blank");
    return `${lit} lit pixels`;
  });
  await step("favourite survives a reload", async () => {
    await page.click("#fwbtn");
    await page.fill("#pk-q", "amb-1");
    await page.locator(".pk-star").first().click();
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.getElementById("fwname").textContent !== "…", null, { timeout: 30000 });
    await page.click("#fwbtn");
    await page.click("[data-f=fav]");
    const n = await page.locator(".pk-item").count();
    if (n < 1) throw new Error("no favourites after reload");
    return `last firmware remembered: ${await page.title()}`;
  });
  await step("Esc closes the dropdown", async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    if (!(await page.$eval("#drawer", (e) => e.hidden))) throw new Error("still open");
  });
  return steps;
}

const rows = [];
let failures = 0;
for (const [ename, engine] of ENGINES) {
  const browser = await engine.launch();
  for (const [sname, opts] of SIZES) {
    const ctx = await browser.newContext({ ...opts, ...(ename === "firefox" ? { isMobile: undefined, hasTouch: opts.hasTouch } : {}) });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e)));
    const steps = await check(page);
    if (errors.length) steps.push({ name: "no page errors", ok: false, note: errors[0].slice(0, 160) });
    else steps.push({ name: "no page errors", ok: true, note: "" });
    await page.click("#fwbtn").catch(() => {});
    await page.fill("#pk-q", "").catch(() => {});
    await page.screenshot({ path: `${OUT}/${ename}-${sname}.png` }).catch(() => {});
    const bad = steps.filter((s) => !s.ok);
    failures += bad.length;
    rows.push({ ename, sname, steps });
    console.log(`${bad.length ? "FAIL" : "ok  "} ${ename} ${sname}` + (bad.length ? ": " + bad.map((s) => `${s.name} (${s.note})`).join("; ") : ""));
    await ctx.close();
  }
  await browser.close();
}

const names = rows[0].steps.map((s) => s.name);
const md = [
  `## FM-1 Pocket Player in three browsers`, ``, `Site: ${URL_}`, ``,
  `| Check | ${rows.map((r) => `${r.ename} ${r.sname}`).join(" | ")} |`,
  `| --- | ${rows.map(() => "---").join(" | ")} |`,
  ...names.map((n) => `| ${n} | ${rows.map((r) => { const s = r.steps.find((x) => x.name === n); return s ? (s.ok ? "✅" : `❌ ${s.note}`) : "?"; }).join(" | ")} |`),
  ``, failures ? `**${failures} check(s) failed.** Screenshots are attached to this run.` : `**Everything passed.** Screenshots are attached to this run.`, ``,
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
process.exit(failures ? 1 : 0);
