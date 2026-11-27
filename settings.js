(function () {
  "use strict";

  var cfg = window.NorthlightConfig || {};
  var SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
  var health = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function size(chars) { return chars < 1024 ? chars + " B" : (chars / 1024).toFixed(1) + " KB"; }

  // ---------- health ----------

  function validHealth(h) {
    return h && typeof h.name === "string" && h.name.trim() && typeof h.version === "string" && SEMVER.test(h.version) &&
      typeof h.buildDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.buildDate);
  }

  function setState(kind, text) {
    $("state").className = "state " + kind;
    $("state-text").textContent = text;
  }

  function loadHealth() {
    setState("", "Checking " + (cfg.healthUrl || "health.json") + "…");
    return fetch(cfg.healthUrl || "health.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (h) {
        if (!validHealth(h)) throw new Error("the file is missing a name, a version like 1.2.3 or a build date like 2026-11-27");
        health = h;
        $("f-name").textContent = h.name;
        $("f-version").textContent = h.version;
        $("f-built").textContent = h.buildDate;
        setState("ok", "Healthy. " + (cfg.healthUrl || "health.json") + " loaded at " + new Date().toLocaleTimeString() + ".");
      })
      .catch(function (e) {
        health = null;
        ["f-name", "f-version", "f-built"].forEach(function (id) { $(id).textContent = "–"; });
        setState("bad", "Unavailable: " + (e.message || "could not load the health file") + ".");
      });
  }
  $("recheck").onclick = loadHealth;

  // ---------- settings (config.js) ----------

  function flatten(obj, prefix, out) {
    Object.keys(obj).forEach(function (k) {
      if (!prefix && k === "records") return;             // listed under "Your data" instead
      var v = obj[k], path = prefix ? prefix + "." + k : k;
      if (v && typeof v === "object") flatten(v, path, out); else out.push([path, String(v)]);
    });
    return out;
  }
  function renderSettings() {
    var dl = $("settings");
    dl.replaceChildren();
    flatten(cfg, "", []).forEach(function (kv) { dl.appendChild(el("dt", "", kv[0])); dl.appendChild(el("dd", "", kv[1])); });
  }

  // ---------- what is stored in this browser ----------

  function readAll() {
    var rows = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i), raw = localStorage.getItem(k);
      rows.push({ key: k, raw: raw, chars: k.length + raw.length });
    }
    rows.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    return rows;
  }
  function parse(raw) { try { return JSON.parse(raw); } catch (e) { return raw; } }
  function describe(raw) {
    var v = parse(raw);
    if (Array.isArray(v)) return v.length + (v.length === 1 ? " item" : " items");
    if (v && typeof v === "object") {
      var parts = Object.keys(v).filter(function (k) { return Array.isArray(v[k]); }).slice(0, 6).map(function (k) { return k + " " + v[k].length; });
      return parts.length ? parts.join(" · ") : Object.keys(v).length + " fields";
    }
    return "text";
  }

  function renderData() {
    var rows = readAll(), box = $("data"), records = cfg.records || {};
    box.replaceChildren();
    if (!rows.length) {
      box.appendChild(el("p", "none", "Nothing is stored in this browser yet. Use the site for a moment, then come back."));
      $("export").disabled = true;
      return rows;
    }
    var total = 0;
    rows.forEach(function (r) {
      total += r.chars;
      var row = el("div", "row");
      row.appendChild(el("div", "k", r.key));
      row.appendChild(el("div", "s", size(r.chars)));
      row.appendChild(el("div", "d", (records[r.key] || "Other record") + " · " + describe(r.raw)));
      box.appendChild(row);
    });
    var t = el("div", "total");
    t.appendChild(el("span", "", rows.length + (rows.length === 1 ? " record" : " records")));
    t.appendChild(el("span", "", size(total)));
    box.appendChild(t);
    $("export").disabled = false;
    return rows;
  }

  // ---------- export everything as one JSON file ----------

  function stamp() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes());
  }

  function exportAll() {
    var rows = readAll();
    if (!rows.length) return;
    var records = {};
    rows.forEach(function (r) { records[r.key] = parse(r.raw); });      // JSON values stay structured; anything else stays text
    var payload = {
      exportedBy: cfg.siteName || "Northlight Studio",
      version: health ? health.version : null,
      exportedAt: new Date().toISOString(),
      origin: location.origin,
      recordCount: rows.length,
      records: records
    };
    var text = JSON.stringify(payload, null, (cfg.export && cfg.export.indent) || 2);
    var name = ((cfg.export && cfg.export.fileNamePrefix) || "northlight-data") + "-" + stamp() + ".json";
    var blob = new Blob([text], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);

    var msg = "Exported " + rows.length + (rows.length === 1 ? " record" : " records") + " (" + size(text.length) + ") as " + name;
    $("done").textContent = msg; $("done").hidden = false;
    // The log records that an export happened: the count and size only, never the contents.
    if (window.NorthlightLog) window.NorthlightLog.add("site", "export.all", "Exported " + rows.length + " records (" + size(text.length) + ") to one JSON file", { level: "info" });
    renderData();
  }
  $("export").onclick = exportAll;

  // ---------- cloud plan (northlight.cloud.json) ----------

  function loadCloud() {
    fetch(cfg.cloudPlanUrl || "northlight.cloud.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (plan) {
        $("cloud-note").textContent = "A plan, not a deployment. tools/check-cloud.js checks every name and the tags owner, env and cost-center before each deploy.";
        var box = $("cloud"); box.replaceChildren();
        (plan.resources || []).forEach(function (r) {
          var d = el("div", "res");
          d.appendChild(el("div", "t", r.type + (r.resourceGroup ? " · in " + r.resourceGroup : (plan.location ? " · " + plan.location : ""))));
          d.appendChild(el("div", "n", r.name));
          var tags = el("div", "tags");
          Object.keys(r.tags || {}).forEach(function (k) {
            var s = el("span"); s.appendChild(document.createTextNode(k + " ")); s.appendChild(el("b", "", r.tags[k])); tags.appendChild(s);
          });
          d.appendChild(tags);
          box.appendChild(d);
        });
      })
      .catch(function (e) { $("cloud-note").textContent = "The cloud plan could not be loaded (" + (e.message || "error") + ")."; });
  }

  // ---------- start ----------

  renderSettings();
  renderData();
  loadHealth();
  loadCloud();
  // keep "Your data" current when another tab changes something
  window.addEventListener("storage", renderData);
  window.addEventListener("focus", renderData);
})();
