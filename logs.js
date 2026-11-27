(function () {
  "use strict";

  /*
   * LEARNING MODEL. Accounts and the log both live in this browser's localStorage, so anyone who can
   * open the browser's developer tools can read them. A real system would keep both on a server.
   */
  var USERS_KEY = "northlight-logs-users-v1";
  var SESSION_KEY = "northlight-logs-session";
  var ITERATIONS = 100000;
  var NS = "http://www.w3.org/2000/svg";
  var PAGE_SIZE = 150;

  var SOURCES = {
    site:       { label: "Website",    color: "#8fa8c8" },
    automation: { label: "Automation", color: "#d9b24c" },
    helpdesk:   { label: "Help desk",  color: "#4ec9a0" },
    crm:        { label: "CRM",        color: "#6fb7ff" },
    staff:      { label: "Staff",      color: "#a78bfa" },
    track:      { label: "Tracker",    color: "#ff9a8d" },
    tools:      { label: "PC tools",   color: "#7fd1e8" },
    logs:       { label: "Logs",       color: "#f4f1ea" }
  };
  var LEVEL_MARK = { ok: "✓", info: "·", warn: "!", error: "✕" };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function svg(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function slog(event, detail, level) { if (window.NorthlightLog) window.NorthlightLog.add("logs", event, detail, { level: level || "info" }); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function clock(t) { var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
  function dayLabel(t) { return new Date(t).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }); }
  function srcInfo(s) { return SOURCES[s] || { label: s, color: "#8fa8c8" }; }

  // ================= accounts (Web Crypto PBKDF2) =================

  var subtle = window.crypto && window.crypto.subtle;
  var enc = new TextEncoder();
  function toB64(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function fromB64(str) { var s = atob(str), out = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
  async function hashPassword(pw, saltB64, iterations) {
    var key = await subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
    var bits = await subtle.deriveBits({ name: "PBKDF2", salt: fromB64(saltB64), iterations: iterations, hash: "SHA-256" }, key, 256);
    return toB64(new Uint8Array(bits));
  }
  function sameString(a, b) {
    if (a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  }
  function readUsers() { try { var u = JSON.parse(localStorage.getItem(USERS_KEY)); return Array.isArray(u) ? u : []; } catch (e) { return []; } }
  function saveUsers(list) { localStorage.setItem(USERS_KEY, JSON.stringify(list)); }
  function findUser(name) { name = name.trim().toLowerCase(); return readUsers().filter(function (u) { return u.username === name; })[0] || null; }
  function sessionUser() { try { return sessionStorage.getItem(SESSION_KEY); } catch (e) { return null; } }
  function setSession(name) { try { if (name) sessionStorage.setItem(SESSION_KEY, name); else sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }

  // ================= gate (sign up / sign in) =================

  var mode = "signup";
  function setMode(m) {
    mode = m;
    $("tab-signup").setAttribute("aria-pressed", String(m === "signup"));
    $("tab-signin").setAttribute("aria-pressed", String(m === "signin"));
    $("signup-form").hidden = m !== "signup";
    $("signin-form").hidden = m !== "signin";
    clearGateErrors();
  }
  function fieldErr(id, msg) {
    var input = $(id), err = $(id + "-err");
    err.textContent = msg; err.hidden = !msg;
    if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
    return !!msg;
  }
  function clearGateErrors() {
    ["su-name", "su-pass", "su-pass2", "si-name", "si-pass"].forEach(function (id) { fieldErr(id, ""); });
    $("si-general").hidden = true;
  }

  $("tab-signup").onclick = function () { setMode("signup"); };
  $("tab-signin").onclick = function () { setMode("signin"); };

  $("signup-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var name = $("su-name").value.trim().toLowerCase(), pw = $("su-pass").value, pw2 = $("su-pass2").value;
    var bad = false;
    if (!name) bad = fieldErr("su-name", "Please choose a username.") || bad;
    else if (!/^[a-z0-9._-]{3,24}$/.test(name)) bad = fieldErr("su-name", "Use 3 to 24 letters, numbers, dots, dashes or underscores.") || bad;
    else if (findUser(name)) bad = fieldErr("su-name", "That username is taken. Please pick another.") || bad;
    else fieldErr("su-name", "");
    if (!pw) bad = fieldErr("su-pass", "Please choose a password.") || bad;
    else if (pw.length < 8) bad = fieldErr("su-pass", "Your password needs at least 8 characters. It has " + pw.length + ".") || bad;
    else fieldErr("su-pass", "");
    if (!pw2) bad = fieldErr("su-pass2", "Please type the password again.") || bad;
    else if (pw2 !== pw) bad = fieldErr("su-pass2", "The two passwords are not the same.") || bad;
    else fieldErr("su-pass2", "");
    if (bad) { var first = ["su-name", "su-pass", "su-pass2"].filter(function (id) { return $(id).getAttribute("aria-invalid"); })[0]; $(first).focus(); return; }

    var btn = $("su-go"); btn.disabled = true;
    try {
      var salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
      var users = readUsers();
      users.push({ username: name, salt: salt, iterations: ITERATIONS, hash: await hashPassword(pw, salt, ITERATIONS), created: Date.now() });
      saveUsers(users);
      setSession(name);
      slog("account.created", "Logs account created for " + name, "ok");
      showApp();
    } catch (err) {
      fieldErr("su-name", "We could not create the account: this browser blocks storage.");
    }
    btn.disabled = false;
  });

  $("signin-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var name = $("si-name").value.trim().toLowerCase(), pw = $("si-pass").value;
    $("si-general").hidden = true;
    var bad = false;
    bad = fieldErr("si-name", name ? "" : "Please enter your username.") || bad;
    bad = fieldErr("si-pass", pw ? "" : "Please enter your password.") || bad;
    if (bad) { $(name ? "si-pass" : "si-name").focus(); return; }
    var btn = $("si-go"); btn.disabled = true;
    var u = findUser(name), ok = false;
    if (u) ok = sameString(await hashPassword(pw, u.salt, u.iterations), u.hash);
    btn.disabled = false;
    if (!ok) {
      slog("signin.failed", "Failed sign-in on the Logs site for " + name, "warn");
      $("si-general").textContent = "Wrong username or password.";
      $("si-general").hidden = false;
      return;
    }
    setSession(u.username);
    slog("signin", u.username + " signed in to the Logs site", "ok");
    showApp();
  });

  $("signout").onclick = function () {
    var u = sessionUser();
    if (u) slog("signout", u + " signed out of the Logs site");
    setSession(null);
    showGate();
  };

  function showGate() {
    $("app").hidden = true;
    $("gate").hidden = false;
    var total = window.NorthlightLog ? window.NorthlightLog.all().length : 0;
    $("teaser").textContent = total + " event" + (total === 1 ? "" : "s") + " recorded in this browser so far. Create a free account to read every one of them.";
    setMode(readUsers().length ? "signin" : "signup");
  }

  // ================= dashboard =================

  var state = { sources: null, level: "all", range: "all", q: "", shown: PAGE_SIZE };

  function allEvents() { return window.NorthlightLog ? window.NorthlightLog.all() : []; }

  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

  function filtered(list) {
    var now = Date.now();
    var min = state.range === "hour" ? now - 3600000 : state.range === "today" ? startOfToday() : 0;
    var q = state.q.trim().toLowerCase();
    return list.filter(function (e) {
      if (state.sources && !state.sources[e.source]) return false;
      if (state.level !== "all" && e.level !== state.level) return false;
      if (e.t < min) return false;
      if (q && (e.detail + " " + e.event + " " + e.source + " " + (e.rule || "") + " " + (e.page || "")).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function renderStats(list) {
    var now = Date.now();
    var hour = list.filter(function (e) { return e.t >= now - 3600000; }).length;
    var issues = list.filter(function (e) { return e.level === "warn" || e.level === "error"; }).length;
    var sources = {};
    list.forEach(function (e) { sources[e.source] = true; });
    var data = [[list.length, "events recorded"], [hour, "in the last hour"], [issues, "warnings and errors"], [Object.keys(sources).length, "parts of the site"]];
    var box = $("stats"); box.replaceChildren();
    data.forEach(function (d) { var t = el("div", "stat"); t.appendChild(el("div", "n", String(d[0]))); t.appendChild(el("div", "l", d[1])); box.appendChild(t); });
  }

  function renderCharts(list) {
    // events by source
    var counts = {};
    list.forEach(function (e) { counts[e.source] = (counts[e.source] || 0) + 1; });
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var max = Math.max.apply(null, keys.map(function (k) { return counts[k]; }).concat([1]));
    var rowH = 28, W = 560, H = Math.max(40, keys.length * rowH + 8);
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Events by part of the site: " + keys.map(function (k) { return srcInfo(k).label + " " + counts[k]; }).join(", ") });
    keys.forEach(function (k, i) {
      var y = 4 + i * rowH, w = Math.max(3, Math.round((counts[k] / max) * (W - 190)));
      s.appendChild(svg("text", { x: 0, y: y + 17, "font-size": 13, "class": "lbl" }, srcInfo(k).label));
      s.appendChild(svg("rect", { x: 100, y: y + 3, width: w, height: 18, rx: 4, fill: srcInfo(k).color }));
      s.appendChild(svg("text", { x: 100 + w + 8, y: y + 17, "font-size": 13, "class": "val" }, String(counts[k])));
    });
    $("chart-sources").replaceChildren(s);

    // last 24 hours, one bar per hour
    var now = Date.now(), hourMs = 3600000, bins = [];
    for (var i = 23; i >= 0; i--) bins.push({ start: now - (i + 1) * hourMs, n: 0 });
    list.forEach(function (e) { for (var b = 0; b < 24; b++) if (e.t > bins[b].start && e.t <= bins[b].start + hourMs) { bins[b].n++; break; } });
    var bmax = Math.max.apply(null, bins.map(function (b) { return b.n; }).concat([1]));
    var s2 = svg("svg", { viewBox: "0 0 560 96", role: "img", "aria-label": "Events per hour over the last 24 hours" });
    s2.appendChild(svg("line", { x1: 0, y1: 74, x2: 560, y2: 74, "class": "axis" }));
    bins.forEach(function (b, idx) {
      var h = Math.round((b.n / bmax) * 60);
      var x = idx * 23.3 + 2;
      if (b.n) s2.appendChild(svg("rect", { x: x, y: 74 - h, width: 17, height: h, rx: 3, fill: "#4ec9a0" }));
      if (idx % 6 === 0) s2.appendChild(svg("text", { x: x, y: 90, "font-size": 11, "class": "lbl" }, pad(new Date(b.start + hourMs).getHours()) + ":00"));
    });
    s2.appendChild(svg("text", { x: 558, y: 14, "font-size": 11, "text-anchor": "end", "class": "lbl" }, "peak " + bmax + " / hour"));
    $("chart-hours").replaceChildren(s2);
  }

  function renderChips(all) {
    var present = {};
    all.forEach(function (e) { present[e.source] = true; });
    var box = $("chips"); box.replaceChildren();
    Object.keys(present).sort().forEach(function (k) {
      var on = !state.sources || state.sources[k];
      var b = el("button", "chip" + (on ? " on" : ""), srcInfo(k).label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(!!on));
      b.style.setProperty("--c", srcInfo(k).color);
      b.onclick = function () {
        if (!state.sources) { state.sources = {}; Object.keys(present).forEach(function (s) { state.sources[s] = true; }); }
        state.sources[k] = !state.sources[k];
        if (Object.keys(present).every(function (s) { return state.sources[s]; })) state.sources = null;
        state.shown = PAGE_SIZE; render();
      };
      box.appendChild(b);
    });
  }

  function renderTape(list) {
    var box = $("tape"); box.replaceChildren();
    $("count").textContent = list.length ? "Showing " + Math.min(state.shown, list.length) + " of " + list.length + " matching events" : "No events match these filters.";
    var rows = list.slice().reverse().slice(0, state.shown);
    var lastDay = "";
    rows.forEach(function (e) {
      var day = dayLabel(e.t);
      if (day !== lastDay) { box.appendChild(el("div", "day", day)); lastDay = day; }
      var d = el("details", "ev lv-" + e.level);
      d.style.setProperty("--c", srcInfo(e.source).color);
      var s = el("summary");
      s.appendChild(el("time", "", clock(e.t)));
      s.appendChild(el("span", "mark", LEVEL_MARK[e.level] || "·"));
      s.appendChild(el("span", "src", srcInfo(e.source).label));
      s.appendChild(el("span", "txt", e.detail || e.event));
      d.appendChild(s);
      var pre = el("pre", "json", JSON.stringify(e, null, 2));
      d.appendChild(pre);
      box.appendChild(d);
    });
    $("more").hidden = list.length <= state.shown;
  }

  function render() {
    var all = allEvents();
    var list = filtered(all);
    renderStats(all);
    renderCharts(all);
    renderChips(all);
    renderTape(list);
    $("who").textContent = sessionUser() || "";
  }

  // controls
  $("level").onchange = function () { state.level = this.value; state.shown = PAGE_SIZE; render(); };
  $("range").onchange = function () { state.range = this.value; state.shown = PAGE_SIZE; render(); };
  $("q").addEventListener("input", function () { state.q = this.value; state.shown = PAGE_SIZE; render(); });
  $("more").onclick = function () { state.shown += PAGE_SIZE; render(); };

  // ---------- export (append-only record: there is deliberately no "clear" button) ----------
  function download(name, type, text) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function csvCell(v) {
    var s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;            // stop spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
  }
  $("export-json").onclick = function () {
    var list = filtered(allEvents());
    download("northlight-logs.json", "application/json", JSON.stringify(list, null, 2));
    slog("export", "Exported " + list.length + " log entries as JSON", "info");
    render();
  };
  $("export-csv").onclick = function () {
    var list = filtered(allEvents());
    var head = ["time", "source", "event", "level", "detail", "page", "rule"];
    var lines = [head.join(",")].concat(list.map(function (e) {
      return [new Date(e.t).toISOString(), e.source, e.event, e.level, e.detail, e.page, e.rule].map(csvCell).join(",");
    }));
    download("northlight-logs.csv", "text/csv", lines.join("\r\n"));
    slog("export", "Exported " + list.length + " log entries as CSV", "info");
    render();
  };

  // ---------- live feed ----------
  var art = document.querySelector(".sx-art");
  function beat() { if (!art) return; art.classList.remove("beat"); void art.getBoundingClientRect(); art.classList.add("beat"); }
  window.addEventListener("storage", function (e) {
    if (window.NorthlightLog && e.key === window.NorthlightLog.key && sessionUser()) {
      beat(); render();
      var live = $("live"); live.classList.add("on"); setTimeout(function () { live.classList.remove("on"); }, 1500);
    }
  });

  function showApp() {
    $("gate").hidden = true;
    $("app").hidden = false;
    state = { sources: null, level: "all", range: "all", q: "", shown: PAGE_SIZE };
    $("level").value = "all"; $("range").value = "all"; $("q").value = "";
    render();
  }

  // ---------- start ----------
  if (!subtle) {
    $("gate").hidden = false;
    $("gate-msg").textContent = "This page needs the Web Crypto API, which needs https:// or localhost. Open it from the live site or a local server.";
    $("signup-form").hidden = true; $("signin-form").hidden = true;
    return;
  }
  if (sessionUser() && findUser(sessionUser())) showApp(); else showGate();
})();
