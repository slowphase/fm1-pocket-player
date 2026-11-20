// Evaluation: the page (index.html + src/app.js) running an original .fwsc package on upstream fm1-emu through
// src/emu-core.js, in Chromium. Opens each package as a user would (the file picker), then checks the screen, sound
// from keys / MIDI / PLAY (by pulling from the running core), a save surviving a reload, and that an .rfm1 still runs
// on the existing engine afterwards. Boot checks: nobody listens.
//   node pocket/emu/web-prototype.mjs http://localhost:8000/ PKGS_DIR OUT.json id id ...
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const [url, pkgs, out, ...ids] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const res = { browser: `Chromium ${browser.version()}`, firmwares: [] };
for (const id of ids) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const row = { id };
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => /h1/.test(document.getElementById("fwname").textContent), null, { timeout: 30000 });
    await page.setInputFiles("#file", join(pkgs, `${id}.fwsc`));
    await page.waitForFunction(() => window.FM1Sim.core && window.FM1Sim.core() && window.FM1Sim.core().engine === "fm1-emu", null, { timeout: 60000 });
    const r = await page.evaluate(async () => {
      const core = window.FM1Sim.core();
      const rms = (n) => { const a = core.pull(n); let s = 0; for (const v of a) s += v * v; return Math.sqrt(s / a.length); };
      const t0 = performance.now(); rms(44100 * 3); const boot = (performance.now() - t0) / 1000;
      const lcd = core.lcdBytes(); let lit = 0; for (let i = 0; i < lcd.length; i += 2) if (lcd[i] | lcd[i + 1]) lit++;
      [7, 11, 14].forEach((k) => core.key(k, 1, 110)); const keys = rms(44100); [7, 11, 14].forEach((k) => core.key(k, 0));
      rms(13230);
      core.midi(0x90, 60, 110); const midi = rms(22050); core.midi(0x80, 60, 0);
      core.button(10, 1); rms(4410); core.button(10, 0); const play = rms(44100 * 4); core.button(10, 1); rms(4410); core.button(10, 0);
      const t1 = performance.now(); rms(44100 * 10); const speed = 10 / ((performance.now() - t1) / 1000);
      return { lit, keys, midi, play, speed, bootSeconds: boot, sub: document.getElementById("sub").textContent,
        about: document.getElementById("aboutmap").textContent, halted: core.halted, id: core.info.id };
    });
    Object.assign(row, r);
    // a save survives a reload: one sector in upstream's record format, through the page's own storage
    row.saveRoundTrip = await page.evaluate(async () => {
      const core = window.FM1Sim.core();
      const fw = core.fw, c2 = await window.Fm1Emu.Core.create(fw);
      const rec = new Uint8Array(4100); new DataView(rec.buffer).setUint32(0, 0xff000, true); rec.fill(0x5a, 4);
      c2.boot(rec); c2.runMs(50);
      const img = c2.flashImage();
      return img.length === rec.length && img.every((v, i) => v === rec[i]);
    });
    row.sounds = [row.keys, row.midi, row.play].some((v) => v > 0.0002);
    row.ok = row.lit > 0 && row.sounds && !row.halted && row.saveRoundTrip && !errors.length;
  } catch (e) { row.ok = false; row.error = String(e.message || e).slice(0, 300); }
  row.pageErrors = errors.slice(0, 3);
  res.firmwares.push(row);
  console.log(`${id.padEnd(14)} ok=${row.ok} speed=${(row.speed || 0).toFixed(2)}x keys=${(row.keys || 0).toFixed(4)} midi=${(row.midi || 0).toFixed(4)} play=${(row.play || 0).toFixed(4)} save=${row.saveRoundTrip} ${row.error || ""}`);
  await page.close();
}
// the existing engine still runs an .rfm1 (h1, built in) after packages were opened
const page = await browser.newPage();
await page.goto(url, { waitUntil: "load" });
res.rfm1StillRuns = await page.waitForFunction(() => window.FM1Sim.core && window.FM1Sim.core() && window.FM1Sim.core().engine !== "fm1-emu" &&
  /h1/.test(document.getElementById("fwname").textContent), null, { timeout: 30000 }).then(() => true, () => false);
console.log(`an .rfm1 still runs on the existing engine: ${res.rfm1StillRuns}`);
await browser.close();
writeFileSync(out, JSON.stringify(res, null, 1) + "\n");
