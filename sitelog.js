/*
 * Site-wide activity log (append-only, newest at the end).
 * Every page loads this file. It records that the page was opened and gives other scripts
 * NorthlightLog.add(source, event, detail, {level, rule}) to record what happened.
 * Stored in localStorage under "northlight-logs-v1" (max 1000 entries, oldest dropped).
 * Never pass emails, passwords or message text: only ids, counts and short descriptions.
 */
(function (root) {
  "use strict";
  var KEY = "northlight-logs-v1";
  var cfg = root.NorthlightConfig;                       // config.js (loaded first)
  var MAX = (cfg && cfg.logs && cfg.logs.maxEntries) || 1000;
  var counter = 0;

  function read() {
    try { var a = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); return true; } catch (e) { return false; }
  }
  function page() {
    var p = location.pathname.split("/").pop();
    return p || "index.html";
  }

  function add(source, event, detail, opts) {
    opts = opts || {};
    var entry = {
      id: Date.now().toString(36) + (counter++).toString(36),
      t: Date.now(),
      source: String(source),
      event: String(event),
      level: opts.level || "info",   // info | ok | warn | error
      detail: String(detail == null ? "" : detail).slice(0, 300),
      page: page()
    };
    if (opts.rule) entry.rule = opts.rule;
    var list = read();
    list.push(entry);
    write(list);
    return entry;
  }

  root.NorthlightLog = { add: add, all: read, key: KEY };

  try { add("site", "page.view", "Opened " + page()); } catch (e) { /* logging must never break a page */ }

  // Scripts that fail anywhere on the site are recorded too (file and line only, no user data).
  window.addEventListener("error", function (e) {
    try {
      var file = String(e.filename || "").split("/").pop() || "inline script";
      add("site", "js.error", String(e.message || "Script error") + " (" + file + ":" + (e.lineno || 0) + ")", { level: "error" });
    } catch (x) { /* never throw from the error handler */ }
  });
  window.addEventListener("unhandledrejection", function (e) {
    try {
      var why = e.reason && e.reason.message ? e.reason.message : String(e.reason || "rejected");
      add("site", "js.error", "Unhandled promise rejection: " + why, { level: "error" });
    } catch (x) { /* never throw from the error handler */ }
  });
})(window);
