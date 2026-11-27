(function () {
  "use strict";

  var KEY = "northlight-crm-v1";
  var HOUR = 60 * 60 * 1000;
  var STAGES = ["Lead", "Qualified", "Quote", "Won", "Lost"];
  var STAGE_COLOR = { Lead: "#8fa8c8", Qualified: "#6fb7ff", Quote: "#4ec9a0", Won: "#d9b24c", Lost: "#ff7a6b" };
  var PRIORITIES = ["High", "Medium", "Low"];
  var NS = "http://www.w3.org/2000/svg";

  function $(id) { return document.getElementById(id); }

  // ---------- data ----------

  function seed() {
    var now = Date.now();
    return {
      nextId: 10,
      leads: [
        { id: 1, name: "Marta Kovac", company: "Kovac Architects", email: "marta@kovac-arch.example", source: "Website", value: 12000, status: "New", created: now - 30 * HOUR },
        { id: 2, name: "Jiri Blaha", company: "Blaha Brewery", email: "jiri@blahabrew.example", source: "Referral", value: 8500, status: "New", created: now - 20 * HOUR },
        { id: 3, name: "Sofia Reyes", company: "Reyes Boutique Hotels", email: "sofia@reyes-hotels.example", source: "Event", value: 24000, status: "New", created: now - 6 * HOUR }
      ],
      accounts: [],
      contacts: [],
      opps: [],
      cases: [
        {
          id: 4, ref: "C-1001", subject: "Brand guidelines PDF will not download", customer: "Demo Customer Ltd",
          email: "demo.customer@example.com", priority: "High", due: now + 2 * HOUR, status: "Open", created: now - 1 * HOUR,
          events: [{ t: now - 1 * HOUR, text: "Request received. A team member will pick this up shortly." }]
        }
      ]
    };
  }

  var db = load() || seed();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.leads) && Array.isArray(d.opps)) return migrate(d);
      }
    } catch (e) { /* blocked or corrupt: use seed */ }
    return null;
  }

  // Older saved data has cases without a reference, email or updates: fill those in.
  function migrate(d) {
    var next = 1001;
    (d.cases || []).forEach(function (c) { var n = parseInt(String(c.ref || "").replace(/\D/g, ""), 10); if (n >= next) next = n + 1; });
    (d.cases || []).forEach(function (c) {
      if (!c.ref) c.ref = "C-" + (next++);
      if (typeof c.email !== "string") c.email = "";
      if (!Array.isArray(c.events)) c.events = [{ t: c.created || Date.now(), text: "Request received." }];
    });
    return d;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignore */ } }
  function nid() { return db.nextId++; }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0] || null; }
  function nameOf(list, id) { var x = byId(list, id); return x ? x.name : "-"; }

  var state = { tab: "leads", mode: "count" };

  // ---------- helpers ----------

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
  function money(v) {
    if (v >= 1000) { var k = v / 1000; return "€" + (Number.isInteger(k) ? k : k.toFixed(1)) + "k"; }
    return "€" + v;
  }
  function moneyFull(v) { return "€" + Number(v).toLocaleString("en"); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function toLocalInput(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 2400);
  }
  function badge(cls, text) { return el("span", "badge " + cls, text); }
  function btn(text, cls, fn) {
    var b = el("button", "btn " + (cls || ""), text);
    b.type = "button";
    if (fn) b.onclick = fn;
    return b;
  }
  function field(label, input) {
    var w = el("div");
    var l = el("label", "", label);
    l.htmlFor = input.id;
    w.appendChild(l);
    w.appendChild(input);
    return w;
  }
  function input(id, type, opts) {
    var i = el("input");
    i.id = id; i.type = type;
    Object.keys(opts || {}).forEach(function (k) { i[k] = opts[k]; });
    return i;
  }
  // headers: [{t:"Name", num:true}] ; rows: arrays of strings or nodes
  function table(headers, rows, rowClass) {
    var wrap = el("div", "tablewrap");
    var t = el("table");
    var hr = el("tr");
    headers.forEach(function (h) { hr.appendChild(el("th", h.num ? "num" : "", h.t)); });
    var th = el("thead"); th.appendChild(hr); t.appendChild(th);
    var tb = el("tbody");
    rows.forEach(function (r, ri) {
      var tr = el("tr", rowClass ? rowClass(ri) : "");
      r.forEach(function (c, i) {
        var td = el("td", headers[i] && headers[i].num ? "num" : "");
        if (c instanceof Node) td.appendChild(c); else td.textContent = c;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  // ---------- actions ----------

  function addLead(name, company, email, value) {
    db.leads.unshift({ id: nid(), name: name.trim(), company: company.trim(), email: email.trim(), source: "Manual", value: Math.max(0, Number(value) || 0), status: "New", created: Date.now() });
    save(); render(); toast("Lead added");
  }

  // Lead -> account + contact + opportunity.
  function convertLead(id) {
    var l = byId(db.leads, id);
    if (!l || l.status !== "New") return;
    var acc = db.accounts.filter(function (a) { return a.name.toLowerCase() === l.company.toLowerCase(); })[0];
    var reused = !!acc;
    if (!acc) { acc = { id: nid(), name: l.company, created: Date.now() }; db.accounts.push(acc); }
    var c = { id: nid(), accountId: acc.id, name: l.name, email: l.email };
    db.contacts.push(c);
    var o = { id: nid(), accountId: acc.id, contactId: c.id, name: acc.name + " - new project", value: l.value, stage: "Qualified", created: Date.now() };
    db.opps.push(o);
    l.status = "Converted";
    l.converted = { accountId: acc.id, contactId: c.id, oppId: o.id };
    save(); render();
    toast(l.name + " converted: " + (reused ? "existing account" : "new account") + ", contact and opportunity created");
  }

  function setStage(id, stage) {
    var o = byId(db.opps, id);
    if (o && STAGES.indexOf(stage) >= 0) { o.stage = stage; save(); render(); }
  }

  var CASE_STATUSES = ["Open", "In progress", "Closed"];
  // What the customer sees on the tracking page for each internal status.
  var STATUS_TEXT = {
    "Open": "We have received your request and will pick it up soon.",
    "In progress": "We are working on your request.",
    "Closed": "Your request is marked as resolved."
  };

  function isOpenCase(c) { return c.status !== "Closed"; }

  function nextCaseRef() {
    var n = db.cases.reduce(function (m, c) { return Math.max(m, parseInt(String(c.ref || "").replace(/\D/g, ""), 10) || 0); }, 1000);
    return "C-" + (n + 1);
  }

  function addCase(subject, customer, email, priority, dueMs) {
    var now = Date.now();
    var c = {
      id: nid(), ref: nextCaseRef(), subject: subject.trim(), customer: customer.trim(), email: email.trim(),
      priority: priority, due: dueMs, status: "Open", created: now,
      events: [{ t: now, text: "Request received. A team member will pick this up shortly." }]
    };
    db.cases.push(c);
    save(); render(); toast("Case " + c.ref + " created");
  }

  // Changes the status and (optionally) posts a note the customer can read on the tracking page.
  function postUpdate(id, status, note) {
    var c = byId(db.cases, id);
    if (!c || CASE_STATUSES.indexOf(status) < 0) return;
    var text = note.trim();
    var changed = c.status !== status;
    c.status = status;
    if (changed || text) {
      var lead = changed ? (status === "Closed" ? "Resolved. " : status === "In progress" ? "We are working on it. " : "Reopened. ") : "";
      c.events.push({ t: Date.now(), text: (lead + text).trim() });
    }
    save(); render();
    toast(c.email ? "Update posted. " + c.ref + " shows it on the tracking page" : "Update saved (no customer email on this case)");
  }

  function trackingLink(c) {
    return new URL("track.html?ref=" + encodeURIComponent(c.ref), location.href).href;
  }

  function copyTrackingLink(c) {
    var link = trackingLink(c);
    var done = function (ok) { toast(ok ? "Tracking link for " + c.ref + " copied" : "Copy this link: " + link); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }

  function resetDemo() {
    db = seed();
    save();
    state.tab = "leads";
    render();
    toast("Demo data reset");
  }

  // ---------- tiles ----------

  function isOverdue(c, now) { return isOpenCase(c) && now > c.due; }

  function renderTiles() {
    var now = Date.now();
    var openLeads = db.leads.filter(function (l) { return l.status === "New"; }).length;
    var pipeline = db.opps.filter(function (o) { return o.stage === "Lead" || o.stage === "Qualified" || o.stage === "Quote"; })
      .reduce(function (s, o) { return s + o.value; }, 0);
    var openCases = db.cases.filter(isOpenCase);
    var late = openCases.filter(function (c) { return isOverdue(c, now); }).length;
    var data = [
      [String(openLeads), "Open leads"],
      [String(db.accounts.length), "Accounts"],
      [moneyFull(pipeline), "Open pipeline"],
      [String(openCases.length), "Open cases" + (late ? " (" + late + " overdue)" : "")]
    ];
    var box = $("tiles");
    box.replaceChildren();
    data.forEach(function (d) {
      var t = el("div", "tile");
      t.appendChild(el("div", "n", d[0]));
      t.appendChild(el("div", "l", d[1]));
      box.appendChild(t);
    });
  }

  // ---------- chart (plain SVG) ----------

  function renderChart() {
    var mode = state.mode;
    var counts = {}, values = {};
    STAGES.forEach(function (s) { counts[s] = 0; values[s] = 0; });
    db.opps.forEach(function (o) { if (counts[o.stage] !== undefined) { counts[o.stage]++; values[o.stage] += o.value; } });
    var series = STAGES.map(function (s) { return mode === "count" ? counts[s] : values[s]; });
    var max = Math.max.apply(null, series.concat([0]));

    // y-axis maximum and tick step
    var top;
    if (mode === "count") {
      top = Math.max(4, Math.ceil(max / 4) * 4);
    } else if (max <= 0) {
      top = 4000;
    } else {
      var pow = Math.pow(10, Math.floor(Math.log10(max)));
      var f = max / pow;
      top = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
    }
    var fmtTick = function (v) { return mode === "count" ? String(v) : money(v); };

    var W = 640, H = 300, L = 52, R = 16, T = 28, B = 62;
    var pw = W - L - R, ph = H - T - B;
    var band = pw / STAGES.length, bw = Math.round(band * 0.56);
    var y = function (v) { return T + ph - (v / top) * ph; };

    var totalOpps = db.opps.length;
    var summary = STAGES.map(function (s) { return s + ": " + counts[s] + " (" + moneyFull(values[s]) + ")"; }).join("; ");

    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-labelledby": "chart-t chart-d" });
    s.appendChild(svg("title", { id: "chart-t" }, "Opportunities by stage (" + (mode === "count" ? "count" : "value") + ")"));
    s.appendChild(svg("desc", { id: "chart-d" }, totalOpps ? summary : "No opportunities yet."));

    // grid lines + y labels
    for (var i = 0; i <= 4; i++) {
      var v = (top / 4) * i, yy = y(v);
      s.appendChild(svg("line", { x1: L, x2: W - R, y1: yy, y2: yy, "class": i === 0 ? "axis" : "grid" }));
      s.appendChild(svg("text", { x: L - 8, y: yy + 4, "text-anchor": "end", "font-size": 11 }, fmtTick(v)));
    }

    // bars
    STAGES.forEach(function (st, idx) {
      var val = series[idx];
      var cx = L + band * idx + band / 2;
      var h = (val / top) * ph;
      if (val > 0) {
        s.appendChild(svg("rect", { x: cx - bw / 2, y: y(val), width: bw, height: h, rx: 4, fill: STAGE_COLOR[st] }));
      }
      s.appendChild(svg("text", { x: cx, y: y(val) - 7, "text-anchor": "middle", "font-size": 13, "class": "val" }, fmtTick(val)));
      s.appendChild(svg("text", { x: cx, y: H - B + 20, "text-anchor": "middle", "font-size": 12, "class": "val" }, st));
      s.appendChild(svg("text", { x: cx, y: H - B + 36, "text-anchor": "middle", "font-size": 11 },
        mode === "count" ? money(values[st]) : counts[st] + (counts[st] === 1 ? " opp" : " opps")));
    });

    var box = $("chart");
    box.replaceChildren(s);
    if (!totalOpps) box.appendChild(el("p", "empty", "No opportunities yet. Convert a lead to create one."));
    $("m-count").setAttribute("aria-pressed", String(mode === "count"));
    $("m-value").setAttribute("aria-pressed", String(mode === "value"));
  }

  // ---------- panels ----------

  function panelLeads(box) {
    var form = el("form", "inline");
    var n = input("ln", "text", { required: true, maxLength: 60, placeholder: "Full name" });
    var c = input("lc", "text", { required: true, maxLength: 60, placeholder: "Company" });
    var e = input("le", "email", { required: true, maxLength: 80, placeholder: "name@company.example" });
    var v = input("lv", "number", { min: 0, step: 500, value: 5000 });
    form.appendChild(field("Name", n));
    form.appendChild(field("Company", c));
    form.appendChild(field("Email", e));
    form.appendChild(field("Est. value (€)", v));
    var go = el("button", "btn primary", "Add lead");
    go.type = "submit";
    form.appendChild(go);
    form.onsubmit = function (ev) { ev.preventDefault(); addLead(n.value, c.value, e.value, v.value); };
    box.appendChild(form);

    if (!db.leads.length) return box.appendChild(el("p", "empty", "No leads."));
    var rows = db.leads.map(function (l) {
      var action;
      if (l.status === "New") {
        action = btn("Convert", "gold small", function () { convertLead(l.id); });
      } else {
        var cv = l.converted || {};
        action = el("span", "meta", "→ " + nameOf(db.accounts, cv.accountId));
      }
      return [l.name, l.company, l.email, l.source, moneyFull(l.value), badge(l.status === "New" ? "b-new" : "b-conv", l.status), action];
    });
    box.appendChild(table(
      [{ t: "Name" }, { t: "Company" }, { t: "Email" }, { t: "Source" }, { t: "Est. value", num: true }, { t: "Status" }, { t: "" }], rows));
  }

  function panelAccounts(box) {
    if (!db.accounts.length) return box.appendChild(el("p", "empty", "No accounts yet. Convert a lead to create one."));
    var rows = db.accounts.map(function (a) {
      var contacts = db.contacts.filter(function (c) { return c.accountId === a.id; }).length;
      var opps = db.opps.filter(function (o) { return o.accountId === a.id; });
      var open = opps.filter(function (o) { return o.stage !== "Won" && o.stage !== "Lost"; });
      var val = open.reduce(function (s, o) { return s + o.value; }, 0);
      return [a.name, String(contacts), String(open.length), moneyFull(val), new Date(a.created).toLocaleDateString()];
    });
    box.appendChild(table([{ t: "Account" }, { t: "Contacts", num: true }, { t: "Open opps", num: true }, { t: "Open value", num: true }, { t: "Created" }], rows));
  }

  function panelContacts(box) {
    if (!db.contacts.length) return box.appendChild(el("p", "empty", "No contacts yet. Convert a lead to create one."));
    var rows = db.contacts.map(function (c) { return [c.name, c.email, nameOf(db.accounts, c.accountId)]; });
    box.appendChild(table([{ t: "Name" }, { t: "Email" }, { t: "Account" }], rows));
  }

  function panelOpps(box) {
    if (!db.opps.length) return box.appendChild(el("p", "empty", "No opportunities yet. Convert a lead to create one."));
    var rows = db.opps.map(function (o) {
      var sel = el("select");
      sel.setAttribute("aria-label", "Stage for " + o.name);
      STAGES.forEach(function (s) { var op = el("option", "", s); op.value = s; if (s === o.stage) op.selected = true; sel.appendChild(op); });
      sel.onchange = function () { setStage(o.id, sel.value); };
      return [o.name, nameOf(db.accounts, o.accountId), nameOf(db.contacts, o.contactId), moneyFull(o.value), sel];
    });
    box.appendChild(table([{ t: "Opportunity" }, { t: "Account" }, { t: "Contact" }, { t: "Value", num: true }, { t: "Stage" }], rows));
  }

  function panelCases(box) {
    var form = el("form", "inline");
    var s = input("cs", "text", { required: true, maxLength: 120, placeholder: "What is the problem?" });
    var cu = input("cc", "text", { required: true, maxLength: 60, placeholder: "Customer" });
    var em = input("ce", "email", { required: true, maxLength: 80, placeholder: "customer@company.example" });
    var p = el("select"); p.id = "cp";
    PRIORITIES.forEach(function (x) { var o = el("option", "", x); o.value = x; if (x === "Medium") o.selected = true; p.appendChild(o); });
    var d = input("cd", "datetime-local", { required: true, value: toLocalInput(Date.now() + 4 * HOUR) });
    form.appendChild(field("Subject", s));
    form.appendChild(field("Customer", cu));
    form.appendChild(field("Customer email", em));
    form.appendChild(field("Priority", p));
    form.appendChild(field("Respond by", d));
    var go = el("button", "btn primary", "Create case");
    go.type = "submit";
    form.appendChild(go);
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var due = new Date(d.value).getTime();
      if (isNaN(due)) return;
      addCase(s.value, cu.value, em.value, p.value, due);
    };
    box.appendChild(form);

    if (!db.cases.length) return box.appendChild(el("p", "empty", "No cases."));
    var now = Date.now();
    var list = db.cases.slice().sort(function (a, b) {
      if (isOpenCase(a) !== isOpenCase(b)) return isOpenCase(a) ? -1 : 1;
      var pa = PRIORITIES.indexOf(a.priority), pb = PRIORITIES.indexOf(b.priority);
      if (pa !== pb) return pa - pb;
      return a.due - b.due;
    });
    var rows = list.map(function (c) {
      var due = el("span", isOverdue(c, now) ? "late" : "", new Date(c.due).toLocaleString());
      if (isOverdue(c, now)) due.appendChild(el("span", "overdue", "Overdue"));
      var sel = el("select");
      sel.setAttribute("aria-label", "Status of " + c.ref);
      CASE_STATUSES.forEach(function (st) { var op = el("option", "", st); op.value = st; if (st === c.status) op.selected = true; sel.appendChild(op); });
      sel.onchange = function () { postUpdate(c.id, sel.value, ""); };
      var link = btn("Copy link", "small", function () { copyTrackingLink(c); });
      link.title = c.email ? "Copy the customer tracking link" : "No customer email on this case, so it cannot be tracked";
      link.disabled = !c.email;
      return [el("span", "ref", c.ref), c.subject, c.customer, badge("pr-" + c.priority, c.priority), due, sel, link];
    });
    box.appendChild(table([{ t: "Ref" }, { t: "Subject" }, { t: "Customer" }, { t: "Priority" }, { t: "Respond by" }, { t: "Status" }, { t: "Tracking" }], rows,
      function (i) { return isOpenCase(list[i]) ? "" : "done"; }));

    // Post a customer-visible update. The customer sees it on track.html.
    var open = list.filter(isOpenCase);
    if (open.length) {
      var uf = el("form", "inline update");
      var cs = el("select"); cs.id = "uc";
      open.forEach(function (c) { var o = el("option", "", c.ref + " · " + c.subject); o.value = String(c.id); cs.appendChild(o); });
      var us = el("select"); us.id = "us";
      ["In progress", "Closed", "Open"].forEach(function (st) { var o = el("option", "", st === "Closed" ? "Resolved" : st); o.value = st; us.appendChild(o); });
      var note = input("un", "text", { required: true, maxLength: 240, placeholder: "e.g. We found the cause and are fixing it today." });
      uf.appendChild(field("Case", cs));
      uf.appendChild(field("New status", us));
      uf.appendChild(field("Message to the customer", note));
      var ub = el("button", "btn gold", "Post update");
      ub.type = "submit";
      uf.appendChild(ub);
      uf.onsubmit = function (ev) { ev.preventDefault(); postUpdate(Number(cs.value), us.value, note.value); };
      box.appendChild(el("h3", "sub", "Post an update to the customer"));
      box.appendChild(uf);
      box.appendChild(el("p", "meta", "Customers read updates on the tracking page with their reference and email. Use Copy link to share it."));
    }
  }

  var TABS = [
    ["leads", "Leads", function () { return db.leads.filter(function (l) { return l.status === "New"; }).length; }, panelLeads],
    ["accounts", "Accounts", function () { return db.accounts.length; }, panelAccounts],
    ["contacts", "Contacts", function () { return db.contacts.length; }, panelContacts],
    ["opps", "Opportunities", function () { return db.opps.length; }, panelOpps],
    ["cases", "Cases", function () { return db.cases.filter(isOpenCase).length; }, panelCases]
  ];

  function render() {
    renderTiles();
    renderChart();
    var tabs = $("tabs");
    tabs.replaceChildren();
    TABS.forEach(function (t) {
      var b = el("button", "tab", t[1]);
      b.type = "button";
      b.appendChild(el("span", "c", String(t[2]())));
      if (state.tab === t[0]) b.setAttribute("aria-current", "true");
      b.onclick = function () { state.tab = t[0]; render(); };
      tabs.appendChild(b);
    });
    var panel = $("panel");
    panel.replaceChildren();
    TABS.filter(function (t) { return t[0] === state.tab; })[0][3](panel);
  }

  save(); // store the data on first load so the customer tracking page can find the sample case

  $("m-count").onclick = function () { state.mode = "count"; renderChart(); };
  $("m-value").onclick = function () { state.mode = "value"; renderChart(); };
  $("reset").onclick = resetDemo;

  render();

  // Keep Overdue labels current, but never wipe a form the user is typing in.
  setInterval(function () {
    var a = document.activeElement;
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    render();
  }, 30 * 1000);
})();
