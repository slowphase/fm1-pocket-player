/* An author's original FM-1 update package (.fwsc) on upstream fm1-emu (Joakim Eriksson, MIT;
 * github.com/joakimeriksson/fm1-emu at the commit in pocket/emu/upstream.json), behind the same interface as
 * src/rfm1.js's Core, so the page (src/app.js) runs either. Upstream's files are used unchanged: emu/fm1_web.wasm
 * (its crates/fm1-web) and emu/jit.js (its web/jit.js), copied into the site by pocket/emu/build-web.sh.
 *
 *   Fm1Emu.isPackage(bytes)                  true for anything that is not an .rfm1 (WebAssembly) file
 *   Fm1Emu.parse(bytes, {id, name, version, license, source_url, authors})   a package carries no manifest
 *   Fm1Emu.Core.create(fw).then(core => ...)  then as Rfm1's: core.boot(flash), core.pull(n), core.key(), ...
 *
 * Saves are upstream's sector records (4-byte little-endian offset + a 4096-byte sector, each that differs from the
 * package's own flash), under the key "fm1-emu:ID:SHA16": never an .rfm1 save, never another version's. */
(function (root) {
  "use strict";
  var R = root.Rfm1;
  var COMMIT = "09aeae3";
  var LABEL_TO_ID = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1];   /* Rfm1.LABELS order -> upstream's matrix ids */
  var ROLE_TO_ENC = [0, 1, 6, 2, 3, 4, 5];                           /* Rfm1.ROLES order -> upstream's encoders */
  var MHZ = 240, FS = 44100, SECTOR = 4096;
  var here = (document.currentScript && document.currentScript.src) || location.href;
  var BASE = here.replace(/src\/emu-core\.js(\?.*)?$/, "") + "emu/";
  var loading = null;

  function isPackage(b) { return !(b && b.length >= 4 && b[0] === 0 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6d); }
  function hex16(b) {
    return (root.crypto && crypto.subtle ? crypto.subtle.digest("SHA-256", b) : Promise.resolve(null)).then(function (d) {
      return d ? Array.from(new Uint8Array(d)).slice(0, 8).map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join("") : "";
    });
  }
  function parse(bytes, meta) {
    if (!isPackage(bytes) || bytes.length < SECTOR) throw new Error("That file is not an FM-1 update package (.fwsc).");
    meta = meta || {};
    return {
      bytes: bytes, emu: true, licenses: [], skin: null, skinImage: null,
      credits: "Runs on fm1-emu by Joakim Eriksson (MIT): https://github.com/joakimeriksson/fm1-emu",
      manifest: { id: meta.id || "package", name: meta.name || "FM-1 package", version: meta.version || "", license: meta.license || "",
        source_url: meta.source_url || "", authors: meta.authors || [] }
    };
  }
  function load() {
    if (!loading) {
      loading = Promise.all([
        fetch(BASE + "fm1_web.wasm").then(function (r) { if (!r.ok) throw new Error("The emulator engine is not on this site (emu/fm1_web.wasm)."); return r.arrayBuffer(); })
          .then(function (b) { return WebAssembly.compile(b); }),
        import(BASE + "jit.js")
      ]);
      loading.catch(function () { loading = null; });
    }
    return loading;
  }

  function Core(x, fw, id) {
    this.x = x; this.fw = fw; this.halted = 0; this.error = null; this.abi = 0; this.sim1 = 0; this.sim = 0;
    this.buttonNames = R.LABELS.slice();
    this.info = { id: id, name: fw.manifest.name, version: fw.manifest.version, source_url: fw.manifest.source_url,
      family: "fm1-emu " + COMMIT, credits: fw.credits };
    this.engine = "fm1-emu";
    this.playing = false; this.pot = 512; this.lcd = new Uint8Array(240 * 240 * 2); this.onhalt = null; this.onlog = null;
  }
  Core.create = function (fw) {
    return Promise.all([load(), hex16(fw.bytes)]).then(function (r) {
      var mod = r[0][0], jit = r[0][1], x = null, stats = { regions: 0, failed: 0, compileMs: 0, compileMaxMs: 0, bytes: 0 };
      return WebAssembly.instantiate(mod, { env: jit.jitImports(function () { return x; }, stats) }).then(function (inst) {
        x = inst.exports;
        return new Core(x, fw, "fm1-emu:" + fw.manifest.id + ":" + r[1]);
      });
    });
  };
  Core.prototype._copy = function (bytes) {
    var p = this.x.fm1_alloc(bytes.length);
    new Uint8Array(this.x.memory.buffer, p, bytes.length).set(bytes);
    return p;
  };
  Core.prototype.boot = function (flash) {
    var x = this.x;
    x.fm1_jit(1, 16);
    if (x.fm1_ahead) x.fm1_ahead(1024);
    if (x.fm1_boot_fwsc(this._copy(this.fw.bytes), this.fw.bytes.length, 0, 0, MHZ) !== 0) {
      this._halt(0x1ff, new Error("the package did not unpack"));
      return;
    }
    if (flash && flash.length && flash.length % (SECTOR + 4) === 0) x.fm1_flash_restore(this._copy(flash), flash.length);
    x.fm1_pot(this.pot);
  };
  Core.prototype._halt = function (code, err) {
    if (this.halted) return;
    this.halted = code; this.error = err;
    if (this.onhalt) this.onhalt(code, err);
  };
  Core.prototype._render = function (n) {
    /* upstream's worklet budgets: 20 ms of emulated time while it boots, 1.5 quanta once audio plays */
    var budget = this.playing ? MHZ * 1e6 * 1.5 * n / FS : MHZ * 1e6 * 0.02, have;
    try { have = this.x.fm1_render(n, budget); } catch (e) { this._halt(0x1ff, e); return 0; }
    if (have > 0) this.playing = true;
    if (this.x.fm1_halted()) this._halt(0x1ff, new Error("the emulated FM-1 stopped (a CPU exception)"));
    return have;
  };
  Core.prototype.runMs = function (ms) {
    var left = Math.round(ms * FS / 1000), n;
    while (left > 0 && !this.halted) { n = Math.min(1024, left); this._render(n); left -= n; }
  };
  Core.prototype.pull = function (n, into) {
    var out = into && into.length === n * 2 ? into : new Float32Array(n * 2), done = 0, k, i, l, r, buf;
    while (done < n) {
      k = Math.min(1024, n - done);
      if (this.halted) { out.fill(0, 2 * done); break; }
      this._render(k);
      buf = this.x.memory.buffer;
      l = new Float32Array(buf, this.x.fm1_out_l(), k); r = new Float32Array(buf, this.x.fm1_out_r(), k);
      for (i = 0; i < k; i++) { out[2 * (done + i)] = l[i]; out[2 * (done + i) + 1] = r[i]; }
      done += k;
    }
    return out;
  };
  Core.prototype.drop = function () {};
  Core.prototype.key = function (k, down, vel) {
    if (k < 0 || k >= 27) return;
    if (down) {   /* the velocity goes through upstream's own input script (Action::KeyVel) */
      var s = new TextEncoder().encode(this.x.fm1_ms() + ":n" + k + "@" + Math.max(1, Math.min(127, vel || 100)));
      this.x.fm1_bench_script(this._copy(s), s.length);
    } else this.x.fm1_key(14 + k, 0);
  };
  Core.prototype.button = function (b, down) { if (LABEL_TO_ID[b] !== undefined) this.x.fm1_key(LABEL_TO_ID[b], down ? 1 : 0); };
  Core.prototype.turn = function (role, d) { if (ROLE_TO_ENC[role] !== undefined && d) this.x.fm1_enc(ROLE_TO_ENC[role], d | 0); };
  Core.prototype.master = function (v) {
    if (v === undefined) return this.pot;
    this.pot = Math.max(0, Math.min(1023, v | 0));
    this.x.fm1_pot(this.pot);
  };
  Core.prototype.midi = function (s, d1, d2) {
    this.x.fm1_midi(s); this.x.fm1_midi(d1);
    if (!(s >= 0xc0 && s < 0xe0)) this.x.fm1_midi(d2);
    return true;
  };
  /* the screen as src/rfm1.js gives it: 240 x 240 RGB565, high byte first (upstream's is little-endian words) */
  Core.prototype.lcdBytes = function () {
    var src = new Uint8Array(this.x.memory.buffer, this.x.fm1_lcd(), 240 * 240 * 2), d = this.lcd, i;
    for (i = 0; i < d.length; i += 2) { d[i] = src[i + 1]; d[i + 1] = src[i]; }
    return d;
  };
  Core.prototype.lcdWrites = function () { return this.x.fm1_lcd_revision() >>> 0; };
  Core.prototype.leds = function () {
    var l = new Float32Array(this.x.memory.buffer, this.x.fm1_leds(), 41), v = function (i) { return Math.round(Math.max(0, Math.min(1, l[i])) * 255); };
    return { buttons: LABEL_TO_ID.map(v), keys: Array.from({ length: 27 }, function (_, k) { return v(14 + k); }), playGreen: 0 };
  };
  Core.prototype.accent = function () { return -1; };
  Core.prototype.stats = function () { return null; };
  Core.prototype.linkBytes = function () { return -1; };
  Core.prototype.labels = function () { return null; };
  Core.prototype.ctl = function () { return null; };
  Core.prototype.ctlSet = function () {};
  Core.prototype.flashDirty = function () { return this.x.fm1_flash_revision() >>> 0; };
  Core.prototype.flashImage = function () {
    var x = this.x, len = x.fm1_flash_len(), now = new Uint8Array(x.memory.buffer, x.fm1_flash(), len),
      base = new Uint8Array(x.memory.buffer, x.fm1_flash_base(), len), out = [], at, i, rec;
    for (at = 0; at < len; at += SECTOR) {
      for (i = at; i < at + SECTOR; i++) if (now[i] !== base[i]) break;
      if (i === at + SECTOR) continue;
      rec = new Uint8Array(SECTOR + 4);
      new DataView(rec.buffer).setUint32(0, at, true);
      rec.set(now.subarray(at, at + SECTOR), 4);
      out.push(rec);
    }
    var all = new Uint8Array(out.length * (SECTOR + 4));
    out.forEach(function (r, k) { all.set(r, k * (SECTOR + 4)); });
    return all;
  };
  Core.prototype.shutdown = function () {};

  root.Fm1Emu = { isPackage: isPackage, parse: parse, Core: Core, COMMIT: COMMIT };
})(window);
