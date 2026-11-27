/*
 * A quiet status line at the foot of every page: "● Northlight Studio 1.0.0 · built 2026-11-27 · Data & health".
 * Reads health.json (the path comes from config.js). Skipped on pages with data-no-statusbar on <body>.
 */
(function () {
  "use strict";
  var cfg = window.NorthlightConfig;
  if (!cfg || !cfg.statusBar || !cfg.statusBar.enabled) return;
  if (document.body.hasAttribute("data-no-statusbar") || document.getElementById("sx-status")) return;

  var style = document.createElement("style");
  style.textContent =
    "#sx-status{display:flex;flex-wrap:wrap;gap:.35rem .8rem;align-items:center;justify-content:center;padding:1.1rem 1rem 1.7rem;" +
    "font:500 .74rem/1.5 ui-monospace,'Cascadia Code',Consolas,monospace;letter-spacing:.04em;color:#8a9ab0;border-top:1px solid rgba(42,64,96,.55)}" +
    "#sx-status .d{width:.5rem;height:.5rem;border-radius:50%;background:#8a9ab0;flex:none}" +
    "#sx-status.ok .d{background:#4ec9a0;animation:sxbreath 3.4s ease-in-out infinite}" +
    "#sx-status.bad .d{background:#ff7a6b}" +
    "#sx-status a{color:#d9b24c;text-decoration:none;border-bottom:1px solid transparent;transition:border-color .25s ease}" +
    "#sx-status a:hover,#sx-status a:focus-visible{border-bottom-color:#d9b24c}" +
    "#sx-status a:focus-visible{outline:2px solid #f5b942;outline-offset:3px}" +
    "@keyframes sxbreath{0%{box-shadow:0 0 0 0 rgba(78,201,160,.5)}60%,100%{box-shadow:0 0 0 6px rgba(78,201,160,0)}}" +
    "@media (prefers-reduced-motion:reduce){#sx-status .d{animation:none!important}}";
  document.head.appendChild(style);

  var bar = document.createElement("div");
  bar.id = "sx-status";
  bar.setAttribute("role", "contentinfo");
  var dot = document.createElement("span"); dot.className = "d"; dot.setAttribute("aria-hidden", "true");
  var text = document.createElement("span"); text.textContent = "Checking health…";
  var link = document.createElement("a"); link.href = cfg.statusBar.link || "settings.html"; link.textContent = "Data & health ›";
  bar.appendChild(dot); bar.appendChild(text); bar.appendChild(link);
  document.body.appendChild(bar);

  function bad(msg) { bar.className = "bad"; text.textContent = msg; }
  fetch(cfg.healthUrl, { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (h) {
      if (!h || !h.name || !h.version || !h.buildDate) throw new Error("incomplete");
      bar.className = "ok";
      text.textContent = h.name + " " + h.version + " · built " + h.buildDate;
    })
    .catch(function () { bad("Health file unavailable"); });
})();
