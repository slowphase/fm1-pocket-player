#!/usr/bin/env node
// FM-1 Pocket Player: boots one .rfm1 headless in Jake Handy's runtime (src/rfm1.js, the same code
// the page runs) and reports what it did. Run in its own process with a timeout (validate.mjs does),
// so a firmware that hangs or crashes cannot take the nightly job with it.
//
//   node pocket/smoke.mjs FILE.rfm1 [SHOT.png]   -> one line of JSON on stdout
//
// Checks, as the brief asks: it boots without trapping, draws its screen, keeps drawing after input,
// and sounds when played (keys, MIDI or PLAY; or while idle: some firmwares play by themselves). Passing this
// does not prove a firmware is safe, or that it behaves as on a real FM-1.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const R = createRequire(import.meta.url)(join(here, "..", "src", "rfm1.js"));

const SILENT = 0.0002;                             // RMS below this counts as silence
const rms = (a) => { let s = 0; for (const v of a) s += v * v; return Math.sqrt(s / a.length); };
const lit = (b) => { let n = 0; for (let i = 0; i < b.length; i += 2) if (b[i] | b[i + 1]) n++; return n; };

// the FM-1's 240 x 240 RGB565 (big-endian) screen as a PNG
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function lcdPng(src, w = 240, h = 240) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, c = src[2 * i] << 8 | src[2 * i + 1], o = y * (w * 3 + 1) + 1 + x * 3;
      const r = c >> 11 & 31, g = c >> 5 & 63, b = c & 31;
      raw[o] = r << 3 | r >> 2; raw[o + 1] = g << 2 | g >> 4; raw[o + 2] = b << 3 | b >> 2;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

export async function smoke(bytes, shotPath) {
  const t0 = Date.now();
  const fw = R.parse(bytes);
  const core = await R.Core.create(fw);
  core.boot(null);
  core.runMs(6000);                                 /* past a splash screen or a slow start */
  const idle = rms(core.pull(4410));
  const shot = core.lcdBytes().slice();             /* the home screen, for the picker's preview */
  const px = lit(shot);
  const writes = core.lcdWrites();
  /* Some firmwares let the first key go by, some play only from MIDI, a groovebox may sound only once
   * PLAY runs it: try each, and keep the loudest. */
  let played = 0, how = "";
  const hear = (h, frames) => { const r = rms(core.pull(frames)); if (r > played) { played = r; how = h; } };
  [7, 11, 14].forEach((k) => core.key(k, 1, 110)); core.runMs(20); hear("chord", 44100); [7, 11, 14].forEach((k) => core.key(k, 0)); core.runMs(300);
  for (const k of [7, 11, 14, 12, 19, 9, 16, 7]) { core.key(k, 1, 115); core.runMs(5); hear("key", 17640); core.key(k, 0); core.runMs(120); }
  for (const n of [48, 60, 72]) { core.midi(0x90, n, 110); hear("midi", 22050); core.midi(0x80, n, 0); core.runMs(100); }
  if (played <= SILENT && idle <= SILENT) {
    core.button(10, 1); core.runMs(80); core.button(10, 0); hear("play", 88200);
    core.button(10, 1); core.runMs(80); core.button(10, 0);
  }
  core.turn(3, 3); core.turn(2, 1);                 /* KNOB 1, PRESETS, then HOME */
  core.button(6, 1); core.runMs(80); core.button(6, 0);
  core.runMs(800);
  const writes2 = core.lcdWrites();
  if (shotPath && px > 0) writeFileSync(shotPath, lcdPng(shot));
  return {
    id: fw.manifest.id, abi: core.abi, halted: core.halted, error: core.error ? String(core.error.message || core.error) : null,
    litPixels: px, lcdWrites: [writes, writes2], idleRms: +idle.toFixed(4), playedRms: +played.toFixed(4), soundFrom: how || null,
    sounds: idle > SILENT || played > SILENT, draws: px > 0, redraws: writes2 > writes,
    speed: +(core.ms / Math.max(1, Date.now() - t0)).toFixed(1),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  smoke(readFileSync(process.argv[2]), process.argv[3]).then(
    (r) => { process.stdout.write(JSON.stringify(r) + "\n"); process.exit(0); },
    (e) => { process.stdout.write(JSON.stringify({ crashed: String(e && e.message || e) }) + "\n"); process.exit(0); });
}
