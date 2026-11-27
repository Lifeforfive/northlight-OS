"use strict";
/*
 * LEARNING MODEL ONLY. Everything here runs in the browser and is saved in
 * localStorage, where anyone with access to the browser can read or change it.
 * Real systems check passwords and codes on a server. All data is fake.
 */
(function (root) {
  var STORAGE_KEY = "northlight-staff-v1";
  var ITERATIONS = 100000;      // PBKDF2 rounds
  var TOTP_PERIOD = 30;         // seconds
  var B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  var GROUPS = ["Design", "Sales", "IT"];

  var subtle = root.crypto && root.crypto.subtle;
  var enc = new TextEncoder();

  // ================= crypto helpers (pure, testable) =================

  function toB64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function fromB64(str) {
    var s = atob(str), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function randomBytes(n) { return root.crypto.getRandomValues(new Uint8Array(n)); }

  function base32Encode(bytes) {
    var bits = 0, value = 0, out = "";
    for (var i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
  }
  function base32Decode(str) {
    var clean = str.replace(/[\s=]/g, "").toUpperCase();
    var bits = 0, value = 0, out = [];
    for (var i = 0; i < clean.length; i++) {
      var idx = B32.indexOf(clean[i]);
      if (idx < 0) throw new Error("bad base32");
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    return new Uint8Array(out);
  }

  // Password hashing with Web Crypto: PBKDF2-SHA-256, random salt per user.
  async function hashPassword(password, salt, iterations) {
    var key = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    var bits = await subtle.deriveBits(
      { name: "PBKDF2", salt: salt, iterations: iterations || ITERATIONS, hash: "SHA-256" }, key, 256);
    return toB64(new Uint8Array(bits));
  }

  function sameString(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  // HOTP (RFC 4226) on top of Web Crypto HMAC-SHA-1.
  async function hotp(secretBytes, counter, digits) {
    var buf = new ArrayBuffer(8), view = new DataView(buf);
    view.setUint32(0, Math.floor(counter / 4294967296));
    view.setUint32(4, counter >>> 0);
    var key = await subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    var h = new Uint8Array(await subtle.sign("HMAC", key, buf));
    var off = h[h.length - 1] & 0x0f;
    var bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
    var d = digits || 6;
    return String(bin % Math.pow(10, d)).padStart(d, "0");
  }

  function timeStep(nowMs) { return Math.floor(nowMs / 1000 / TOTP_PERIOD); }

  // TOTP (RFC 6238): HOTP with counter = time step.
  function totp(secretB32, nowMs, digits) {
    return hotp(base32Decode(secretB32), timeStep(nowMs), digits);
  }

  // Accepts the current step and one either side (clock drift).
  // Returns the matched step, or null. A step at or before lastStep is refused (no replay).
  async function verifyTotp(secretB32, code, nowMs, lastStep) {
    if (!/^\d{6}$/.test(code)) return null;
    var now = timeStep(nowMs);
    for (var s = now - 1; s <= now + 1; s++) {
      if (typeof lastStep === "number" && s <= lastStep) continue;
      if (sameString(await totp(secretB32, s * TOTP_PERIOD * 1000), code)) return s;
    }
    return null;
  }

  function newPassword() {
    var chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", out = "";
    var r = randomBytes(12);
    for (var i = 0; i < 12; i++) out += chars[r[i] % chars.length];
    return out;
  }

  var api = {
    toB64: toB64, fromB64: fromB64, base32Encode: base32Encode, base32Decode: base32Decode,
    hashPassword: hashPassword, hotp: hotp, totp: totp, verifyTotp: verifyTotp, timeStep: timeStep
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return; // Node: stop here (used by tests)

  // ================= fake data =================

  var DEMO = [
    { username: "ada",   name: "Ada Lovelace",  group: "Design", role: "Art Director",       password: "Pixel-Ada-41" },
    { username: "ben",   name: "Ben Carter",    group: "Design", role: "Designer",           password: "Pixel-Ben-52" },
    { username: "chloe", name: "Chloe Dvorak",  group: "Sales",  role: "Sales Lead",         password: "Deal-Chloe-63" },
    { username: "dan",   name: "Dan Mora",      group: "Sales",  role: "Account Manager",    password: "Deal-Dan-74" },
    { username: "eva",   name: "Eva Kral",      group: "IT",     role: "IT Administrator",   password: "Root-Eva-85" },
    { username: "filip", name: "Filip Horak",   group: "IT",     role: "Support Technician", password: "Root-Filip-96" }
  ];

  async function makeUser(username, name, group, role, password) {
    var salt = randomBytes(16);
    return {
      id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      username: username, name: name, group: group, role: role,
      status: "active",
      salt: toB64(salt),
      iterations: ITERATIONS,
      hash: await hashPassword(password, salt, ITERATIONS),
      totpSecret: base32Encode(randomBytes(20)),
      lastTotpStep: -1,
      created: Date.now()
    };
  }

  async function seed() {
    var users = [];
    for (var i = 0; i < DEMO.length; i++) {
      var d = DEMO[i];
      users.push(await makeUser(d.username, d.name, d.group, d.role, d.password));
    }
    return { users: users, log: [] };
  }

  // ================= storage =================

  var db = null;

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && Array.isArray(data.users) && Array.isArray(data.log)) return data;
      }
    } catch (e) { /* blocked or corrupt: fall through */ }
    return null;
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ }
  }
  function logEvent(text) {
    db.log.unshift({ t: Date.now(), text: text });
    db.log = db.log.slice(0, 30);
    save();
    // Also record it in the site-wide log (logs.html). Fake accounts only; never passwords or codes.
    if (window.NorthlightLog) {
      var level = /Failed|failed|Blocked|denied|wrong/.test(text) ? "warn" : "info";
      window.NorthlightLog.add("staff", "staff.activity", text, { level: level });
    }
  }

  // ================= state =================

  var state = { view: "signin", pendingId: null, sessionId: null, tab: "directory", error: "", info: "", welcome: null, showJoiner: false };
  var timer = null;

  function userById(id) { return db.users.filter(function (u) { return u.id === id; })[0] || null; }
  function userByName(n) {
    n = n.trim().toLowerCase();
    return db.users.filter(function (u) { return u.username === n; })[0] || null;
  }
  function current() { return state.sessionId ? userById(state.sessionId) : null; }
  // Only an active member of the IT group may use the admin section.
  function canAdmin(u) { return !!u && u.status === "active" && u.group === "IT"; }

  // ================= DOM helpers =================

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function field(labelText, input) {
    var wrap = el("div", "field");
    var label = el("label", "", labelText);
    label.htmlFor = input.id;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }
  function input(id, type, extra) {
    var i = el("input");
    i.id = id; i.type = type; i.required = true;
    if (extra) Object.keys(extra).forEach(function (k) { i[k] = extra[k]; });
    return i;
  }
  function button(text, cls, onclick) {
    var b = el("button", "btn " + (cls || ""), text);
    b.type = "button";
    if (onclick) b.onclick = onclick;
    return b;
  }
  function fmt(ms) { return new Date(ms).toLocaleString(); }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  // ================= actions =================

  async function doSignIn(username, password) {
    state.error = ""; state.info = "";
    var u = userByName(username);
    var ok = false;
    if (u) {
      var h = await hashPassword(password, fromB64(u.salt), u.iterations);
      ok = sameString(h, u.hash);
    }
    if (!ok) {
      logEvent("Failed sign-in for \"" + username.trim() + "\" (wrong username or password)");
      state.error = "Wrong username or password.";
      return render();
    }
    if (u.status !== "active") {
      logEvent("Blocked sign-in: " + u.username + " is a leaver");
      state.error = "This account is disabled (leaver). Contact IT.";
      return render();
    }
    state.pendingId = u.id;
    state.view = "totp";
    logEvent(u.username + " passed step 1 (password)");
    render();
  }

  async function doTotp(code) {
    state.error = "";
    var u = userById(state.pendingId);
    if (!u || u.status !== "active") {
      logEvent("Blocked sign-in at step 2: account disabled");
      state.pendingId = null; state.view = "signin";
      state.error = "This account is disabled (leaver). Contact IT.";
      return render();
    }
    var step = await verifyTotp(u.totpSecret, code.trim(), Date.now(), u.lastTotpStep);
    if (step === null) {
      logEvent(u.username + " failed step 2 (wrong, expired or reused code)");
      state.error = "That code is wrong, expired or already used.";
      return render();
    }
    u.lastTotpStep = step;
    save();
    state.sessionId = u.id; state.pendingId = null; state.view = "app"; state.tab = "directory";
    logEvent(u.username + " signed in");
    render();
  }

  function signOut() {
    var u = current();
    if (u) logEvent(u.username + " signed out");
    state.sessionId = null; state.pendingId = null; state.view = "signin";
    state.error = ""; state.info = ""; state.welcome = null; state.showJoiner = false;
    render();
  }

  async function doJoiner(name, group, role) {
    var me = current();
    if (!canAdmin(me)) { state.error = "Only IT can add joiners."; return render(); }
    var base = name.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
    var username = base, n = 2;
    while (userByName(username)) { username = base + n++; }
    var password = newPassword();
    var u = await makeUser(username, name.trim(), group, role.trim(), password);
    db.users.push(u);
    logEvent(me.username + " added joiner " + username + " (" + group + ")");
    state.welcome = { username: username, password: password, secret: u.totpSecret, name: u.name };
    state.showJoiner = false;
    render();
  }

  function doLeaver(id) {
    var me = current();
    if (!canAdmin(me)) { state.error = "Only IT can mark leavers."; return render(); }
    var u = userById(id);
    if (!u || u.id === me.id || u.status === "left") return;
    u.status = "left";
    u.left = Date.now();
    logEvent(me.username + " marked " + u.username + " as leaver");
    state.info = u.name + " is now a leaver and can no longer sign in.";
    render();
  }

  async function resetDemo() {
    stopTimer();
    db = await seed();
    save();
    state = { view: "signin", pendingId: null, sessionId: null, tab: "directory", error: "", info: "Demo data reset.", welcome: null, showJoiner: false };
    if (window.NorthlightLog) window.NorthlightLog.add("staff", "reset", "Staff demo data reset (all users restored)", { level: "warn" });
    render();
  }

  // ================= views =================

  function viewSignIn(box) {
    box.appendChild(el("h2", "", "Sign in"));
    box.appendChild(el("p", "step", "Step 1 of 2: username and password"));
    var form = el("form");
    var u = input("su", "text", { autocomplete: "username", placeholder: "e.g. ada" });
    var p = input("sp", "password", { autocomplete: "current-password" });
    form.appendChild(field("Username", u));
    form.appendChild(field("Password", p));
    var go = el("button", "btn primary", "Continue");
    go.type = "submit";
    form.appendChild(go);
    form.onsubmit = function (e) { e.preventDefault(); go.disabled = true; doSignIn(u.value, p.value); };
    box.appendChild(form);
    setTimeout(function () { u.focus(); }, 0);
  }

  function viewTotp(box) {
    var u = userById(state.pendingId);
    box.appendChild(el("h2", "", "Second step"));
    box.appendChild(el("p", "step", "Step 2 of 2: one-time code for " + u.username));
    var form = el("form");
    var c = input("sc", "text", { inputMode: "numeric", autocomplete: "one-time-code", maxLength: 6, pattern: "\\d{6}", placeholder: "6 digits" });
    form.appendChild(field("One-time code", c));
    var go = el("button", "btn primary", "Sign in");
    go.type = "submit";
    form.appendChild(go);
    form.onsubmit = function (e) { e.preventDefault(); go.disabled = true; doTotp(c.value); };
    box.appendChild(form);

    // Simulated phone: in real life only the user's own authenticator app shows this.
    var phone = el("div", "phone");
    phone.appendChild(el("p", "kicker", "Simulated authenticator app"));
    var codeEl = el("div", "code", "------");
    var left = el("div", "meta");
    phone.appendChild(codeEl);
    phone.appendChild(left);
    var sec = el("details");
    sec.appendChild(el("summary", "", "Use a real authenticator app instead"));
    sec.appendChild(el("p", "meta", "Add this fake secret manually (time-based, 6 digits, 30 s):"));
    sec.appendChild(el("code", "", u.totpSecret));
    phone.appendChild(sec);
    box.appendChild(phone);

    function tick() {
      var now = Date.now();
      totp(u.totpSecret, now).then(function (v) { codeEl.textContent = v.slice(0, 3) + " " + v.slice(3); });
      left.textContent = "Changes in " + (TOTP_PERIOD - Math.floor(now / 1000) % TOTP_PERIOD) + " s";
    }
    tick();
    stopTimer();
    timer = setInterval(tick, 1000);

    var back = button("← Start again", "", function () { state.view = "signin"; state.pendingId = null; state.error = ""; render(); });
    box.appendChild(el("div", "nav")).appendChild(back);
    setTimeout(function () { c.focus(); }, 0);
  }

  function viewApp(box) {
    var me = current();
    var head = el("div", "who");
    var info = el("div");
    info.appendChild(el("h2", "", "Welcome, " + me.name));
    info.appendChild(el("p", "meta", me.group + " · " + me.role));
    head.appendChild(info);
    head.appendChild(button("Sign out", "", signOut));
    box.appendChild(head);

    var tabs = el("div", "tabs");
    [["directory", "Staff directory"], ["admin", "Admin"]].forEach(function (t) {
      var b = button(t[1], "tab" + (state.tab === t[0] ? " on" : ""), function () {
        state.tab = t[0]; state.error = ""; state.info = ""; state.welcome = null; state.showJoiner = false;
        if (t[0] === "admin" && !canAdmin(me)) logEvent(me.username + " was denied the admin section");
        render();
      });
      tabs.appendChild(b);
    });
    box.appendChild(tabs);

    if (state.tab === "directory") return viewDirectory(box);
    if (!canAdmin(me)) {
      var deny = el("div", "denied");
      deny.appendChild(el("h3", "", "Access denied"));
      deny.appendChild(el("p", "", "The admin section is only for the IT group. You are in " + me.group + "."));
      return box.appendChild(deny);
    }
    viewAdmin(box, me);
  }

  function groupBadge(g) { return el("span", "badge g-" + g.toLowerCase(), g); }

  function viewDirectory(box) {
    var table = el("table");
    var thead = el("thead"), hr = el("tr");
    ["Name", "Group", "Role"].forEach(function (h) { hr.appendChild(el("th", "", h)); });
    thead.appendChild(hr); table.appendChild(thead);
    var tb = el("tbody");
    db.users.filter(function (u) { return u.status === "active"; }).forEach(function (u) {
      var tr = el("tr");
      tr.appendChild(el("td", "", u.name));
      var tdg = el("td"); tdg.appendChild(groupBadge(u.group)); tr.appendChild(tdg);
      tr.appendChild(el("td", "", u.role));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    box.appendChild(wrapTable(table));
  }

  function wrapTable(t) { var w = el("div", "tablewrap"); w.appendChild(t); return w; }

  function viewAdmin(box, me) {
    if (state.info) box.appendChild(el("p", "ok", state.info));
    if (state.error) box.appendChild(el("p", "err", state.error));

    if (state.welcome) {
      var w = el("div", "welcome");
      w.appendChild(el("h3", "", "Welcome sheet for " + state.welcome.name));
      w.appendChild(el("p", "meta", "Shown once. Give these to the new person securely."));
      var dl = el("dl");
      [["Username", state.welcome.username], ["Temporary password", state.welcome.password], ["TOTP secret", state.welcome.secret]].forEach(function (r) {
        dl.appendChild(el("dt", "", r[0]));
        dl.appendChild(el("dd", "", r[1]));
      });
      w.appendChild(dl);
      box.appendChild(w);
    }

    var bar = el("div", "nav");
    bar.appendChild(button("Joiner", "primary", function () { state.showJoiner = !state.showJoiner; state.welcome = null; render(); }));
    box.appendChild(bar);

    if (state.showJoiner) {
      var form = el("form", "joiner");
      var n = input("jn", "text", { maxLength: 60, placeholder: "e.g. Greta Novak" });
      var g = el("select"); g.id = "jg";
      GROUPS.forEach(function (x) { var o = el("option", "", x); o.value = x; g.appendChild(o); });
      var r = input("jr", "text", { maxLength: 60, placeholder: "e.g. Junior Designer" });
      form.appendChild(field("Full name", n));
      form.appendChild(field("Group", g));
      form.appendChild(field("Role", r));
      var go = el("button", "btn primary", "Add joiner");
      go.type = "submit";
      form.appendChild(go);
      form.onsubmit = function (e) { e.preventDefault(); go.disabled = true; doJoiner(n.value, g.value, r.value); };
      box.appendChild(form);
    }

    var table = el("table");
    var thead = el("thead"), hr = el("tr");
    ["Name", "Username", "Group", "Role", "Status", ""].forEach(function (h) { hr.appendChild(el("th", "", h)); });
    thead.appendChild(hr); table.appendChild(thead);
    var tb = el("tbody");
    db.users.forEach(function (u) {
      var tr = el("tr", u.status === "left" ? "left" : "");
      tr.appendChild(el("td", "", u.name));
      tr.appendChild(el("td", "", u.username));
      var tdg = el("td"); tdg.appendChild(groupBadge(u.group)); tr.appendChild(tdg);
      tr.appendChild(el("td", "", u.role));
      var tds = el("td"); tds.appendChild(el("span", "badge " + (u.status === "left" ? "s-left" : "s-active"), u.status === "left" ? "Left" : "Active")); tr.appendChild(tds);
      var tda = el("td");
      var lb = button("Leaver", "ghost", function () { doLeaver(u.id); });
      lb.disabled = u.status === "left" || u.id === me.id;
      if (u.id === me.id) lb.title = "You cannot mark yourself as a leaver";
      tda.appendChild(lb);
      tr.appendChild(tda);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    box.appendChild(wrapTable(table));

    box.appendChild(el("h3", "", "Audit log"));
    var ul = el("ul", "log");
    if (!db.log.length) ul.appendChild(el("li", "meta", "Nothing yet."));
    db.log.slice(0, 12).forEach(function (e) { ul.appendChild(el("li", "", fmt(e.t) + "  " + e.text)); });
    box.appendChild(ul);
  }

  function render() {
    stopTimer();
    var box = $("app");
    box.replaceChildren();
    if (state.view === "app" && !current()) state.view = "signin";
    if (state.view !== "app") {
      if (state.info) box.appendChild(el("p", "ok", state.info));
      if (state.error) box.appendChild(el("p", "err", state.error));
    }
    if (state.view === "signin") viewSignIn(box);
    else if (state.view === "totp") viewTotp(box);
    else viewApp(box);
  }

  function renderDemoTable() {
    var tb = $("demo-body");
    tb.replaceChildren();
    DEMO.forEach(function (d) {
      var tr = el("tr");
      [d.username, d.name, d.group, d.role, d.password].forEach(function (v) { tr.appendChild(el("td", "", v)); });
      tb.appendChild(tr);
    });
  }

  // ================= start =================

  async function start() {
    if (!subtle) {
      $("app").textContent = "This page needs the Web Crypto API, which needs https:// or localhost. Open it from the live site or a local server.";
      return;
    }
    db = load();
    if (!db) { db = await seed(); save(); }
    renderDemoTable();
    $("reset").onclick = resetDemo;
    render();
  }
  start();
})(typeof globalThis !== "undefined" ? globalThis : window);
