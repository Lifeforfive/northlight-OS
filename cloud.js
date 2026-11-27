(function () {
  "use strict";

  var cfg = window.NorthlightConfig || {};
  var K = window.NorthlightCloudCheck;     // the SAME rules the deploy check uses (tools/check-cloud.js)
  var NS = "http://www.w3.org/2000/svg";

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function S(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function slog(event, detail, level) { if (window.NorthlightLog) window.NorthlightLog.add("cloud", event, detail, { level: level || "info" }); }
  function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  if (!K) { $("diagram").appendChild(el("p", "none", "The checker (tools/check-cloud.js) could not be loaded.")); return; }

  var LABEL = { resourceGroup: "Resource group", webApp: "Web app", storageAccount: "Storage account" };
  var state = { doc: null, checks: [], selected: null, health: null, real: null };

  // ---------- helpers on the plan ----------

  function scopeOf(res, i) { return res && typeof res.name === "string" && res.name ? res.name : "resource #" + (i + 1); }
  function items(doc) {
    return (doc && Array.isArray(doc.resources) ? doc.resources : []).map(function (r, i) { return { res: r, i: i, scope: scopeOf(r, i) }; });
  }
  function fails(scope) { return state.checks.filter(function (c) { return !c.pass && c.scope === scope; }); }
  function tagProblem(scope, tag) {
    var f = fails(scope).filter(function (c) { return c.check === "tags" && c.message.indexOf('"' + tag + '"') >= 0; })[0];
    if (!f) return "";
    return /missing/.test(f.message) ? "missing" : /empty/.test(f.message) ? "empty" : "invalid";
  }

  // ---------- drawing ----------

  function icon(type, x, y) {
    var g = S("g", { "class": "ico-g", transform: "translate(" + x + "," + y + ")" });
    if (type === "webApp") {
      g.appendChild(S("rect", { "class": "ico", x: 0, y: 3, width: 30, height: 22, rx: 3 }));
      g.appendChild(S("path", { "class": "ico", d: "M0 9 H30 M5 6 h.01 M9 6 h.01" }));
    } else if (type === "storageAccount") {
      g.appendChild(S("ellipse", { "class": "ico", cx: 15, cy: 6, rx: 13, ry: 4 }));
      g.appendChild(S("path", { "class": "ico", d: "M2 6 V22 C2 26 28 26 28 22 V6 M2 14 C2 18 28 18 28 14" }));
    } else {
      g.appendChild(S("rect", { "class": "ico", x: 2, y: 3, width: 26, height: 22, rx: 3, "stroke-dasharray": "4 3" }));
    }
    return g;
  }

  function chip(parent, scope, tag, tags, x, y, w) {
    var bad = tagProblem(scope, tag), has = tags && Object.prototype.hasOwnProperty.call(tags, tag);
    var g = S("g", { "class": "chip" + (bad ? " bad" : "") });
    g.appendChild(S("rect", { x: x, y: y, width: w, height: 24, rx: 12 }));
    var txt = S("text", { x: x + 12, y: y + 16 });
    txt.appendChild(S("tspan", { "class": "k" }, tag + "  "));
    var v = bad ? (bad === "missing" ? "✕ missing" : "✕ " + bad) : trunc(has ? tags[tag] : "", Math.max(8, Math.floor((w - 24) / 6.3) - tag.length - 2));
    txt.appendChild(document.createTextNode(v));
    g.appendChild(txt);
    if (has && !bad) g.appendChild(S("title", {}, tag + ": " + tags[tag]));
    parent.appendChild(g);
  }

  function node(svg, it, x, y, w, h, selected) {
    var bad = fails(it.scope).length > 0;
    var g = S("g", { "class": "node" + (bad ? " bad" : "") + (selected ? " sel" : ""), tabindex: 0, role: "button", "aria-pressed": String(!!selected),
      "aria-label": (LABEL[it.res && it.res.type] || "Resource") + " " + it.scope + (bad ? ", has problems" : ", all checks pass") });
    g.appendChild(S("rect", { "class": "body", x: x, y: y, width: w, height: h, rx: 10 }));
    g.appendChild(icon(it.res && it.res.type, x + 16, y + 18));
    g.appendChild(S("text", { "class": "lbl", x: x + 58, y: y + 30 }, LABEL[it.res && it.res.type] || (it.res && it.res.type) || "Unknown"));
    g.appendChild(S("text", { "class": "nm", x: x + 16, y: y + 66 }, trunc(it.scope, Math.max(10, Math.floor((w - 32) / 8.4)))));
    var sub = it.res && (it.res.runtime ? "runtime " + it.res.runtime : it.res.sku ? "sku " + it.res.sku : "");
    if (sub) g.appendChild(S("text", { "class": "sub", x: x + 16, y: y + h - 14 }, sub));
    g.appendChild(S("text", { "class": "tick", x: x + w - 26, y: y + 30 }, bad ? "✕" : "✓"));
    g.appendChild(S("title", {}, it.scope + (bad ? ": " + fails(it.scope).length + " problem(s)" : ": all checks pass")));
    function pick() { select(it.scope); }
    g.addEventListener("click", pick);
    g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    svg.appendChild(g);
  }

  function chips3(svg, it, x, y, w, vertical) {
    var tags = it.res && it.res.tags && typeof it.res.tags === "object" ? it.res.tags : {};
    var extra = Object.keys(tags).filter(function (k) { return K.REQUIRED_TAGS.indexOf(k) < 0; });
    var list = K.REQUIRED_TAGS.concat(extra);
    var stem = S("line", { "class": "stem", x1: x + w / 2, y1: y - 22, x2: x + w / 2, y2: y - 4 });
    svg.appendChild(stem);
    list.forEach(function (t, i) { chip(svg, it.scope, t, tags, x, y + i * 32, w); });
    return y + list.length * 32;
  }

  function draw() {
    var box = $("diagram"); box.replaceChildren();
    var all = items(state.doc);
    if (!all.length) { box.appendChild(el("p", "none", "The plan has no resources to draw. Fix the JSON in the playground below.")); return; }
    var narrow = window.matchMedia("(max-width: 40rem)").matches;
    var rgItems = all.filter(function (a) { return a.res && a.res.type === "resourceGroup"; });
    var others = all.filter(function (a) { return !(a.res && a.res.type === "resourceGroup"); });
    var rg = rgItems[0] || null;
    var rgBad = rg ? fails(rg.scope).length > 0 : fails("file").length > 0;
    var W, H, rgX = 24, rgY = 64, rgW, svg;

    if (!narrow) {
      W = 920; rgW = W - 48;
      var n = Math.max(1, others.length), nodeW = Math.min(300, (rgW - 56 - (n - 1) * 36) / n), gap = (rgW - n * nodeW) / (n + 1);
      var nodeY = rgY + 48, nodeH = 108, chipsY = nodeY + nodeH + 34;
      var maxTags = Math.max(3, others.reduce(function (m, a) { return Math.max(m, K.REQUIRED_TAGS.length + Object.keys((a.res && a.res.tags) || {}).filter(function (k) { return K.REQUIRED_TAGS.indexOf(k) < 0; }).length); }, 0));
      var rgChipsY = chipsY + maxTags * 32 + 14, rgH = rgChipsY + 24 + 26 - rgY;
      H = rgY + rgH + 54;
      svg = S("svg", { viewBox: "0 0 " + W + " " + H, role: "group", "aria-label": "Cloud plan diagram" });
      svg.appendChild(S("rect", { "class": "rgbox" + (rgBad ? " bad" : ""), x: rgX, y: rgY, width: rgW, height: rgH, rx: 14 }));

      others.forEach(function (a, k) {
        var x = rgX + gap + k * (nodeW + gap);
        node(svg, a, x, nodeY, nodeW, nodeH, state.selected === a.scope);
        chips3(svg, a, x, chipsY, nodeW, false);
        var nxt = others[k + 1];
        if (nxt && ((a.res.type === "webApp" && nxt.res.type === "storageAccount") || (a.res.type === "storageAccount" && nxt.res.type === "webApp"))) {
          var x1 = x + nodeW, x2 = x + nodeW + gap, my = nodeY + nodeH / 2;
          svg.appendChild(S("path", { "class": "flow", d: "M" + (x1 + 4) + " " + my + " H" + (x2 - 12) }));
          svg.appendChild(S("path", { "class": "arrow", d: "M" + (x2 - 4) + " " + my + " l-9 -5 v10 z" }));
          svg.appendChild(S("text", { "class": "sub", x: (x1 + x2) / 2, y: my - 12, "text-anchor": "middle" }, "data"));
        }
      });
      // group tags along the bottom of the frame
      if (rg) {
        svg.appendChild(S("text", { "class": "lbl", x: rgX + 28, y: rgChipsY - 8 }, "Group tags"));
        var cw = (rgW - 56 - 2 * 14) / 3;
        K.REQUIRED_TAGS.forEach(function (t, i) { chip(svg, rg.scope, t, rg.res.tags || {}, rgX + 28 + i * (cw + 14), rgChipsY, cw); });
      }
    } else {
      W = 440; rgW = W - 28; rgX = 14;
      var nodeW2 = rgW - 56, nodeX = rgX + 28, nodeH2 = 96, y = rgY + 44;
      svg = S("svg", { viewBox: "0 0 10 10" });          // the real viewBox is set once the height is known
      others.forEach(function (a) {
        node(svg, a, nodeX, y, nodeW2, nodeH2, state.selected === a.scope);
        y += nodeH2;
        y = chips3(svg, a, nodeX, y + 30, nodeW2, true) + 26;
      });
      var tagsY = y + 6;
      svg.appendChild(S("text", { "class": "lbl", x: rgX + 28, y: tagsY }, "Group tags"));
      if (rg) K.REQUIRED_TAGS.forEach(function (t, i) { chip(svg, rg.scope, t, rg.res.tags || {}, nodeX, tagsY + 10 + i * 32, nodeW2); });
      var rgH2 = tagsY + 10 + 3 * 32 + 14 - rgY;
      H = rgY + rgH2 + 50;
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      svg.setAttribute("role", "group"); svg.setAttribute("aria-label", "Cloud plan diagram");
      svg.insertBefore(S("rect", { "class": "rgbox" + (rgBad ? " bad" : ""), x: rgX, y: rgY, width: rgW, height: rgH2, rx: 14 }), svg.firstChild);
      rgH = rgH2;
    }
    // the group's tab (drawn last so it sits on top of the frame)
    var title = rg ? rg.scope : "no resource group";
    var tabText = "RESOURCE GROUP · " + trunc(title, narrow ? 22 : 40) + (state.doc && state.doc.location ? " · " + state.doc.location : "");
    var tabW = Math.min(W - 48, tabText.length * 7.9 + 64);
    var tg = S("g", { "class": "rgtab node" + (rgBad ? " bad" : "") + (rg && state.selected === rg.scope ? " sel" : ""), tabindex: rg ? 0 : -1, role: "button", "aria-label": "Resource group " + title });
    tg.appendChild(S("rect", { x: rgX + 18, y: rgY - 14, width: tabW, height: 28, rx: 14 }));
    tg.appendChild(S("text", { x: rgX + 34, y: rgY + 5 }, tabText));
    tg.appendChild(S("text", { "class": "mark", x: rgX + 18 + tabW - 22, y: rgY + 5 }, rgBad ? "✕" : "✓"));
    if (rg) {
      tg.style.cursor = "pointer";
      tg.addEventListener("click", function () { select(rg.scope); });
      tg.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(rg.scope); } });
    }
    svg.appendChild(tg);

    // a drafting-style dimension line under the frame
    var dy = rgY + (typeof rgH === "number" ? rgH : 300) + 26;
    svg.appendChild(S("line", { "class": "dimline", x1: rgX, y1: dy, x2: rgX + rgW, y2: dy }));
    svg.appendChild(S("path", { "class": "dimline", d: "M" + rgX + " " + (dy - 6) + " v12 M" + (rgX + rgW) + " " + (dy - 6) + " v12", fill: "none" }));
    var dimLabel = S("text", { "class": "dimtxt", x: rgX + rgW / 2, y: dy - 8, "text-anchor": "middle" }, (state.doc && state.doc.location ? "location " + state.doc.location : "no location set") + "  ·  " + rgItems.length + (rgItems.length === 1 ? " group" : " groups") + " + " + others.length + (others.length === 1 ? " resource" : " resources"));
    svg.appendChild(dimLabel);
    box.appendChild(svg);
  }

  // ---------- summary, title block, detail ----------

  function updateSummary() {
    var total = state.checks.length, bad = state.checks.filter(function (c) { return !c.pass; }).length;
    var b = $("badge");
    b.className = "badge" + (bad ? " bad" : "");
    b.textContent = bad ? bad + " of " + total + " checks fail" : (total ? "All " + total + " checks pass" : "Nothing to check");
    var groups = items(state.doc).filter(function (a) { return a.res && a.res.type === "resourceGroup"; }).length;
    var n = items(state.doc).length;
    $("dim-text").textContent = groups + (groups === 1 ? " group" : " groups") + " · " + Math.max(0, n - groups) + (n - groups === 1 ? " resource" : " resources");

    var h = state.health || {};
    var cells = [["Project", cfg.siteName || "Northlight Studio"], ["Drawing", "Cloud plan, sheet 1 of 1"], ["Revision", h.version || "–"],
      ["Date", h.buildDate || "–"], ["Checked by", "tools/check-cloud.js"], ["Result", bad ? "NON-CONFORMING" : (total ? "CONFORMS" : "–")]];
    var tb = $("tblock"); tb.replaceChildren();
    cells.forEach(function (c, i) {
      var d = el("div"); d.appendChild(el("small", "", c[0]));
      d.appendChild(el("b", i === 5 ? "res " + (bad ? "bad" : "ok") : "", c[1]));
      tb.appendChild(d);
    });
  }

  function renderOut() {
    var out = $("out"); out.replaceChildren();
    state.checks.forEach(function (c) {
      var line = el("div", c.pass ? "p" : "f", (c.pass ? "PASS" : "FAIL") + "  " + String(c.scope).padEnd(22) + String(c.check).padEnd(16) + c.message);
      out.appendChild(line);
    });
    var bad = state.checks.filter(function (c) { return !c.pass; }).length;
    out.appendChild(el("span", "s", bad ? bad + " of " + state.checks.length + " checks FAILED." : "All " + state.checks.length + " checks passed."));
  }

  function renderDetail() {
    var box = $("detail"); box.replaceChildren();
    box.appendChild(el("h2", "", "Selected resource"));
    var it = items(state.doc).filter(function (a) { return a.scope === state.selected; })[0];
    if (!it) { box.appendChild(el("p", "hint", "Select a box in the drawing.")); return; }
    var r = it.res || {};
    box.appendChild(el("h3", "", (LABEL[r.type] || r.type || "Resource") + " · " + it.scope));
    var dl = el("dl", "kv");
    Object.keys(r).forEach(function (k) {
      if (k === "tags") return;
      dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", "", typeof r[k] === "object" ? JSON.stringify(r[k]) : String(r[k])));
    });
    Object.keys(r.tags && typeof r.tags === "object" ? r.tags : {}).forEach(function (k) { dl.appendChild(el("dt", "", "tag " + k)); dl.appendChild(el("dd", "", String(r.tags[k]))); });
    box.appendChild(dl);
    var ul = el("ul", "checks");
    state.checks.filter(function (c) { return c.scope === it.scope; }).forEach(function (c) {
      var li = el("li");
      li.appendChild(el("span", c.pass ? "p" : "f", c.pass ? "PASS" : "FAIL"));
      li.appendChild(el("span", "c", c.check));
      li.appendChild(el("span", "", c.message));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  function select(scope) { state.selected = scope; draw(); renderDetail(); var n = document.querySelector(".node.sel"); if (n) n.focus({ preventScroll: true }); }

  function update() {
    try { state.checks = K.validate(state.doc); } catch (e) { state.checks = [{ scope: "file", check: "structure", pass: false, message: "the plan could not be checked: " + e.message }]; }
    var all = items(state.doc);
    if (!all.some(function (a) { return a.scope === state.selected; })) state.selected = all.length ? all[0].scope : null;
    updateSummary(); draw(); renderDetail(); renderOut();
  }

  // ---------- rules table (built from the checker itself) ----------

  function renderRules() {
    var tb = $("rules"); tb.replaceChildren();
    Object.keys(K.TYPES).forEach(function (t) {
      var r = K.TYPES[t], tr = el("tr");
      var example = r.prefix + "northlight" + (r.chars.test("a-b") ? "-" : "") + "prod";
      [LABEL[t] || t, r.prefix, r.min + " to " + r.max, r.charsText + (r.notStart || r.notEnd ? "; cannot " + (r.notStart ? "start" : "") + (r.notStart && r.notEnd ? " or " : "") + (r.notEnd ? "end" : "") + ' with "' + (r.notStart || r.notEnd) + '"' : ""), example]
        .forEach(function (v) { tr.appendChild(el("td", "", v)); });
      tb.appendChild(tr);
    });
    var ul = $("rules-tags"); ul.replaceChildren();
    [
      "Every resource needs the tags " + K.REQUIRED_TAGS.join(", ") + ".",
      "env is one of " + K.ENVS.join(", ") + " and must match the end of the name and the resource group.",
      "cost-center looks like CC-1234. owner is an email address.",
      "Names are lowercase, contain “northlight” and are unique."
    ].forEach(function (t) { ul.appendChild(el("li", "", t)); });
  }

  // ---------- playground ----------

  var ta = $("pg"), pgMsg = $("pg-msg"), timer = null;
  function setText(doc) { ta.value = JSON.stringify(doc, null, 2); }
  function fromText() {
    try { var d = JSON.parse(ta.value); pgMsg.textContent = ""; state.doc = d; update(); }
    catch (e) { pgMsg.textContent = "Not valid JSON yet: " + e.message; }
  }
  ta.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(fromText, 250); });

  function mutate(fn, what) {
    var d; try { d = JSON.parse(ta.value); } catch (e) { d = JSON.parse(JSON.stringify(state.real)); }
    fn(d); setText(d); fromText();
    var bad = state.checks.filter(function (c) { return !c.pass; }).length;
    slog("playground", "Cloud playground: " + what + " (" + bad + " check" + (bad === 1 ? "" : "s") + " failing)", bad ? "warn" : "ok");
  }
  $("b-tag").onclick = function () {
    mutate(function (d) {
      var r = (d.resources || []).filter(function (x) { return x && x.tags && typeof x.tags === "object" && x.type !== "resourceGroup"; })[0] || (d.resources || [])[0];
      if (r && r.tags) { var k = K.REQUIRED_TAGS.filter(function (t) { return t in r.tags; })[0]; if (k) delete r.tags[k]; }
    }, "a tag removed");
  };
  $("b-name").onclick = function () {
    mutate(function (d) {
      var r = (d.resources || []).filter(function (x) { return x && x.type === "storageAccount"; })[0] || (d.resources || []).slice(-1)[0];
      if (r) r.name = "St-Northlight_Prod";
    }, "a name broken");
  };
  $("b-reset").onclick = function () {
    state.doc = JSON.parse(JSON.stringify(state.real)); setText(state.doc); pgMsg.textContent = ""; update();
    slog("playground", "Cloud playground reset to the real plan", "info");
  };

  window.matchMedia("(max-width: 40rem)").addEventListener("change", function () { draw(); });

  // ---------- start ----------

  renderRules();
  Promise.all([
    fetch(cfg.cloudPlanUrl || "northlight.cloud.json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }),
    fetch(cfg.healthUrl || "health.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (res) {
    state.real = res[0]; state.health = res[1];
    state.doc = JSON.parse(JSON.stringify(state.real));
    setText(state.doc);
    update();
  }).catch(function (e) {
    $("diagram").appendChild(el("p", "none", "Could not load " + (cfg.cloudPlanUrl || "northlight.cloud.json") + " (" + (e.message || "error") + ")."));
    $("badge").textContent = "Plan unavailable"; $("badge").className = "badge bad";
  });
})();
