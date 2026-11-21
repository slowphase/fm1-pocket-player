/* FM-1 Pocket Player: the firmware picker (search, favourites, New, categories, a preview).
 *
 * Draws the firmware drawer's list in place of the simulator's own (src/app.js hands it the library
 * through window.FM1Sim). The hosted catalogue adds one library entry per firmware; its .rfm1 is
 * fetched only when it is played, and app.js checks its SHA-256 before running it. Favourites live in
 * this browser, by firmware id, so they outlast updates. Built-in and dropped-in firmwares keep
 * working exactly as before.
 *
 * The catalogue is data/catalog-v2.json when the site has it (built nightly by pocket/discover.mjs),
 * else data/catalog.json. v2's downloadable entries are exactly catalog.json's; v2 also lists firmware
 * that cannot be played here (no browser build yet, restricted, awaiting review...), shown only under
 * the "more" filter, each with its reason and a link to its source.
 *
 * Where v2 has an `emu` block, a firmware can also run as its maker's original .fwsc package on the emulator: Pocket's
 * copy (data/pkg/, identical to the maker's release asset; its SHA-256 checked before it runs). Each firmware runs on
 * the catalogue's preferred engine unless the listener picked the other one in its preview. */
(function () {
  "use strict";
  var DATA = "data/";
  var NEW_DAYS = 14;
  var catalog = null, built = false, api = null, more = [];
  var state = { q: "", filter: "all", cat: "", open: "", sort: get("pocket.sort", "release") === "az" ? "az" : "release" };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function get(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* fine */ } }

  /* ---- favourites, by stable firmware id (a catalogue id, or a dropped file's manifest id) ---- */
  /* a listed-only firmware is favourited under its catalogue id too, so the favourite follows it when it becomes
     playable; favourites saved as "more:<id>" by earlier versions are read as "<id>" */
  var favs = get("pocket.favs", []).map(function (f) { return String(f).replace(/^more:/, ""); });
  function favId(e) { return (e.catalog || e.more) ? e.meta.id : (e.builtin ? e.key : e.key.replace(/^fw:([^:]+):.*$/, "$1")); }
  function isFav(e) { return favs.indexOf(favId(e)) >= 0; }
  function toggleFav(e) {
    var id = favId(e), i = favs.indexOf(id);
    if (i >= 0) favs.splice(i, 1); else favs.push(id);
    put("pocket.favs", favs);
  }

  /* "new to library": first listed in the last 14 days (the day the Hub added it, or the day Pocket first saw it).
   * Not a release date: a new release of an old firmware is not new to the library. */
  function isNew(e) {
    if (!(e.catalog || e.more) || !e.meta || !e.meta.listed) return false;
    return (Date.now() - Date.parse(e.meta.listed.slice(0, 10) + "T00:00:00Z")) / 864e5 <= NEW_DAYS;
  }
  /* the firmware's latest release as its maker published it (never a catalogue or rebuild date), or "" */
  function releaseOf(e) { return (e.meta && e.meta.release && e.meta.release.date) || ""; }
  function releaseText(e) {
    var r = e.meta && e.meta.release;
    if (!r || !r.date) return "";
    var d = new Date(r.date), t = isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    if (!t) return "";
    t = "released " + t + (r.version ? " (" + r.version + ")" : "");
    if (r.version && e.version && r.version !== e.version) t += "; this build: " + e.version;
    return t;
  }

  /* ---- the catalogue: v2 when the site has it, else v1 ---- */
  function fetchJson(name) {
    return fetch(DATA + name, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }
  var PLAYABLE = { playable: 1, experimental: 1 };
  function webState(f) { return f.status && f.status.web ? f.status.web.state : "playable"; }

  /* ---- engines: a firmware may run as its .rfm1 build (src/rfm1.js) and/or as the maker's original package on the
   * emulator (src/emu-core.js, upstream fm1-emu). The catalogue names the preferred one per firmware (emu.preferred);
   * a listener can switch, per firmware, and that choice is kept in this browser. Saves are kept per engine. ---- */
  var overrides = get("pocket.engine", {});
  function hasRfm1(f) { return !!(f.file && f.sha256 && PLAYABLE[webState(f)]); }
  function hasEmu(f) {
    var em = f.emu;
    return !!(em && em.package && em.package.file && em.web && PLAYABLE[em.web.state] && window.Fm1Emu);
  }
  function engines(f) { return (hasRfm1(f) ? ["rfm1"] : []).concat(hasEmu(f) ? ["fm1-emu"] : []); }
  function engineFor(f) {
    var have = engines(f), want = overrides[f.id], pref = f.emu && f.emu.preferred && f.emu.preferred.web;
    if (want && have.indexOf(want) >= 0) return want;
    if (pref && have.indexOf(pref.engine) >= 0) return pref.engine;
    return have[0];
  }
  /* what this player's engine for the entry says about it: {state, reason} */
  function webStatus(e) {
    var m = e.meta || {};
    if (e.engine === "fm1-emu") return m.emu.web;
    return m.status && m.status.web;
  }
  function use(e, engine) {
    var f = e.meta;
    e.engine = engine;
    if (engine === "fm1-emu") {
      var p = f.emu.package;
      e.url = DATA + p.file; e.sha256 = p.sha256; e.version = p.version || f.version;
      e.emuMeta = { id: f.id, name: f.name, version: e.version, license: p.license || f.license, source_url: p.source || f.source, authors: f.authors };
    } else {
      e.url = DATA + f.file; e.sha256 = f.sha256; e.version = f.version; e.emuMeta = null;
    }
    return e;
  }
  function setEngine(e, engine) {
    var pref = e.meta.emu && e.meta.emu.preferred && e.meta.emu.preferred.web;
    if (pref && pref.engine === engine) delete overrides[e.meta.id]; else overrides[e.meta.id] = engine;
    put("pocket.engine", overrides);
    use(e, engine);
  }
  function entry(f) {
    return use({ key: "cat:" + f.id, name: f.name, version: f.version, license: f.license, catalog: true, meta: f }, engineFor(f));
  }
  function load() {
    return fetchJson("catalog-v2.json").then(function (c) {
      if (!c || c.schema !== 2 || !Array.isArray(c.firmwares)) throw new Error("unknown catalogue");
      catalog = c;
      /* remember which ids catalog.json uses for firmware catalog-v2.json keeps under a permanent Pocket id (a
         promoted firmware's .rfm1 build), so a night on catalog.json alone still shows them under that id */
      var aliases = {};
      c.firmwares.forEach(function (f) { (f.aliases || []).forEach(function (a) { aliases[a] = f.id; }); });
      put("pocket.aliases", aliases);
      more = c.firmwares.filter(function (f) { return !engines(f).length; })
        .map(function (f) { return { key: "more:" + f.id, name: f.name, version: f.version, license: f.license, more: true, meta: f }; });
      return c.firmwares.filter(function (f) { return engines(f).length; }).map(entry);
    }).catch(function () {
      more = [];
      return fetchJson("catalog.json").then(function (c) {
        if (!c || c.schema !== 1 || !Array.isArray(c.firmwares)) throw new Error("unknown catalogue");
        catalog = c;
        var aliases = get("pocket.aliases", {});
        return c.firmwares.map(function (f) {
          var m = aliases[f.id] && !c.firmwares.some(function (x) { return x.id === aliases[f.id]; }) ? Object.assign({}, f, { id: aliases[f.id] }) : f;
          return { key: "cat:" + m.id, name: f.name, version: f.version, license: f.license,
            url: DATA + f.file, sha256: f.sha256, catalog: true, engine: "rfm1", meta: m };
        });
      });
    }).catch(function () { catalog = null; more = []; return []; });   /* no catalogue: the simulator as it was */
  }

  /* ---- the drawer's controls, made once ---- */
  function build() {
    if (built) return;
    built = true;
    var list = $("fwlist"), bar = document.createElement("div");
    bar.className = "pk-bar";
    bar.innerHTML =
      '<input type="search" id="pk-q" placeholder="search firmware, authors, sounds" aria-label="Search firmware" autocomplete="off">' +
      '<div class="pk-filters" role="group" aria-label="Show">' +
        '<button type="button" class="chip" data-f="all">all</button>' +
        '<button type="button" class="chip" data-f="fav">&#9733; favourites</button>' +
        '<button type="button" class="chip" data-f="new" title="First listed in the last 14 days">new to library</button>' +
        '<button type="button" class="chip" data-f="more" hidden title="Firmware that cannot be played here, with where to get it">more</button>' +
        '<select id="pk-cat" aria-label="Category"><option value="">every category</option></select>' +
        '<select id="pk-sort" aria-label="Sort"><option value="release">latest release</option><option value="az">A–Z</option></select>' +
      "</div>";
    list.parentNode.insertBefore(bar, list);
    list.classList.add("pk-list");
    var info = document.createElement("p");
    info.className = "note pk-info";
    info.id = "pk-info";
    list.parentNode.insertBefore(info, list.nextSibling);

    $("pk-q").addEventListener("input", function () { state.q = this.value; draw(); });
    $("pk-q").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { var first = list.querySelector(".pk-row"); if (first) first.click(); }
    });
    Array.prototype.forEach.call(bar.querySelectorAll("[data-f]"), function (b) {
      b.addEventListener("click", function () { state.filter = b.dataset.f; draw(); });
    });
    $("pk-cat").addEventListener("change", function () { state.cat = this.value; draw(); });
    $("pk-sort").value = state.sort;
    $("pk-sort").addEventListener("change", function () { state.sort = this.value; put("pocket.sort", state.sort); draw(); });

    /* a firmware whose saved state stops it starting: a way back, never silent */
    var halt = $("halt");
    if (halt && $("reset")) {
      var b = document.createElement("button");
      b.className = "chip";
      b.type = "button";
      b.textContent = "erase its saved state and start fresh";
      b.addEventListener("click", function () { $("reset").click(); });
      halt.appendChild(b);
    }
    credits();
    dropdown();
  }

  /* ---- the drawer opens over the page, under the firmware button ---- */
  function place() {
    var d = $("drawer"), btn = $("fwbtn"), wrap = document.querySelector(".wrap");
    if (!d || !btn || !wrap) return;
    var w = wrap.getBoundingClientRect(), b = btn.getBoundingClientRect();
    var width = Math.min(640, w.width - 32), left = Math.max(16, Math.min(b.left - w.left, w.width - width - 16));
    d.style.setProperty("--pk-top", (b.bottom - w.top + 8) + "px");
    d.style.setProperty("--pk-left", left + "px");
  }
  function close() {
    var d = $("drawer");
    if (d && !d.hidden) { d.hidden = true; $("fwbtn").setAttribute("aria-expanded", "false"); }
  }
  function dropdown() {
    var d = $("drawer"), btn = $("fwbtn");
    if (!d || !btn) return;
    d.classList.add("pk-pop");
    var x = document.createElement("button");
    x.type = "button";
    x.className = "pk-close";
    x.setAttribute("aria-label", "Close the firmware list");
    x.innerHTML = "&times;";
    x.addEventListener("click", function () { close(); btn.focus(); });
    d.insertBefore(x, d.firstChild);
    /* the simulator toggles `hidden`; place the panel whenever it opens */
    new MutationObserver(function () { if (!d.hidden) { place(); var q = $("pk-q"); if (q && window.innerWidth > 640) q.focus({ preventScroll: true }); } })
      .observe(d, { attributes: true, attributeFilter: ["hidden"] });
    window.addEventListener("resize", function () { if (!d.hidden) place(); });
    document.addEventListener("pointerdown", function (e) {
      if (d.hidden || d.contains(e.target) || btn.contains(e.target)) return;
      if ($("err").textContent) return;                  /* an error message stays until read */
      close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !d.hidden) { close(); btn.focus(); }
    });
  }

  /* ---- the page's credits line (once) ---- */
  function credits() {
    var wrap = document.querySelector(".wrap");
    if (!wrap || $("pk-credits")) return;
    var f = document.createElement("footer");
    f.id = "pk-credits";
    f.className = "pk-credits";
    f.innerHTML =
      "<p><b>FM-1 Pocket Player</b> plays FM-1 community firmware in the browser. " +
      'Browser simulator by <a href="https://github.com/jakehandy/fm1-browser-simulator" target="_blank" rel="noopener">Jake Handy</a> (MIT). ' +
      '<code>.rfm1</code> builds from <a href="https://github.com/Quixotic7/RemoteFM1FW" target="_blank" rel="noopener">RemoteFM1FW</a> by Michael P Jones (Quixotic7). ' +
      '<span id="pk-emu-credit"></span>' +
      "Every firmware is its authors' work, under its own licence: see <i>About this firmware</i>. " +
      '<span id="pk-hub-credit"></span>' +
      'Integration and hosting by <a href="https://github.com/slowphase/fm1-pocket-player" target="_blank" rel="noopener">slowphase</a>.</p>' +
      "<p>An independent community project, not affiliated with or endorsed by M-VAVE, or by the authors above. " +
      'Firmware authors: to change or remove a listing, <a href="https://github.com/slowphase/fm1-pocket-player/issues" target="_blank" rel="noopener">open an issue</a>.</p>';
    wrap.appendChild(f);
  }

  /* ---- rows ---- */
  function shade(id) {                    /* a steady colour per firmware, for the placeholder tile */
    var h = 0, i;
    for (i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + " 35% 30%)";
  }
  function thumb(e) {
    var m = e.meta || {}, id = m.id || e.key;
    if (m.image) return '<img class="pk-thumb" src="' + esc(DATA + m.image) + '" alt="" loading="lazy" decoding="async">';
    var letters = String(e.name || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
    return '<span class="pk-thumb pk-ph" style="background:' + shade(id) + '" aria-hidden="true">' + esc(letters) + "</span>";
  }
  function by(e) {
    var m = e.meta || {};
    return (m.authors && m.authors.length ? m.authors.join(", ") : "");
  }
  function matches(e) {
    var m = e.meta || {};
    if ((state.filter === "more") !== !!e.more) return false;   /* "more" shows only what can't be played here */
    if (state.filter === "fav" && !isFav(e)) return false;
    if (state.filter === "new" && !isNew(e)) return false;
    if (state.cat && ((!e.catalog && !e.more) || m.category !== state.cat)) return false;
    if (!state.q) return true;
    var hay = [e.name, e.version, by(e), m.about, m.attributedDescription && m.attributedDescription.text, m.tag, m.category].join(" ").toLowerCase();
    var bare = hay.replace(/[^a-z0-9]+/g, "");              /* "kwa" finds K-WA SUB, "fm1" finds FM-1 */
    return state.q.toLowerCase().split(/\s+/).every(function (w) {
      var b = w.replace(/[^a-z0-9]+/g, "");
      return !w || hay.indexOf(w) >= 0 || (b && bare.indexOf(b) >= 0);
    });
  }

  function row(e, cur) {
    var m = e.meta || {}, running = cur && cur.key === e.key, open = state.open === e.key;
    var where = e.builtin ? "built in" : (e.catalog ? (m.category || "") : "your file");
    var el = document.createElement("div");
    el.className = "pk-item" + (running ? " cur" : "") + (open ? " open" : "");
    el.dataset.key = e.key;
    el.innerHTML =
      '<button type="button" class="pk-row" aria-expanded="' + open + '">' + thumb(e) +
        '<span class="pk-meta"><b>' + esc(e.name) + " <small>" + esc(e.version || "") + "</small>" +
          (isNew(e) ? ' <i class="pk-new">new</i>' : "") + (m.beta ? ' <i class="pk-beta">beta</i>' : "") + badge(e) + "</b>" +
          "<small>" + esc([by(e), where, running ? "running" : ""].filter(Boolean).join(" · ")) + "</small></span>" +
      "</button>" +
      (e.more ? "<span></span>" : '<button type="button" class="pk-star" aria-pressed="' + isFav(e) + '" aria-label="' + (isFav(e) ? "Remove from" : "Add to") + ' favourites: ' + esc(e.name) + '">' + (isFav(e) ? "&#9733;" : "&#9734;") + "</button>");
    el.querySelector(".pk-row").addEventListener("click", function () { state.open = open ? "" : e.key; draw(); });
    if (!e.more) el.querySelector(".pk-star").addEventListener("click", function () { toggleFav(e); draw(); });
    if (open) el.appendChild(e.more ? morePreview(e) : preview(e, running));
    return el;
  }

  /* what this player can do with a v2 entry, as a small tag (nothing for plain playable ones) */
  var LABEL = { experimental: "untested", unsupported: "not supported", "source-only": "source only" };
  function badge(e) {
    var st = e.more ? (e.meta.status && e.meta.status.web) : webStatus(e), s = st ? st.state : "";
    return LABEL[s] ? ' <i class="pk-state pk-' + esc(s) + '" title="' + esc(st.reason || "") + '">' + LABEL[s] + "</i>" : "";
  }
  /* the engine line in a preview: small, and a switch only where both engines can run it */
  var ENGINE = { rfm1: ".rfm1 build", "fm1-emu": "original package (emulator)" };
  function engineLine(e, running) {
    var have = engines(e.meta), el = document.createElement("p");
    el.className = "pk-facts pk-engine";
    var pref = e.meta.emu && e.meta.emu.preferred && e.meta.emu.preferred.web;
    var t = "runs as its " + ENGINE[e.engine] + (pref && pref.engine !== e.engine && have.length > 1 ? " (your choice)" : "");
    // how sure we are, for this engine in this player: a person listened, automated checks only, or a known issue
    var c = e.meta.confidence && e.meta.confidence.web && e.meta.confidence.web[e.engine];
    var CONF = { listened: "listened to", automated: "automated checks only", "known-issue": "known issue" };
    if (c && CONF[c.level]) t += " · " + CONF[c.level];
    el.innerHTML = esc(t);
    if (c) el.title = c.note || "";
    if (pref && pref.engine === e.engine) el.title = (el.title ? el.title + " " : "") + (pref.reason || "");
    if (have.length > 1) {
      var other = have[0] === e.engine ? have[1] : have[0], b = document.createElement("button");
      b.type = "button";
      b.className = "pk-link";
      b.textContent = "use the " + ENGINE[other] + (pref && pref.engine === other ? " (recommended)" : "");
      b.title = "Each engine keeps its own saved state for this firmware.";
      b.addEventListener("click", function () {
        setEngine(e, other);
        if (running) { b.disabled = true; api.run(e).then(function () { draw(); }); } else draw();
      });
      el.appendChild(document.createTextNode(" · "));
      el.appendChild(b);
    }
    return el;
  }
  function link(href, text) { return '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(text) + "</a>"; }
  /* each maker, linked to their repository */
  function makers(m) {
    var list = m.makers && m.makers.length ? m.makers : (m.authors || []).map(function (n) { return { name: n, url: m.source }; });
    return list.map(function (x) { return x.url ? link(x.url, x.name) : esc(x.name); }).join(", ");
  }
  /* a firmware this player can't run: why, who made it, where it lives */
  /* a description written by another source carries its credit and licence (FM1 Editor's are MIT) */
  /* the description to show: the entry's own, else one written by another source, which is only ever shown with its
     credit and licence (FM1 Editor's are MIT) */
  function description(m) {
    if (m.about) return "<p>" + esc(m.about) + "</p>";
    var d = m.attributedDescription;
    if (!d || !d.text) return "";
    return "<p>" + esc(d.text) + "</p>" + '<p class="pk-facts">' + (d.url ? link(d.url, d.credit || "Description") : esc(d.credit || "Description")) +
      (d.license ? " · " + (d.licenseUrl ? link(d.licenseUrl, d.license) : esc(d.license)) : "") + (d.copyright ? " · " + esc(d.copyright) : "") + "</p>";
  }
  function morePreview(e) {
    var m = e.meta || {}, st = m.status && m.status.web || {}, p = document.createElement("div"), hub = m.provenance && m.provenance.hub,
      ed = m.provenance && m.provenance.editor;
    p.className = "pk-preview";
    /* each entry credits only the sources that listed it: an FM1 Editor listing never shows the Hub's credit */
    var links = [m.source ? link(m.source, "source") : "", hub ? link(hub.url, "on The Firmware Hub") : "",
      ed ? link(ed.url || (m.credit && m.credit.url), "listed by FM1 Editor") : ""].filter(Boolean).join(" · ");
    p.innerHTML = picture(e) + '<div class="pk-pbody">' +
      (m.tag ? '<p class="pk-tag">' + esc(m.tag) + "</p>" : "") +
      description(m) +
      '<p class="pk-why">' + esc(st.reason || (m.restriction && m.restriction.reason) || "") + "</p>" +
      (makers(m) ? '<p class="pk-facts">by ' + makers(m) + "</p>" : "") +
      '<p class="pk-facts">' + esc([m.version, m.category, m.license ? api.lic(m.license) : ""].filter(Boolean).join(" · ")) + (links ? " · " + links : "") + "</p>" +
      (releaseText(e) ? '<p class="pk-facts">' + esc(releaseText(e)) + "</p>" : "") +
      "</div>";
    return p;
  }

  /* every firmware has a picture: its screen, else a tile with its name (and maker) in its steady colour */
  function picture(e) {
    var m = e.meta || {};
    if (m.image) return '<img class="pk-shot" src="' + esc(DATA + m.image) + '" alt="' + esc(e.name) + ' on the FM-1 screen" loading="lazy" decoding="async">';
    return '<div class="pk-shot pk-logo" style="background:' + shade(m.id || e.key) + '" aria-hidden="true"><b>' + esc(e.name || "?") + "</b>" +
      (by(e) ? "<small>" + esc(by(e)) + "</small>" : "") + "</div>";
  }
  function preview(e, running) {
    var m = e.meta || {}, p = document.createElement("div");
    p.className = "pk-preview";
    var srcUrl = e.engine === "fm1-emu" ? (m.emu.package.source || m.source) : m.source && m.source + (m.commit ? "/tree/" + m.commit : "");
    var src = srcUrl ? '<a href="' + esc(srcUrl) + '" target="_blank" rel="noopener">source</a>' : "";
    p.innerHTML = picture(e) +
      '<div class="pk-pbody">' +
        (m.tag ? '<p class="pk-tag">' + esc(m.tag) + "</p>" : "") +
        (description(m) || (e.builtin ? "<p>Built into this player.</p>" : (e.catalog ? "" : "<p>A file you added. It stays in this browser until you remove it.</p>"))) +
        (m.status && makers(m) ? '<p class="pk-facts">by ' + makers(m) + "</p>" : "") +
        (webStatus(e) && webStatus(e).state === "experimental" ? '<p class="pk-why">' + esc(webStatus(e).reason) + "</p>" : "") +
        '<p class="pk-facts">' + esc([e.version, m.category, e.license ? api.lic(e.license) : ""].filter(Boolean).join(" · ")) + (src ? " · " + src : "") + "</p>" +
        (releaseText(e) ? '<p class="pk-facts">' + esc(releaseText(e)) + "</p>" : "") +
        '<div class="pk-actions"></div>' +
      "</div>";
    if (e.catalog && (m.emu || m.confidence)) p.querySelector(".pk-pbody").insertBefore(engineLine(e, running), p.querySelector(".pk-actions"));
    var acts = p.querySelector(".pk-actions"), play = document.createElement("button");
    play.type = "button";
    play.className = "chip pk-play";
    play.innerHTML = running ? "running" : "<b>&#9654; play</b>";
    play.disabled = running;
    play.addEventListener("click", function () {
      play.innerHTML = "loading&hellip;";
      play.disabled = true;
      api.run(e).then(function () { state.open = ""; draw(); if (!$("err").textContent) close(); });
    });
    acts.appendChild(play);
    if (!e.builtin && !e.catalog) {
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "chip";
      rm.textContent = "remove";
      rm.addEventListener("click", function () { state.open = ""; api.remove(e); });
      acts.appendChild(rm);
    }
    return p;
  }

  function section(host, title, items, cur) {
    if (!items.length) return;
    var h = document.createElement("h3");
    h.className = "pk-h";
    h.textContent = title;
    host.appendChild(h);
    items.forEach(function (e) { host.appendChild(row(e, cur)); });
  }

  /* ---- the whole list ---- */
  function draw() {
    if (!api) return;
    var lib = api.library(), cur = api.current(), host = $("fwlist");
    var cats = {};
    lib.concat(more).forEach(function (e) { if ((e.catalog || e.more) && e.meta.category) cats[e.meta.category] = 1; });
    var sel = $("pk-cat"), have = Array.prototype.map.call(sel.options, function (o) { return o.value; });
    Object.keys(cats).sort().forEach(function (c) { if (have.indexOf(c) < 0) sel.add(new Option(c, c)); });
    sel.value = state.cat;
    Array.prototype.forEach.call(document.querySelectorAll(".pk-filters [data-f]"), function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.f === state.filter));
    });

    var mb = document.querySelector('.pk-filters [data-f="more"]');
    if (mb) { mb.hidden = !more.length; mb.textContent = "more (" + more.length + ")"; }
    if (state.filter === "more" && !more.length) state.filter = "all";
    var shown = lib.concat(more).filter(matches);
    host.innerHTML = "";
    section(host, "Built in", shown.filter(function (e) { return e.builtin; }), cur);
    section(host, "Your files", shown.filter(function (e) { return !e.builtin && !e.catalog && !e.more; }), cur);
    var lib2 = shown.filter(function (e) { return e.catalog || e.more; });
    /* latest release first (unknown dates last), or A–Z; a search then puts the best name matches first */
    lib2 = lib2.map(function (e, i) { return [e, i]; }).sort(function (a, b) {
      if (state.sort === "release") { var x = releaseOf(a[0]), y = releaseOf(b[0]); if (x !== y) return x < y ? 1 : -1; }
      return String(a[0].name).localeCompare(String(b[0].name), undefined, { sensitivity: "base" }) || a[1] - b[1];
    }).map(function (x) { return x[0]; });
    if (state.q) {                                          /* a name that matches comes first */
      var bare = function (x) { return String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }, qb = bare(state.q);
      var rank = function (e) { var n = bare(e.name); return n.indexOf(qb) === 0 ? 0 : n.indexOf(qb) >= 0 ? 1 : 2; };
      lib2 = lib2.map(function (e, i) { return [rank(e), i, e]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (x) { return x[2]; });
    }
    section(host, state.filter === "more" ? "Not playable here" : "Library", lib2, cur);
    if (!shown.length) {
      host.innerHTML = '<p class="note pk-none">' + (state.filter === "fav" ? "No favourites yet: tap the &#9734; beside a firmware." :
        state.filter === "new" ? "Nothing joined the library in the last " + NEW_DAYS + " days." : "Nothing matches that.") + "</p>";
    }
    var n = lib.filter(function (e) { return e.catalog; }).length, a = catalog && catalog.attribution,
      ed = catalog && (catalog.sources || []).filter(function (s) { return s.name === "FM1 Editor"; })[0],
      edText = ed ? link(ed.url, "FM1 Editor") + " (MIT)" : "";
    $("pk-info").innerHTML = catalog
      ? esc(n + " firmwares in the library · catalogue last updated " + new Date(catalog.updated).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })) +
        (a ? '<br>Firmware list: ' + link(a.url, "The Firmware Hub – thefirmwarehub.com") + " (" + link(a.licenseUrl, a.license) + "), combined with RemoteFM1FW's builds and this site's checks; makers' texts and pictures are not copied." : "") +
        (ed ? "<br>More listings, not reviewed here: " + edText + "." : "")
      : "The hosted library isn't available right now. Built-in and your own files still work.";
    var rt = catalog && catalog.runtimes && catalog.runtimes["fm1-emu"], ec = $("pk-emu-credit");
    if (ec) ec.innerHTML = rt && window.Fm1Emu ? "Original packages run on " + link("https://github.com/" + rt.repository, "fm1-emu") +
      " by Joakim Eriksson (MIT; the emulator's licence, not the firmware's), unchanged, as the makers released them. " : "";
    var hc = $("pk-hub-credit");
    if (hc) hc.innerHTML = a ? "The list of firmware that can't be played here comes from " + link(a.url, "The Firmware Hub") + " (" + link(a.licenseUrl, a.license) + ")" +
      (ed ? " and " + edText : "") + ", combined with this site's own checks. " : ed ? "Some firmware that can't be played here is listed by " + edText + ". " : "";
  }

  function render(a) { api = a; build(); draw(); }

  window.FM1Pocket = { load: load, render: render };
})();
