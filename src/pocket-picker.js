/* FM-1 Pocket Player: the firmware picker (search, favourites, New, categories, a preview).
 *
 * Draws the firmware drawer's list in place of the simulator's own (src/app.js hands it the library
 * through window.FM1Sim). The hosted catalogue (data/catalog.json, built nightly by pocket/) adds one
 * library entry per firmware; its .rfm1 is fetched only when it is played, and app.js checks its
 * SHA-256 before running it. Favourites live in this browser, by firmware id, so they outlast updates.
 * Built-in and dropped-in firmwares keep working exactly as before. */
(function () {
  "use strict";
  var DATA = "data/";
  var NEW_DAYS = 14;
  var catalog = null, built = false, api = null;
  var state = { q: "", filter: "all", cat: "", open: "" };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function get(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* fine */ } }

  /* ---- favourites, by stable firmware id (a catalogue id, or a dropped file's manifest id) ---- */
  var favs = get("pocket.favs", []);
  function favId(e) { return e.catalog ? e.meta.id : (e.builtin ? e.key : e.key.replace(/^fw:([^:]+):.*$/, "$1")); }
  function isFav(e) { return favs.indexOf(favId(e)) >= 0; }
  function toggleFav(e) {
    var id = favId(e), i = favs.indexOf(id);
    if (i >= 0) favs.splice(i, 1); else favs.push(id);
    put("pocket.favs", favs);
  }

  function isNew(e) {
    if (!e.catalog || !catalog) return false;
    var a = e.meta.added, since = catalog.since;
    if (!a || !since || a <= since) return false;         /* there from the first catalogue: not "new" */
    return (Date.now() - Date.parse(a + "T00:00:00Z")) / 864e5 <= NEW_DAYS;
  }

  /* ---- the catalogue ---- */
  function load() {
    return fetch(DATA + "catalog.json", { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (c) {
      if (!c || c.schema !== 1 || !Array.isArray(c.firmwares)) throw new Error("unknown catalogue");
      catalog = c;
      return c.firmwares.map(function (f) {
        return { key: "cat:" + f.id, name: f.name, version: f.version, license: f.license,
                 url: DATA + f.file, sha256: f.sha256, catalog: true, meta: f };
      });
    }).catch(function () { catalog = null; return []; });   /* no catalogue: the simulator as it was */
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
        '<button type="button" class="chip" data-f="new">new</button>' +
        '<select id="pk-cat" aria-label="Category"><option value="">every category</option></select>' +
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
      "Every firmware is its authors' work, under its own licence: see <i>About this firmware</i>. " +
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
    if (state.filter === "fav" && !isFav(e)) return false;
    if (state.filter === "new" && !isNew(e)) return false;
    if (state.cat && (!e.catalog || m.category !== state.cat)) return false;
    if (!state.q) return true;
    var hay = [e.name, e.version, by(e), m.about, m.tag, m.category].join(" ").toLowerCase();
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
    el.innerHTML =
      '<button type="button" class="pk-row" aria-expanded="' + open + '">' + thumb(e) +
        '<span class="pk-meta"><b>' + esc(e.name) + " <small>" + esc(e.version || "") + "</small>" +
          (isNew(e) ? ' <i class="pk-new">new</i>' : "") + (m.beta ? ' <i class="pk-beta">beta</i>' : "") + "</b>" +
          "<small>" + esc([by(e), where, running ? "running" : ""].filter(Boolean).join(" · ")) + "</small></span>" +
      "</button>" +
      '<button type="button" class="pk-star" aria-pressed="' + isFav(e) + '" aria-label="' + (isFav(e) ? "Remove from" : "Add to") + ' favourites: ' + esc(e.name) + '">' + (isFav(e) ? "&#9733;" : "&#9734;") + "</button>";
    el.querySelector(".pk-row").addEventListener("click", function () { state.open = open ? "" : e.key; draw(); });
    el.querySelector(".pk-star").addEventListener("click", function () { toggleFav(e); draw(); });
    if (open) el.appendChild(preview(e, running));
    return el;
  }

  function preview(e, running) {
    var m = e.meta || {}, p = document.createElement("div");
    p.className = "pk-preview";
    var src = m.source ? '<a href="' + esc(m.source + (m.commit ? "/tree/" + m.commit : "")) + '" target="_blank" rel="noopener">source</a>' : "";
    p.innerHTML =
      (m.image ? '<img class="pk-shot" src="' + esc(DATA + m.image) + '" alt="' + esc(e.name) + ' on the FM-1 screen" loading="lazy" decoding="async">' : "") +
      '<div class="pk-pbody">' +
        (m.tag ? '<p class="pk-tag">' + esc(m.tag) + "</p>" : "") +
        (m.about ? "<p>" + esc(m.about) + "</p>" : (e.builtin ? "<p>Built into this player.</p>" : (e.catalog ? "" : "<p>A file you added. It stays in this browser until you remove it.</p>"))) +
        '<p class="pk-facts">' + esc([e.version, m.category, e.license ? api.lic(e.license) : ""].filter(Boolean).join(" · ")) + (src ? " · " + src : "") + "</p>" +
        '<div class="pk-actions"></div>' +
      "</div>";
    var acts = p.querySelector(".pk-actions"), play = document.createElement("button");
    play.type = "button";
    play.className = "chip pk-play";
    play.innerHTML = running ? "running" : "<b>&#9654; play</b>";
    play.disabled = running;
    play.addEventListener("click", function () {
      play.innerHTML = "loading&hellip;";
      play.disabled = true;
      api.run(e).then(function () { state.open = ""; draw(); });
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
    lib.forEach(function (e) { if (e.catalog && e.meta.category) cats[e.meta.category] = 1; });
    var sel = $("pk-cat"), have = Array.prototype.map.call(sel.options, function (o) { return o.value; });
    Object.keys(cats).sort().forEach(function (c) { if (have.indexOf(c) < 0) sel.add(new Option(c, c)); });
    sel.value = state.cat;
    Array.prototype.forEach.call(document.querySelectorAll(".pk-filters [data-f]"), function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.f === state.filter));
    });

    var shown = lib.filter(matches);
    host.innerHTML = "";
    section(host, "Built in", shown.filter(function (e) { return e.builtin; }), cur);
    section(host, "Your files", shown.filter(function (e) { return !e.builtin && !e.catalog; }), cur);
    var lib2 = shown.filter(function (e) { return e.catalog; });
    if (state.q) {                                          /* a name that matches comes first */
      var bare = function (x) { return String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }, qb = bare(state.q);
      var rank = function (e) { var n = bare(e.name); return n.indexOf(qb) === 0 ? 0 : n.indexOf(qb) >= 0 ? 1 : 2; };
      lib2 = lib2.map(function (e, i) { return [rank(e), i, e]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (x) { return x[2]; });
    }
    section(host, "Library", lib2, cur);
    if (!shown.length) {
      host.innerHTML = '<p class="note pk-none">' + (state.filter === "fav" ? "No favourites yet: tap the &#9734; beside a firmware." :
        state.filter === "new" ? "Nothing new in the last " + NEW_DAYS + " days." : "Nothing matches that.") + "</p>";
    }
    var n = lib.filter(function (e) { return e.catalog; }).length;
    $("pk-info").innerHTML = catalog
      ? esc(n + " firmwares in the library · catalogue last updated " + new Date(catalog.updated).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }))
      : "The hosted library isn't available right now. Built-in and your own files still work.";
  }

  function render(a) { api = a; build(); draw(); }

  window.FM1Pocket = { load: load, render: render };
})();
