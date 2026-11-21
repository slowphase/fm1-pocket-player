// The web player with both engines, in Chromium, on a built site (the published data plus the emulator engine).
// Picks firmwares from the site's own catalog-v2.json and checks, as a listener would use the page:
//  1. a firmware whose preferred engine is the emulator runs its original package, makes sound, saves;
//  2. its preview offers the .rfm1 build too; switching runs it on the .rfm1 engine; the choice survives a reload;
//  3. each engine keeps its own saved state (the .rfm1 save key is untouched by the emulator's);
//  4. a firmware only the emulator can run is in the library and plays;
//  5. an .rfm1-only firmware still plays on the .rfm1 engine; the built-in h1 still runs;
//  6. the credits name fm1-emu and its licence, apart from the firmware's.
// Automated checks: nobody listens.
//   node pocket/emu/web-integration.mjs http://localhost:8000/ OUT.json [SHOTS_DIR]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const [url, out, shots = "web-shots"] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const res = { browser: `Chromium ${browser.version()}`, checks: [] };
const check = (name, ok, detail = "") => { res.checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`); };

await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => window.FM1Sim && window.FM1Sim.library().some((e) => e.catalog), null, { timeout: 60000 });
const pick = await page.evaluate(() => {
  const lib = window.FM1Sim.library().filter((e) => e.catalog && e.meta.emu);
  const both = (e) => e.meta.file && e.meta.emu.package && e.meta.emu.package.file;
  const pref = (e) => e.meta.emu.preferred && e.meta.emu.preferred.web && e.meta.emu.preferred.web.engine;
  const good = (e) => e.meta.emu.web && e.meta.emu.web.state === "playable";
  const fav = ["felucca", "amb", "hortator", "mnm1"];
  const order = (xs) => xs.sort((a, b) => (fav.indexOf(b.meta.id) >= 0) - (fav.indexOf(a.meta.id) >= 0));
  return {
    both: order(lib.filter((e) => both(e) && pref(e) === "fm1-emu" && good(e)))[0]?.meta.id,
    emuOnly: lib.filter((e) => !e.meta.file && pref(e) === "fm1-emu" && good(e))[0]?.meta.id,
    rfm1Only: lib.filter((e) => e.meta.file && pref(e) === "rfm1" && !(e.meta.emu.package && e.meta.emu.package.file))[0]?.meta.id,
    counts: { library: window.FM1Sim.library().filter((e) => e.catalog).length,
      emu: window.FM1Sim.library().filter((e) => e.catalog && e.engine === "fm1-emu").length },
  };
});
res.picked = pick;
console.log("picked", JSON.stringify(pick));

const sound = () => page.evaluate(() => {
  const core = window.FM1Sim.core();
  const rms = (n) => { const a = core.pull(n); let s = 0; for (const v of a) s += v * v; return Math.sqrt(s / a.length); };
  rms(44100 * 6);
  [7, 11, 14].forEach((k) => core.key(k, 1, 110)); const keys = rms(44100); [7, 11, 14].forEach((k) => core.key(k, 0)); rms(8820);
  core.midi(0x90, 60, 110); const midi = rms(22050); core.midi(0x80, 60, 0);
  core.button(10, 1); rms(4410); core.button(10, 0); const play = rms(44100 * 4); core.button(10, 1); rms(4410); core.button(10, 0);
  return { engine: core.engine || "rfm1", id: core.info.id, keys, midi, play, sounds: [keys, midi, play].some((v) => v > 0.0002), halted: core.halted };
});
const openPreview = async (id) => {
  if (await page.locator("#drawer").isHidden()) await page.click("#fwbtn");
  await page.fill("#pk-q", "");
  const name = await page.evaluate((id) => window.FM1Sim.library().find((e) => e.key === "cat:" + id).name, id);
  await page.fill("#pk-q", name);
  const row = page.locator(".pk-item", { has: page.locator("b", { hasText: name }) }).first();
  if ((await row.getAttribute("class")).indexOf("open") < 0) await row.locator(".pk-row").click();
  return row;
};
const playVia = async (id) => {
  const row = await openPreview(id);
  await row.locator(".pk-play").click();
  await page.waitForFunction((id) => window.FM1Sim.current() && window.FM1Sim.current().key === "cat:" + id && window.FM1Sim.core(), id, { timeout: 60000 });
  await page.waitForTimeout(500);
};
const dbKeys = () => page.evaluate(() => new Promise((ok) => {
  const rq = indexedDB.open("fm1-browser-simulator");
  rq.onsuccess = () => { try { const t = rq.result.transaction("flash").objectStore("flash").getAllKeys(); t.onsuccess = () => ok(t.result); } catch (e) { ok([]); } };
  rq.onerror = () => ok([]);
}));

try {
  // 1
  await playVia(pick.both);
  let s = await sound();
  check("preferred engine is the emulator (original package)", s.engine === "fm1-emu", `${pick.both}: ${s.engine}`);
  check("the original package makes sound", s.sounds && !s.halted, JSON.stringify(s));
  // a chord pressed between two renders plays every key (upstream's script call replaces its queue, which used to
  // keep only the last): two fresh, identical machines, one given the chord and one its last key alone; with the
  // bug both play exactly the same samples
  const chord = await page.evaluate(async (url) => {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const run = async (keys) => {
      const c = await window.Fm1Emu.Core.create(window.Fm1Emu.parse(bytes, { id: "chord-test", name: "t" }));
      c.boot(null);
      c.runMs(8000);
      keys.forEach((k) => c.key(k, 1, 110));
      const a = c.pull(22050); let s = 0; for (const v of a) s += v * v; return s;
    };
    return { three: await run([7, 11, 14]), one: await run([14]) };
  }, await page.evaluate(() => window.FM1Sim.current().url));
  check("a chord pressed at once plays every key", chord.three !== chord.one && chord.three > 0, JSON.stringify(chord));
  // a save waits until the firmware has finished writing, and a forced one (leaving the page) still comes back
  const save = await page.evaluate(() => { const c = window.FM1Sim.core(); const img = c.flashImage(true); return img ? img.length % 4100 : -1; });
  check("a save is whole sector records", save === 0, String(save));
  const row = await openPreview(pick.both);
  const line = await row.locator(".pk-engine").textContent();
  check("the preview names the engine and offers the other", /original package/.test(line) && /\.rfm1 build/.test(line), line.trim());
  await page.screenshot({ path: `${shots}/1-preview-emulator.png` });
  // 2
  await row.locator(".pk-engine .pk-link").click();
  await page.waitForFunction(() => window.FM1Sim.core() && window.FM1Sim.core().engine !== "fm1-emu", null, { timeout: 60000 });
  s = await sound();
  check("switching runs the .rfm1 build", s.engine !== "fm1-emu" && s.sounds, JSON.stringify(s));
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction((id) => window.FM1Sim.current() && window.FM1Sim.current().key === "cat:" + id && window.FM1Sim.core(), pick.both, { timeout: 60000 });
  const after = await page.evaluate(() => window.FM1Sim.core().engine || "rfm1");
  check("the choice survives a reload", after === "rfm1", after);
  // 3
  const keys = await dbKeys();
  const emuKey = keys.find((k) => String(k).startsWith("fm1-emu:" + pick.both + ":"));
  const rfm1Key = keys.find((k) => !String(k).startsWith("fm1-emu:") && String(k).indexOf(pick.both) >= 0);
  check("each engine keeps its own saved state", emuKey && rfm1Key && emuKey !== rfm1Key, JSON.stringify(keys));
  const row2 = await openPreview(pick.both);
  await page.screenshot({ path: `${shots}/2-preview-rfm1-chosen.png` });
  await row2.locator(".pk-engine .pk-link").click();      // back to the recommended engine
  await page.waitForFunction(() => window.FM1Sim.core() && window.FM1Sim.core().engine === "fm1-emu", null, { timeout: 60000 });
  check("switching back clears the override", await page.evaluate((id) => !(JSON.parse(localStorage.getItem("pocket.engine") || "{}")[id]), pick.both));
  // 4
  if (pick.emuOnly) {
    await playVia(pick.emuOnly);
    s = await sound();
    check("a firmware only the emulator can run plays", s.engine === "fm1-emu" && s.sounds, `${pick.emuOnly}: ${JSON.stringify(s)}`);
  } else check("a firmware only the emulator can run plays", false, "none in this catalogue");
  // 5
  if (pick.rfm1Only) {
    await playVia(pick.rfm1Only);
    s = await sound();
    check("an .rfm1-only firmware still plays on the .rfm1 engine", s.engine !== "fm1-emu" && !s.halted, `${pick.rfm1Only}: ${JSON.stringify(s)}`);
  }
  await page.evaluate(() => window.FM1Sim.run(window.FM1Sim.library().find((e) => e.builtin)));
  await page.waitForFunction(() => /h1/.test(document.getElementById("fwname").textContent) && window.FM1Sim.core().engine !== "fm1-emu", null, { timeout: 30000 });
  check("the built-in h1 still runs", true);
  // discovery: latest release first by default, A–Z on request, real release dates, "new to library"
  if (await page.locator("#drawer").isHidden()) await page.click("#fwbtn");
  await page.fill("#pk-q", "");
  const rows = async () => page.evaluate(() => {
    const lib = window.FM1Sim.library();
    const h = [...document.querySelectorAll(".pk-h")].find((x) => /Library/.test(x.textContent));
    const names = [];
    for (let el = h && h.nextElementSibling; el && el.classList.contains("pk-item"); el = el.nextElementSibling) names.push(el.dataset.key);
    return names.map((k) => { const e = lib.find((x) => x.key === k); return { name: e ? e.name : k, date: (e && e.meta.release && e.meta.release.date) || "" }; });
  });
  const byRelease = await rows();
  const dated = byRelease.filter((r) => r.date);
  const ordered = dated.every((r, i) => i === 0 || dated[i - 1].date >= r.date) && byRelease.slice(0, dated.length).every((r) => r.date);
  check("latest release first by default (unknown dates last)", byRelease.length > 10 && dated.length > 0 && ordered, `${dated.length} of ${byRelease.length} dated; first ${byRelease.slice(0, 3).map((r) => r.name + " " + r.date.slice(0, 10)).join(", ")}`);
  await page.selectOption("#pk-sort", "az");
  const az = (await rows()).map((r) => r.name);
  check("A–Z on request", az.every((n, i) => i === 0 || az[i - 1].localeCompare(n, undefined, { sensitivity: "base" }) <= 0), az.slice(0, 3).join(", "));
  await page.selectOption("#pk-sort", "release");
  const firstDated = dated[0] && dated[0].name;
  if (firstDated) {
    await page.fill("#pk-q", firstDated);
    const row = page.locator(".pk-item", { has: page.locator("b", { hasText: firstDated }) }).first();
    if ((await row.getAttribute("class")).indexOf("open") < 0) await row.locator(".pk-row").click();
    const facts = await row.locator(".pk-preview").textContent();
    check("the preview shows the real release date", /released .*\d{4}/.test(facts), (facts.match(/released [^·]*/) || [""])[0]);
    await page.fill("#pk-q", "");
  }
  await page.click('.pk-filters [data-f="new"]');
  const fresh = await page.evaluate(() => [...document.querySelectorAll(".pk-item .pk-new")].length);
  const expected = await page.evaluate(() => window.FM1Sim.library().filter((e) => e.catalog && e.meta.listed && (Date.now() - Date.parse(e.meta.listed.slice(0, 10) + "T00:00:00Z")) / 864e5 <= 14).length);
  check("new to library lists what was first listed in the last 14 days", fresh === expected && expected > 0, `${fresh} shown, ${expected} expected`);
  await page.click('.pk-filters [data-f="all"]');
  // every firmware has a picture (its screen, else its name tile), and the emulator screens load
  const pics = await page.evaluate(async () => {
    const items = [...document.querySelectorAll(".pk-item")];
    const without = items.filter((el) => !el.querySelector(".pk-thumb")).length;
    const emuShots = window.FM1Sim.library().filter((e) => e.catalog && e.meta.imageKind === "emulator screen").slice(0, 12);
    const loads = await Promise.all(emuShots.map((e) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.naturalWidth === 240); i.onerror = () => ok(false); i.src = "data/" + e.meta.image; })));
    const lib = window.FM1Sim.library().filter((e) => e.catalog);
    return { rows: items.length, without, screens: lib.filter((e) => e.meta.image).length, tiles: lib.filter((e) => !e.meta.image).length,
             emulatorScreens: window.FM1Sim.library().filter((e) => e.catalog && e.meta.imageKind === "emulator screen").length, loaded: loads.filter(Boolean).length, tried: loads.length };
  });
  check("every firmware has a picture (a screen or its name tile)", pics.rows > 0 && pics.without === 0 && pics.emulatorScreens > 0 && pics.loaded === pics.tried, JSON.stringify(pics));
  // 6
  const credits = await page.locator("#pk-credits").textContent();
  check("the credits name fm1-emu and keep its licence apart", /fm1-emu/.test(credits) && /not the firmware/.test(credits), "");
  await page.screenshot({ path: `${shots}/3-page.png`, fullPage: true });
} catch (e) { check("ran to the end", false, String(e.message || e).slice(0, 300)); }
check("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
res.ok = res.checks.every((c) => c.ok);
await browser.close();
writeFileSync(out, JSON.stringify(res, null, 1) + "\n");
process.exit(res.ok ? 0 : 1);
