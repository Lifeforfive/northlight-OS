(function () {
  "use strict";

  var STORAGE_KEY = "northlight-helpdesk-v2";
  var HOUR = 60 * 60 * 1000;
  var MINUTE = 60 * 1000;

  // Response targets per priority.
  var TARGETS = {
    1: { label: "P1", ms: 1 * HOUR, text: "1 hour" },
    2: { label: "P2", ms: 4 * HOUR, text: "4 hours" },
    3: { label: "P3", ms: 24 * HOUR, text: "24 hours" }
  };

  var STATUSES = ["New", "In progress", "Resolved"];
  var LEVELS = { 3: "High", 2: "Medium", 1: "Low" };

  function $(id) { return document.getElementById(id); }

  // impact + urgency (1..3 each) -> priority 1..3
  function priorityFor(impact, urgency) {
    var score = impact + urgency;
    if (score >= 5) return 1;
    if (score === 4) return 2;
    return 3;
  }

  function dueAt(t) { return t.created + TARGETS[t.priority].ms; }

  function isOverdue(t, now) {
    return t.status !== "Resolved" && now > dueAt(t);
  }

  function formatDuration(ms) {
    var m = Math.round(ms / MINUTE);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60);
    var rest = m % 60;
    if (h < 24) return h + " h" + (rest ? " " + rest + " min" : "");
    var d = Math.floor(h / 24);
    return d + " d " + (h % 24) + " h";
  }

  // ---------- storage ----------

  function fakeData() {
    var now = Date.now();
    function make(id, who, issue, impact, urgency, ageMs, status) {
      return {
        id: id,
        requester: who,
        issue: issue,
        impact: impact,
        urgency: urgency,
        priority: priorityFor(impact, urgency),
        status: status,
        created: now - ageMs
      };
    }
    return [
      make(1001, "Jana Novak", "Shared design server is down, nobody can open project files.", 3, 3, 95 * MINUTE, "In progress"),
      make(1002, "Tomas Brandt", "Figma licence expired for the branding team.", 2, 3, 20 * MINUTE, "New"),
      make(1003, "Eva Kral", "Large-format printer shows paper jam error.", 2, 2, 5 * HOUR, "New"),
      make(1004, "Martin Vesely", "Request for a second monitor at my desk.", 1, 1, 6 * HOUR, "New"),
      make(1005, "Lucie Horak", "Wi-Fi drops in meeting room B twice a day.", 2, 2, 90 * MINUTE, "In progress"),
      make(1006, "Petr Dvorak", "Cannot print from laptop to the studio plotter.", 1, 3, 30 * HOUR, "Resolved"),
      make(1007, "Anna Svoboda", "Archive folder for 2019 projects is missing.", 3, 1, 3 * HOUR, "New"),
      // Module 1 tickets
      make(1008, "Studio director", "I can't open my email and my client meeting starts in 30 minutes.", 3, 3, 10 * MINUTE, "New"),
      make(1009, "Designer", "The second-floor printer prints blank pages.", 2, 1, 2 * HOUR, "New"),
      make(1010, "HR", "New starter Maya begins Monday. She needs a laptop and accounts.", 2, 2, 1 * HOUR, "New"),
      make(1011, "Finance", "Three of us got an invoice email with an attachment. One person opened it.", 3, 3, 25 * MINUTE, "New"),
      make(1012, "Account manager", "Wi-Fi is slow in the meeting room.", 2, 1, 3 * HOUR, "New")
    ];
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var list = JSON.parse(raw);
        if (Array.isArray(list)) return list;
      }
    } catch (e) { /* storage blocked or corrupt: fall through to fake data */ }
    return null;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets)); } catch (e) { /* ignore */ }
  }

  var tickets = load();
  if (!tickets) {
    tickets = fakeData();
    save();
  }

  // Site-wide activity log (sitelog.js): ticket numbers and priorities only, never the ticket text.
  function slog(event, detail, level) { if (window.NorthlightLog) window.NorthlightLog.add("helpdesk", event, detail, { level: level || "info" }); }

  // ---------- rendering ----------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function sorted(now) {
    return tickets.slice().sort(function (a, b) {
      // Resolved tickets go to the bottom, then P1..P3, then earliest due first.
      var ra = a.status === "Resolved" ? 1 : 0;
      var rb = b.status === "Resolved" ? 1 : 0;
      if (ra !== rb) return ra - rb;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return dueAt(a) - dueAt(b);
    });
  }

  function renderTicket(t, now) {
    var overdue = isOverdue(t, now);
    var card = el("article", "ticket p" + t.priority +
      (t.status === "Resolved" ? " resolved" : "") + (overdue ? " overdue" : ""));

    var top = el("div", "ticket-top");
    top.appendChild(el("span", "pill p" + t.priority, TARGETS[t.priority].label));
    top.appendChild(el("span", "ticket-id", "#" + t.id));
    if (overdue) top.appendChild(el("span", "overdue-label", "Overdue"));
    top.appendChild(el("span", "ticket-who", t.requester));
    card.appendChild(top);

    card.appendChild(el("p", "", t.issue));

    var foot = el("div", "ticket-foot");
    var info = el("span", "", "Impact " + LEVELS[t.impact] + " · Urgency " + LEVELS[t.urgency] +
      " · Target " + TARGETS[t.priority].text);
    foot.appendChild(info);

    var due = el("span", "due");
    if (t.status === "Resolved") {
      due.textContent = "Resolved";
    } else if (overdue) {
      due.className = "due late";
      due.textContent = "Overdue by " + formatDuration(now - dueAt(t));
    } else {
      due.textContent = "Due in " + formatDuration(dueAt(t) - now);
    }
    foot.appendChild(due);

    var row = el("div", "status-row");
    var label = el("label", "", "Status");
    var select = el("select");
    select.id = "status-" + t.id;
    label.htmlFor = select.id;
    STATUSES.forEach(function (s) {
      var opt = el("option", "", s);
      opt.value = s;
      if (s === t.status) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", function () {
      t.status = select.value;
      save();
      slog("ticket.status", "Ticket #" + t.id + " moved to " + t.status);
      render();
    });
    row.appendChild(label);
    row.appendChild(select);
    foot.appendChild(row);

    card.appendChild(foot);
    return card;
  }

  function render() {
    var now = Date.now();
    var box = $("tickets");
    box.replaceChildren();

    if (!tickets.length) {
      box.appendChild(el("p", "empty", "No tickets."));
    }
    sorted(now).forEach(function (t) { box.appendChild(renderTicket(t, now)); });

    var open = tickets.filter(function (t) { return t.status !== "Resolved"; }).length;
    var late = tickets.filter(function (t) { return isOverdue(t, now); }).length;
    $("summary").textContent = tickets.length + " tickets · " + open + " open · " + late + " overdue";
  }

  // ---------- form ----------

  function updatePreview() {
    var p = priorityFor(Number($("impact").value), Number($("urgency").value));
    $("preview").textContent = "Priority " + TARGETS[p].label + ": response within " + TARGETS[p].text + ".";
  }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  $("impact").addEventListener("change", updatePreview);
  $("urgency").addEventListener("change", updatePreview);

  $("ticket-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var impact = Number($("impact").value);
    var urgency = Number($("urgency").value);
    var nextId = tickets.reduce(function (m, t) { return Math.max(m, t.id); }, 1000) + 1;
    tickets.push({
      id: nextId,
      requester: $("requester").value.trim(),
      issue: $("issue").value.trim(),
      impact: impact,
      urgency: urgency,
      priority: priorityFor(impact, urgency),
      status: "New",
      created: Date.now()
    });
    save();
    slog("ticket.created", "Ticket #" + nextId + " created on the help desk page (P" + priorityFor(impact, urgency) + ")", "ok");
    e.target.reset();
    updatePreview();
    render();
    toast("Ticket #" + nextId + " created");
  });

  $("reset").addEventListener("click", function () {
    tickets = fakeData();
    save();
    slog("reset", "Help desk demo data reset", "warn");
    render();
    toast("Demo data reset");
  });

  // Another tab (for example the website form or the automation rules) changed the tickets: show them right away.
  window.addEventListener("storage", function (e) {
    if (e.key !== STORAGE_KEY) return;
    var list = load();
    if (list) { tickets = list; render(); }
  });

  updatePreview();
  render();
  // Keep due times and Overdue labels current.
  setInterval(render, 30 * 1000);
})();
