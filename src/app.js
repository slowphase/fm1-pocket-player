/* The page: an FM-1 panel around whatever .rfm1 firmware is loaded (src/rfm1.js runs it). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var R = window.Rfm1;
  var core = null, cur = null;                 /* the running firmware and its library entry */
  var actx = null, node = null, soundOn = false, muted = false, ratio = 1, rpos = 0, rbuf = null, rprev = [0, 0];
  var canvas = $("lcd"), ctx2d = canvas.getContext("2d"), image = ctx2d.createImageData(240, 240);
  var prevLcd = new Uint8Array(240 * 240 * 2);
  var DEFAULT_INK = "#c8ff4a";
  var mode = pref("fm1sim.mode", "slider");

  function pref(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function setPref(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* fine */ } }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function lic(s) { return String(s || "").replace(/LicenseRef-/g, "").replace(/-/g, " ").replace(/(\d) (\d)/g, "$1.$2").replace(/ only$/, "").replace(/^(GPL|LGPL|MPL|AGPL) /, "$1-"); }
  function hex(n) { return "#" + ("000000" + (n >>> 0).toString(16)).slice(-6); }
  function b64bytes(s) { var b = atob(s), u = new Uint8Array(b.length), i; for (i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

  /* ---- the browser's storage: loaded firmwares and each one's flash ---- */
  var db = null;
  function openDb() {
    return new Promise(function (ok) {
      try {
        var rq = indexedDB.open("fm1-browser-simulator", 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore("fw"); rq.result.createObjectStore("flash"); };
        rq.onsuccess = function () { db = rq.result; ok(db); };
        rq.onerror = function () { ok(null); };
      } catch (e) { ok(null); }
    });
  }
  function dbDo(store, fn) {
    return new Promise(function (ok) {
      if (!db) return ok(null);
      try {
        var tx = db.transaction(store, "readwrite"), rq = fn(tx.objectStore(store));
        tx.oncomplete = function () { ok(rq ? rq.result : null); };
        tx.onerror = tx.onabort = function () { ok(null); };
      } catch (e) { ok(null); }
    });
  }
  var dbGet = function (s, k) { return dbDo(s, function (o) { return o.get(k); }); };
  var dbPut = function (s, k, v) { return dbDo(s, function (o) { return o.put(v, k); }); };
  var dbDel = function (s, k) { return dbDo(s, function (o) { return o.delete(k); }); };
  var dbAll = function (s) { return dbDo(s, function (o) { return o.getAll(); }); };

  /* ---- audio: the firmware makes 44.1 kHz; the page resamples if the device runs another rate ---- */
  function makeAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      try { actx = new AC({ sampleRate: R.FS, latencyHint: "interactive" }); } catch (e) { actx = new AC(); }
      ratio = R.FS / actx.sampleRate;
      node = actx.createScriptProcessor(1024, 0, 2);
      node.onaudioprocess = function (ev) {
        var L = ev.outputBuffer.getChannelData(0), Rr = ev.outputBuffer.getChannelData(1), n = L.length, i, need, a, f, j;
        if (!core || core.halted || muted) { L.fill(0); Rr.fill(0); if (core && !core.halted) core.pull(Math.round(n * ratio)); return; }
        if (ratio === 1) {
          rbuf = core.pull(n, rbuf && rbuf.length === n * 2 ? rbuf : null);
          for (i = 0; i < n; i++) { L[i] = rbuf[2 * i]; Rr[i] = rbuf[2 * i + 1]; }
          return;
        }
        need = Math.floor(rpos + n * ratio) + 1;
        a = core.pull(need);
        for (i = 0; i < n; i++) {
          j = Math.floor(rpos); f = rpos - j;
          var l0 = j === 0 ? rprev[0] : a[2 * (j - 1)], r0 = j === 0 ? rprev[1] : a[2 * (j - 1) + 1];
          L[i] = l0 + (a[2 * j] - l0) * f;
          Rr[i] = r0 + (a[2 * j + 1] - r0) * f;
          rpos += ratio;
        }
        rprev = [a[2 * (need - 1)], a[2 * (need - 1) + 1]];
        rpos -= need;
      };
      node.connect(actx.destination);
      soundOn = actx.state === "running";
    } catch (e) { actx = null; }
  }
  function startAudio() {
    if (!actx) return;
    if (actx.state !== "running") actx.resume().then(function () { soundOn = true; label(); }, function () {});
    else if (!soundOn) { soundOn = true; label(); }
  }
  function audioLive() { return actx && actx.state === "running"; }
  function label() {
    $("sound").innerHTML = "sound: <b>" + (!actx ? "not available" : (!soundOn ? "tap anything" : (muted ? "muted" : "on"))) + "</b>";
  }

  /* ---- buttons ---- */
  var btnEls = [];
  function press(b, down) {
    var el = btnEls[b];
    if (el) el.classList.toggle("down", !!down);
    if (core) core.button(b, down);
  }
  function bindButton(el, b) {
    btnEls[b] = el;
    /* Shift-click latches a button down until the next click, so the mouse is free to turn an encoder
     * while the firmware sees the button held (EDIT + SELECT and the like). */
    el.addEventListener("pointerdown", function (e) {
      e.preventDefault(); startAudio();
      if (el.classList.contains("latched")) { el.classList.remove("latched"); press(b, 0); return; }
      if (e.shiftKey) { el.classList.add("latched"); press(b, 1); return; }
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      press(b, 1);
    });
    var up = function () { if (el.classList.contains("down") && !el.classList.contains("latched")) press(b, 0); };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("keydown", function (e) { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); press(b, 1); } });
    el.addEventListener("keyup", function (e) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); press(b, 0); } });
  }
  function buildButtons() {
    var host = $("buttons"), i, el;
    for (i = 0; i < 12; i++) {
      el = document.createElement("button");
      el.type = "button";
      el.className = "btn";
      el.innerHTML = "<i></i><span>" + R.LABELS[i] + "</span>";
      host.appendChild(el);
      bindButton(el, i);
    }
    Array.prototype.forEach.call(document.querySelectorAll(".oct .btn"), function (b) { bindButton(b, +b.dataset.btn); });
  }
  /* the firmware's own names for the buttons, and its live labels over them when it gives some */
  var lblSeen = null;
  function nameButtons(live) {
    var names = core ? core.buttonNames : R.LABELS;
    btnEls.forEach(function (el, i) {
      var l = live ? live[8 + i] : null, n = l || names[i] || R.LABELS[i];
      el.querySelector("span").textContent = n.replace(/^OCT-$/, "OCT −").replace(/^OCT\+$/, "OCT +");
      el.style.opacity = l === "" ? "0.55" : "";
      el.title = n === R.LABELS[i] ? "" : "printed " + R.LABELS[i];
      el.setAttribute("aria-label", n);
    });
  }
  function liveLabels() {
    var l = core.labels();
    if (l === lblSeen) return;
    lblSeen = l;
    nameButtons(l);
    ctls.forEach(function (c) { c.key = ""; });
  }

  /* ---- the encoders and MASTER, as sliders or knobs ----
   * Role 0..6 are SELECT, ALGORITHM, PRESETS, KNOB 1..4; 7 is MASTER. With the sim1 extension a role can
   * report a value and range, and the slider or knob sets it outright; without it every control is a
   * relative encoder and moves send detents. */
  var HW = R.ROLES.concat(["MASTER"]);
  var ctls = [];
  function turn(role, d) { if (core && d) { startAudio(); core.turn(role, d); } }
  function info(c) {
    if (c.role === 7) return { absolute: true, value: core ? core.master() : 820, lo: 0, hi: 1023, name: "VOLUME", text: Math.round((core ? core.master() : 820) / 10.23) + "%" };
    var v = core && core.ctl(c.role), l = core && core._lbl && core._lblEpoch ? core._lbl[c.role] : null;
    if (v && v.absolute) return v;
    if (v) return { absolute: false, name: v.name, text: v.text };
    return l ? { absolute: false, name: l, text: "" } : null;
  }
  function setAbs(c, v) {
    if (!core) return;
    startAudio();
    if (c.role === 7) core.master(v); else core.ctlSet(c.role, v);
  }
  function nudges(c, html) {
    return (c.role < 7 ? '<button class="nudge" type="button" data-d="-1" aria-label="' + HW[c.role] + ', one click down">‹</button>' : "") + html +
      (c.role < 7 ? '<button class="nudge" type="button" data-d="1" aria-label="' + HW[c.role] + ', one click up">›</button>' : "");
  }
  function bindNudges(c) {
    Array.prototype.forEach.call(c.el.querySelectorAll(".nudge"), function (b) {
      var d = +b.dataset.d, timer = 0;
      var stop = function () { clearTimeout(timer); clearInterval(timer); timer = 0; };
      b.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        turn(c.role, d);
        stop();
        timer = setTimeout(function () { timer = setInterval(function () { turn(c.role, d); }, 100); }, 380);
      });
      b.addEventListener("pointerup", stop);
      b.addEventListener("pointerleave", stop);
      b.addEventListener("pointercancel", stop);
      b.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); turn(c.role, d); } });
    });
  }
  function buildCtl(c) {
    var el = c.el, hw = HW[c.role];
    c.key = "";
    el.className = "ctl" + (mode === "knob" ? " knob" : "");
    var head = '<span class="nm"><small>' + hw + '</small><b></b></span><span class="val"></span>';
    if (mode === "knob") {
      el.innerHTML = head + '<div class="row">' + nudges(c,
        '<div class="dial" tabindex="0" role="slider" aria-label="' + hw + '"><svg viewBox="-32 -32 64 64">' +
        '<path class="track" d=""/><path class="arc" d=""/><circle class="body" r="21"/><line class="mark" x1="0" y1="-8" x2="0" y2="-18"/></svg></div>') + "</div>";
      c.dial = el.querySelector(".dial");
      c.arc = el.querySelector(".arc");
      c.track = el.querySelector(".track");
      c.mark = el.querySelector(".mark");
      c.angle = c.angle || 0;
      bindDial(c);
    } else {
      el.innerHTML = head + '<div class="row">' + nudges(c, '<input type="range" min="0" max="100" step="1" value="50" aria-label="' + hw + '">') + "</div>";
      c.range = el.querySelector("input");
      bindSlider(c);
    }
    c.name = el.querySelector(".nm b");
    c.val = el.querySelector(".val");
    if (c.role < 7) {
      bindNudges(c);
      el.addEventListener("wheel", function (e) { e.preventDefault(); turn(c.role, e.deltaY < 0 ? 1 : -1); }, { passive: false });
    }
    c.abs = null;
    sync(c, true);
  }
  function arcPath(a0, a1, r) {
    var p = function (a) { return (Math.sin(a) * r).toFixed(2) + " " + (-Math.cos(a) * r).toFixed(2); };
    if (a1 - a0 < 0.001) return "M " + p(a0) + " L " + p(a0);
    return "M " + p(a0) + " A " + r + " " + r + " 0 " + (a1 - a0 > Math.PI ? 1 : 0) + " 1 " + p(a1);
  }
  var SWEEP = Math.PI * 0.75;
  function drawDial(c, v) {
    var a;
    if (v && v.absolute) {
      var t = v.hi > v.lo ? (v.value - v.lo) / (v.hi - v.lo) : 0;
      a = -SWEEP + t * 2 * SWEEP;
      c.track.setAttribute("d", arcPath(-SWEEP, SWEEP, 27));
      c.arc.setAttribute("d", arcPath(-SWEEP, a, 27));
      c.dial.setAttribute("aria-valuemin", v.lo);
      c.dial.setAttribute("aria-valuemax", v.hi);
      c.dial.setAttribute("aria-valuenow", v.value);
    } else {
      a = c.angle;
      c.track.setAttribute("d", "");
      c.arc.setAttribute("d", "");
    }
    c.dial.setAttribute("aria-valuetext", v ? (v.name ? v.name + " " : "") + (v.text || "") : "endless encoder");
    c.mark.setAttribute("transform", "rotate(" + (a * 180 / Math.PI).toFixed(1) + ")");
  }
  function bindDial(c) {
    var d = c.dial, y0 = 0, acc = 0, start = 0, live = false;
    d.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      startAudio();
      try { d.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      live = true; y0 = e.clientY; acc = 0;
      var v = info(c);
      start = v && v.absolute ? v.value : 0;
    });
    d.addEventListener("pointermove", function (e) {
      if (!live) return;
      var dy = y0 - e.clientY, v = info(c), steps;
      if (v && v.absolute) {
        var span = v.hi - v.lo, nv = Math.round(start + dy * span / 180);
        nv = Math.max(v.lo, Math.min(v.hi, nv));
        if (nv !== v.value) setAbs(c, nv);
      } else {
        steps = Math.trunc((dy - acc) / 8);
        if (steps) { acc += steps * 8; turn(c.role, steps); c.angle += steps * Math.PI / 12; drawDial(c, v); }
      }
    });
    var up = function () { live = false; };
    d.addEventListener("pointerup", up);
    d.addEventListener("pointercancel", up);
    d.addEventListener("keydown", function (e) {
      var k = e.key, s = k === "ArrowUp" || k === "ArrowRight" ? 1 : k === "ArrowDown" || k === "ArrowLeft" ? -1 : 0;
      if (!s) return;
      e.preventDefault();
      e.stopPropagation();
      if (c.role === 7) setAbs(c, core.master() + s * 32);
      else { turn(c.role, s); c.angle += s * Math.PI / 12; }
    });
  }
  function paintRange(c, v) {
    var r = c.range, lo = +r.min, hi = +r.max, t = hi > lo ? (+r.value - lo) / (hi - lo) * 100 : 0;
    if (v && v.absolute) { r.style.setProperty("--q", "0%"); r.style.setProperty("--p", t + "%"); }
    else { r.style.setProperty("--q", Math.min(50, t) + "%"); r.style.setProperty("--p", Math.max(50, t) + "%"); }
  }
  function bindSlider(c) {
    var r = c.range, last = 0;
    r.addEventListener("pointerdown", function () { startAudio(); last = +r.value; });
    r.addEventListener("input", function () {
      var v = info(c);
      startAudio();
      if (v && v.absolute) setAbs(c, +r.value);
      else { turn(c.role, +r.value - last); last = +r.value; }
      paintRange(c, v);
    });
    var back = function () {                 /* a relative slider springs back to the middle */
      var v = info(c);
      if (v && v.absolute) return;
      r.value = 0; last = 0;
      paintRange(c, v);
    };
    r.addEventListener("change", back);
    r.addEventListener("pointerup", back);
    r.addEventListener("keydown", function (e) {
      var v = info(c), k = e.key, s = k === "ArrowUp" || k === "ArrowRight" ? 1 : k === "ArrowDown" || k === "ArrowLeft" ? -1 : 0;
      if (v && v.absolute) return;
      if (!s) return;
      e.preventDefault();
      turn(c.role, s);
    });
  }
  function sync(c, force) {
    var v = core ? info(c) : null, key = v ? [v.absolute, v.value, v.lo, v.hi, v.name, v.text].join("|") : "-";
    if (key === c.key && !force) return;
    c.key = key;
    var hw = HW[c.role];
    c.name.textContent = v && v.name && v.name !== hw ? v.name : "";
    c.val.textContent = v ? (v.text || "") : "";
    c.el.classList.toggle("jog", !(v && v.absolute));
    if (c.range) {
      if (v && v.absolute) {
        if (+c.range.min !== v.lo) c.range.min = v.lo;
        if (+c.range.max !== v.hi) c.range.max = v.hi;
        if (+c.range.value !== v.value) c.range.value = v.value;
        c.range.setAttribute("aria-valuetext", (v.name ? v.name + " " : "") + v.text);
      } else if (+c.range.min !== -12 || force) {
        c.range.min = -12; c.range.max = 12; c.range.value = 0;
        c.range.setAttribute("aria-valuetext", "endless encoder: drag to turn");
      }
      paintRange(c, v);
    }
    if (c.dial) drawDial(c, v);
  }
  function setMode(m) {
    mode = m;
    setPref("fm1sim.mode", m);
    $("m-slider").setAttribute("aria-pressed", m === "slider");
    $("m-knob").setAttribute("aria-pressed", m === "knob");
    $("device").classList.toggle("mode-knob", m === "knob");
    ctls.forEach(buildCtl);
  }

  /* ---- keys: velocity from where the key is hit ---- */
  var NOTE = ["F", "F#", "G", "G#", "A", "A#", "B", "C", "C#", "D", "D#", "E"];
  var keyEls = [], held = {}, count = [];
  function keyDown(k, vel) { count[k] = (count[k] || 0) + 1; if (count[k] === 1) { if (core) core.key(k, 1, vel); keyEls[k].classList.add("on"); } }
  function keyUp(k) { if (!count[k]) return; count[k]--; if (!count[k]) { if (core) core.key(k, 0); keyEls[k].classList.remove("on"); } }
  function buildKeys() {
    var host = $("keys"), whites = 16, wi = 0, k, el, black;
    for (k = 0; k < 27; k++) {
      black = NOTE[k % 12].length > 1;
      el = document.createElement("div");
      el.dataset.key = k;
      if (black) {
        el.className = "bk";
        el.style.width = (100 / whites * 0.62) + "%";
        el.style.left = (100 / whites * (wi - 0.31)) + "%";
      } else { el.className = "wk"; wi++; }
      el.innerHTML = "<u></u>";
      keyEls[k] = el;
      host.appendChild(el);
    }
    var at = function (e) {
      var t = document.elementFromPoint(e.clientX, e.clientY);
      return t && t.dataset && t.dataset.key !== undefined && host.contains(t) ? +t.dataset.key : -1;
    };
    var vel = function (e, k) {
      var r = keyEls[k].getBoundingClientRect(), t = r.height ? (e.clientY - r.top) / r.height : 0.7;
      return Math.round(30 + Math.max(0, Math.min(1, t)) * 97);
    };
    host.addEventListener("pointerdown", function (e) {
      var k = at(e);
      e.preventDefault();
      startAudio();
      if (k < 0) return;
      try { host.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      held[e.pointerId] = k;
      keyDown(k, vel(e, k));
    });
    host.addEventListener("pointermove", function (e) {
      if (held[e.pointerId] === undefined) return;
      var k = at(e);
      if (k >= 0 && k !== held[e.pointerId]) { keyUp(held[e.pointerId]); held[e.pointerId] = k; keyDown(k, vel(e, k)); }
    });
    var up = function (e) { if (held[e.pointerId] !== undefined) { keyUp(held[e.pointerId]); delete held[e.pointerId]; } };
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", up);
    host.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }
  var KEYMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyR: 5, KeyF: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, BracketLeft: 17, Quote: 18 };
  function tap(b) { press(b, 1); setTimeout(function () { press(b, 0); }, 60); }
  function bindComputerKeys() {
    var labels = { 0: "A", 1: "W", 2: "S", 3: "E", 4: "D", 5: "R", 6: "F", 7: "G", 8: "Y", 9: "H", 10: "U", 11: "J", 12: "K", 13: "O", 14: "L", 15: "P", 16: ";", 17: "[", 18: "'" };
    Object.keys(labels).forEach(function (k) { var em = document.createElement("em"); em.textContent = labels[k]; keyEls[k].appendChild(em); });
    window.addEventListener("keydown", function (e) {
      var t = e.target;
      if (!core || e.metaKey || e.ctrlKey || e.altKey) return;
      var onCtl = t && ((t.tagName === "INPUT" && t.type === "range") || (t.classList && t.classList.contains("dial")));
      if (t && !onCtl && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (onCtl && /^Arrow|^Home$|^End$|^Page/.test(e.code)) return;
      startAudio();
      if (KEYMAP[e.code] !== undefined) {
        e.preventDefault();
        if (!e.repeat && held["k" + e.code] === undefined) { held["k" + e.code] = KEYMAP[e.code]; keyDown(KEYMAP[e.code], 100); }
        return;
      }
      if (e.repeat && e.code !== "ArrowUp" && e.code !== "ArrowDown" && e.code !== "Period" && e.code !== "Comma" && !/^Digit[1-4]$/.test(e.code)) return;
      switch (e.code) {
        case "KeyZ": tap(12); break;
        case "KeyX": tap(13); break;
        case "ArrowRight": turn(2, 1); break;
        case "ArrowLeft": turn(2, -1); break;
        case "ArrowUp": turn(1, 1); break;
        case "ArrowDown": turn(1, -1); break;
        case "Period": turn(0, 1); break;
        case "Comma": turn(0, -1); break;
        case "Digit1": case "Digit2": case "Digit3": case "Digit4": turn(2 + +e.code.slice(5), e.shiftKey ? -1 : 1); break;
        default: return;
      }
      e.preventDefault();
    });
    window.addEventListener("keyup", function (e) {
      var id = "k" + e.code;
      if (held[id] !== undefined) { keyUp(held[id]); delete held[id]; }
    });
    window.addEventListener("blur", function () { Object.keys(held).forEach(function (id) { keyUp(held[id]); delete held[id]; }); });
  }

  /* ---- MIDI in ---- */
  var midiAccess = null;
  function midiOn(on) {
    if (!on) { if (midiAccess) midiAccess.inputs.forEach(function (i) { i.onmidimessage = null; }); return; }
    if (!navigator.requestMIDIAccess) { $("midi").checked = false; $("midi").parentNode.title = "This browser has no Web MIDI."; return; }
    navigator.requestMIDIAccess().then(function (m) {
      midiAccess = m;
      var hook = function () {
        m.inputs.forEach(function (i) {
          i.onmidimessage = function (ev) {
            var d = ev.data;
            if (!core || !d.length || d[0] < 0x80 || d[0] >= 0xf0) return;
            startAudio();
            core.midi(d[0], d[1] || 0, d[2] || 0);
          };
        });
      };
      hook();
      m.onstatechange = hook;
    }, function () { $("midi").checked = false; });
  }

  /* ---- the frame loop: the device clock when there is no sound, the picture and lights always ---- */
  var lastT = 0, linkMs = 0, meterT = 0, saveT = 0, flashSeen = -1, shownWrites = -1, accentT = 0, ledKey = "";
  function drawLcd() {
    var src = core.lcdBytes(), d = image.data, i, j, c, hi, lo, r, g, b, rows = 0, row;
    for (j = 0; j < 240; j++) {
      row = false;
      for (i = j * 480; i < j * 480 + 480; i++) if (src[i] !== prevLcd[i]) { row = true; break; }
      if (!row) continue;
      rows++;
      for (i = j * 240; i < j * 240 + 240; i++) {
        hi = src[2 * i]; lo = src[2 * i + 1];
        c = hi << 8 | lo;
        r = c >> 11 & 31; g = c >> 5 & 63; b = c & 31;
        d[4 * i] = r << 3 | r >> 2; d[4 * i + 1] = g << 2 | g >> 4; d[4 * i + 2] = b << 3 | b >> 2; d[4 * i + 3] = 255;
      }
    }
    prevLcd.set(src);
    ctx2d.putImageData(image, 0, 0);
    return rows * 480;
  }
  function drawLeds() {
    var l = core.leds(), key = l.buttons.join(",") + "/" + l.keys.join(",") + "/" + l.playGreen, i;
    if (key === ledKey) return;
    ledKey = key;
    for (i = 0; i < 14; i++) if (btnEls[i]) btnEls[i].style.setProperty("--l", (l.buttons[i] / 255).toFixed(2));
    if (btnEls[10]) btnEls[10].style.setProperty("--led", l.playGreen > l.buttons[10] ? "#4dff7a" : "");
    if (l.playGreen > l.buttons[10] && btnEls[10]) btnEls[10].style.setProperty("--l", (l.playGreen / 255).toFixed(2));
    for (i = 0; i < 27; i++) keyEls[i].querySelector("u").style.setProperty("--l", (l.keys[i] / 255).toFixed(2));
  }
  function setInk(c) { document.documentElement.style.setProperty("--ink", c); }
  function frame(t) {
    requestAnimationFrame(frame);
    var dt = Math.min(100, t - lastT), bytes, lb, ms;
    lastT = t;
    if (!core || core.halted) return;
    if (!audioLive()) {                        /* no sound yet: run the clock from the page's time */
      core.runMs(Math.max(0, Math.round(dt)));
      core.drop();
    }
    if (core.lcdWrites() !== shownWrites) {
      shownWrites = core.lcdWrites();
      bytes = drawLcd();
      lb = core.linkBytes();
      ms = (lb >= 0 ? lb : bytes) * 8 / 44000;
      linkMs += (ms - linkMs) * 0.08;
    }
    drawLeds();
    liveLabels();
    ctls.forEach(function (c) { sync(c, false); });
    if (t - accentT > 120) {
      accentT = t;
      var a = core.accent();
      setInk(a >= 0 ? hex(a) : skinInk());
    }
    if (t - meterT > 500) {
      meterT = t;
      var est = Math.min(60, 1000 / Math.max(16.67, linkMs)), st = core.stats();
      $("ms").textContent = linkMs.toFixed(1) + " ms";
      $("fps").textContent = "≈ " + Math.round(est) + " fps on the device" + (st && st.cpu ? " · firmware says " + st.cpu + "% CPU" : "");
      $("bar").style.width = Math.min(100, linkMs / 16.67 * 100) + "%";
      $("bar").className = linkMs > 16.67 ? "over" : "";
    }
    if (t - saveT > 1000) { saveT = t; saveFlash(false); }
  }
  function saveFlash(sync) {
    if (!core || !cur || core.halted) return;
    var d = core.flashDirty();
    if (d === flashSeen && !sync) return;
    var img = core.flashImage(sync);
    flashSeen = core.flashDirty();
    if (img) dbPut("flash", core.info.id || cur.key, img);
  }

  /* ---- loading a firmware ---- */
  var library = [];                           /* { key, name, version, builtin, bytes|url, added } */
  function skinInk() {
    var s = cur && cur.fw && cur.fw.skin, th = s && s.theme;
    return th && /^#[0-9a-f]{6}$/i.test(th.led || "") ? th.led : DEFAULT_INK;
  }
  function showError(msg) { $("err").textContent = msg || ""; if (msg) openDrawer(true); }
  function bytesOf(entry) {
    if (entry.bytes) return Promise.resolve(entry.bytes);
    if (entry.b64) return Promise.resolve(b64bytes(entry.b64));
    return fetch(entry.url).then(function (r) {
      if (!r.ok) throw new Error("Could not fetch " + entry.url + " (" + r.status + ").");
      return r.arrayBuffer();
    }).then(function (b) {
      var u = new Uint8Array(b);
      if (!entry.sha256) return u;              /* pocket: a catalogue file runs only if its bytes are the ones approved */
      return R.sha256(u).then(function (h) {
        if (h && h !== entry.sha256) throw new Error(entry.name + ": the downloaded file does not match the catalogue. Try again later.");
        return u;
      });
    });
  }
  function run(entry) {
    showError("");
    return bytesOf(entry).then(function (bytes) {
      /* evaluation: an original .fwsc package runs on upstream fm1-emu (src/emu-core.js), an .rfm1 on src/rfm1.js */
      var E = window.Fm1Emu && window.Fm1Emu.isPackage(bytes) ? window.Fm1Emu : R;
      var fw = E === R ? R.parse(bytes) : E.parse(bytes, entry.meta || { id: entry.key, name: entry.name, version: entry.version, license: entry.license });
      return E.Core.create(fw).then(function (c) { return { fw: fw, c: c }; });
    }).then(function (r) {
      if (core) { saveFlash(true); core.shutdown(); }
      return dbGet("flash", r.c.info.id || entry.key).then(function (flash) {
        r.c.onhalt = halted;
        r.c.onlog = logLine;
        r.c.boot(flash ? new Uint8Array(flash) : null);
        core = r.c;
        cur = entry;
        cur.fw = r.fw;
        flashSeen = core.flashDirty();
        shownWrites = -1;
        prevLcd.fill(1);
        ledKey = "";
        Object.keys(count).forEach(function (k) { count[k] = 0; keyEls[k].classList.remove("on"); });
        $("halt").classList.remove("on");
        $("log").textContent = "";
        setPref("fm1sim.last", entry.key);
        describe(r.fw);
        lblSeen = undefined;
        nameButtons();
        ctls.forEach(function (c) { sync(c, true); });
        renderList();
        if (r.c.halted) halted(r.c.halted, r.c.error);
      });
    }).catch(function (e) { showError(e.message || String(e)); });
  }
  function halted(code, err) {
    $("haltmsg").textContent = err ? "The firmware crashed: " + (err.message || err) : "The firmware stopped (it asked to reboot, code " + (code & 0xff) + ").";
    $("halt").classList.add("on");
  }
  function logLine(t) {
    var el = $("log");
    el.textContent = (el.textContent + t).slice(-4000);
  }
  function describe(fw) {
    var m = fw.manifest, i = core.info, rows = [], src = m.source_url || i.source_url;
    var link = function (u) {
      var url = String(u).replace(/^(https:\/\/github\.com\/[^@\s]+)@([0-9a-f]{7,40})$/, "$1/tree/$2");
      return /^https:\/\//.test(url) ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(u) + "</a>" : esc(u);
    };
    $("title").textContent = m.name || i.name;
    $("fwname").textContent = (m.name || i.name) + " " + (m.version || "");
    document.title = (m.name || i.name) + " · " + (window.FM1_SITE_NAME || "FM-1 Browser Simulator");   /* pocket: its own name */
    var h1 = cur.builtin && m.id === "h1", hub = "https://thefirmwarehub.com/firmware/h1/", emu = !!fw.emu;
    $("sub").innerHTML = h1
      ? "h1, a firmware for the M-VAVE FM-1, running from its own code: the same 240 × 240 pixels and 44.1 kHz sound. Put it on your FM-1 from <a href=\"" + hub + "\" target=\"_blank\" rel=\"noopener\">The Firmware Hub</a>. Load any other FM-1 firmware from the firmware button."
      : esc("Running " + (m.name || i.name) + " " + (m.version || "") + (m.authors && m.authors.length ? " by " + m.authors.join(", ") : "") +
        (emu ? " from its original update package, on the emulator (evaluation)." : " from its .rfm1 file."));
    rows.push(["Name", m.name + " " + m.version]);
    if (m.authors && m.authors.length) rows.push(["By", m.authors.join(", ")]);
    rows.push(["Licence", lic(m.license) + (lic(m.license) !== m.license ? " (" + m.license + ")" : "")]);
    rows.push(["Source", link(src)]);
    if (h1) rows.push(["Install", '<a href="' + hub + '" target="_blank" rel="noopener">h1 on The Firmware Hub</a>']);
    if (m.glue_url) rows.push(["Build glue", link(m.glue_url)]);
    if (m.built_by) rows.push(["Built by", m.built_by]);
    rows.push(["Core", emu ? "the original package on " + i.family + " (Joakim Eriksson, MIT), evaluation"
      : "fm1core ABI " + core.abi + (i.family ? ", " + i.family + " family" : "") + (core.sim1 ? ", with the sim1 extension" : "")]);
    $("aboutmap").innerHTML = rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + (r[0] === "Source" || r[0] === "Build glue" || r[0] === "Install" ? r[1] : esc(r[1])) + "</dd>"; }).join("");
    var credits = fw.credits || i.credits;
    $("credits").hidden = !credits;
    $("credits").textContent = credits || "";
    $("licenses").innerHTML = fw.licenses.map(function (l, k) {
      return '<details><summary>' + esc(l.name) + '</summary><div><pre class="credits" id="lic' + k + '"></pre></div></details>';
    }).join("");
    fw.licenses.forEach(function (l, k) { $("lic" + k).textContent = l.text; });
    var dev = $("device");
    dev.style.backgroundImage = "";
    if (fw.skinImage && fw.skinImage.length < 4 * 1024 * 1024) {
      try {
        var url = URL.createObjectURL(new Blob([fw.skinImage]));
        var dim = fw.skin && +fw.skin.dim ? Math.min(0.8, +fw.skin.dim) : 0.35;
        dev.style.backgroundImage = "linear-gradient(rgba(21,21,24," + dim + "),rgba(21,21,24," + dim + ")), url(" + url + ")";
      } catch (e) { /* fine */ }
    }
    setInk(skinInk());
  }

  /* ---- the library ---- */
  function renderList() {
    if (window.FM1Pocket && window.FM1Pocket.render) return window.FM1Pocket.render(api);   /* pocket: its picker */
    var host = $("fwlist");
    host.innerHTML = "";
    library.forEach(function (e) {
      var row = document.createElement("div");
      row.className = "fw" + (cur && cur.key === e.key ? " cur" : "");
      row.innerHTML = '<div class="meta"><b>' + esc(e.name) + "</b><small>" + esc((e.version || "") + (e.builtin ? " · built in" : " · in this browser") + (e.license ? " · " + lic(e.license) : "")) + "</small></div>";
      var go = document.createElement("button");
      go.className = "chip";
      go.type = "button";
      go.textContent = cur && cur.key === e.key ? "running" : "run";
      go.addEventListener("click", function () { startAudio(); run(e); });
      row.appendChild(go);
      if (!e.builtin) {
        var rm = document.createElement("button");
        rm.className = "chip";
        rm.type = "button";
        rm.textContent = "remove";
        rm.addEventListener("click", function () { removeEntry(e); });
        row.appendChild(rm);
      }
      host.appendChild(row);
    });
  }
  function removeEntry(e) {
    dbDel("fw", e.key);
    library = library.filter(function (x) { return x !== e; });
    if (cur && cur.key === e.key) run(library[0]); else renderList();
  }
  /* pocket: what the picker (src/pocket-picker.js) may use */
  var api = {
    library: function () { return library; },
    current: function () { return cur; },
    run: function (e) { startAudio(); return run(e); },
    remove: removeEntry,
    core: function () { return core; },          /* the running engine (the emulator evaluation's browser test) */
    lic: lic,
    esc: esc
  };
  window.FM1Sim = api;
  function addBytes(bytes, from) {
    var fw, pkg = window.Fm1Emu && window.Fm1Emu.isPackage(bytes);
    var stem = String(from || "package").replace(/\.[^.]*$/, "");
    try { fw = pkg ? window.Fm1Emu.parse(bytes, { id: stem.toLowerCase().replace(/[^a-z0-9_]+/g, "_"), name: stem }) : R.parse(bytes); }
    catch (e) { showError((from ? from + ": " : "") + e.message); return Promise.resolve(); }
    return R.sha256(bytes).then(function (h) {
      var m = fw.manifest, key = (pkg ? "pkg:" : "fw:") + m.id + ":" + (h ? h.slice(0, 16) : m.version);
      var same = function (x) {                  /* the same file as one already here, a built-in too */
        if (x.key === key) return true;
        if (!x.bytes || x.bytes.length !== bytes.length) return false;
        for (var i = 0; i < bytes.length; i += 997) if (x.bytes[i] !== bytes[i]) return false;
        return true;
      };
      var entry = library.filter(same)[0];
      if (!entry) {
        entry = { key: key, name: m.name, version: m.version, license: m.license, bytes: bytes, added: Date.now() };
        library.push(entry);
        dbPut("fw", key, { key: key, name: m.name, version: m.version, license: m.license, bytes: bytes, added: entry.added });
      }
      startAudio();
      return run(entry);
    });
  }
  function openDrawer(on) {
    var d = $("drawer");
    d.hidden = on === undefined ? !d.hidden : !on;
    $("fwbtn").setAttribute("aria-expanded", String(!d.hidden));
  }
  function bindLoading() {
    $("fwbtn").addEventListener("click", function () { openDrawer(); });
    $("pick").addEventListener("click", function () { $("file").click(); });
    $("file").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (!f) return;
      f.arrayBuffer().then(function (b) { return addBytes(new Uint8Array(b), f.name); });
      this.value = "";
    });
    var fromUrl = function (u) {
      if (!/^https?:\/\//.test(u)) { showError("That is not a link."); return Promise.resolve(); }
      return fetch(u).then(function (r) {
        if (!r.ok) throw new Error("The server answered " + r.status + ".");
        return r.arrayBuffer();
      }).then(function (b) { return addBytes(new Uint8Array(b), u); }, function (e) {
        showError("Could not fetch that file (" + (e.message || e) + "). Many hosts, GitHub's release downloads among them, don't let other sites read their files: download it and drop it here instead.");
      });
    };
    $("go").addEventListener("click", function () { fromUrl($("url").value.trim()); });
    $("url").addEventListener("keydown", function (e) { if (e.key === "Enter") fromUrl($("url").value.trim()); });
    var depth = 0, drop = $("drop");
    window.addEventListener("dragenter", function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") >= 0) { depth++; drop.classList.add("on"); e.preventDefault(); } });
    window.addEventListener("dragleave", function () { if (--depth <= 0) { depth = 0; drop.classList.remove("on"); } });
    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("drop", function (e) {
      e.preventDefault();
      depth = 0;
      drop.classList.remove("on");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) f.arrayBuffer().then(function (b) { return addBytes(new Uint8Array(b), f.name); });
    });
    return fromUrl;
  }

  function setSize() {
    var v = $("size").value, g = $("glass");
    setPref("fm1sim.size", v);
    canvas.style.width = v === "real" ? "23.4mm" : (240 * +v) + "px";
    g.classList.toggle("smooth", v === "real");
    g.style.padding = v === "real" ? "7mm" : "";
  }

  /* ---- go ---- */
  makeAudio();
  buildButtons();
  Array.prototype.forEach.call(document.querySelectorAll(".ctl"), function (el) { ctls.push({ el: el, role: +el.dataset.role }); });
  buildKeys();
  bindComputerKeys();
  setMode(mode === "knob" ? "knob" : "slider");
  $("m-slider").addEventListener("click", function () { setMode("slider"); });
  $("m-knob").addEventListener("click", function () { setMode("knob"); });
  var fromUrl = bindLoading();
  var sv = pref("fm1sim.size", "");
  if (sv) $("size").value = sv;
  if (window.innerWidth < 600 && $("size").value === "3") $("size").value = "2";
  setSize();
  $("size").addEventListener("change", setSize);
  $("midi").addEventListener("change", function () { midiOn(this.checked); });
  $("sound").addEventListener("click", function () {
    if (!actx) return;
    if (!soundOn) startAudio(); else { muted = !muted; label(); }
  });
  var powerCycle = function () { if (cur) { startAudio(); run(cur); } };
  $("power").addEventListener("click", powerCycle);
  $("poweron").addEventListener("click", powerCycle);
  $("reset").addEventListener("click", function () {
    if (!core || !cur) return;
    var id = core.info.id || cur.key;
    core.halted = 1;                           /* stop it saving on the way out */
    dbDel("flash", id).then(function () { run(cur); });
  });
  window.addEventListener("pagehide", function () { saveFlash(true); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) saveFlash(true); });
  label();

  openDb().then(function () {
    (window.FM1_BUILTIN || []).forEach(function (b) { library.push({ key: b.key, name: b.name || "h1", builtin: true, url: b.url, b64: b.b64 }); });
    return dbAll("fw");
  }).then(function (saved) {
    (saved || []).sort(function (a, b) { return a.added - b.added; }).forEach(function (s) {
      library.push({ key: s.key, name: s.name, version: s.version, license: s.license, bytes: new Uint8Array(s.bytes), added: s.added });
    });
    /* name the built-ins from their manifests */
    return Promise.all(library.filter(function (e) { return e.builtin; }).map(function (e) {
      return bytesOf(e).then(function (b) { var m = R.parse(b).manifest; e.bytes = b; e.name = m.name; e.version = m.version; e.license = m.license; }, function () {});
    }));
  }).then(function () {                         /* pocket: the hosted catalogue, fetched one firmware at a time */
    return window.FM1Pocket && window.FM1Pocket.load ? window.FM1Pocket.load().then(function (more) { library = library.concat(more || []); }) : null;
  }).then(function () {
    var q = new URLSearchParams(location.search).get("fw"), last = pref("fm1sim.last", "");
    var pick = library.filter(function (e) { return e.key === last; })[0] || library[0];
    lastT = performance.now();
    requestAnimationFrame(frame);
    if (q && /^https?:\/\//.test(q)) return fromUrl(q);
    if (q) pick = library.filter(function (e) { return e.key === "builtin:" + q || e.key === "cat:" + q || e.name.toLowerCase() === q.toLowerCase(); })[0] || pick;   /* pocket: cat: */
    if (!pick) { showError("No firmware to run yet: open an .rfm1 file."); return; }
    return run(pick);
  });
})();
