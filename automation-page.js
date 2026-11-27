(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function when(ms) { return new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }

  // ---- rules ----
  function conditionText(c) {
    if (!c) return "always";
    if (Array.isArray(c)) return c.map(conditionText).join(" and ");
    if (c.containsWord) return "the " + c.field + ' contains the word "' + c.containsWord + '"';
    if (c.contains) return "the " + c.field + ' contains "' + c.contains + '"';
    if (Object.prototype.hasOwnProperty.call(c, "equals")) return "the " + c.field + ' is "' + c.equals + '"';
    return "(unknown condition)";
  }
  function actionText(a) {
    if (a.type === "crm.createLead") return "Create a lead in the CRM";
    if (a.type === "helpdesk.createTicket") return "Create a ticket in the help desk";
    if (a.type === "ticket.setPriority") return "Set that ticket to P" + a.priority;
    if (a.type === "outbox.add") return "Add " + (a.channel || "email") + " alert to the outbox (to " + a.to + ")";
    return a.type;
  }
  function renderRules() {
    window.Automation.getRules().then(function (loaded) {
      $("rules-from").textContent = loaded.rules.length + " rules, loaded from " + loaded.from + ". Rules for the same trigger run in order.";
      var box = $("rules"); box.replaceChildren();
      loaded.rules.forEach(function (r) {
        var card = el("div", "rule");
        var h = el("h3"); h.appendChild(el("span", "rid", r.id)); h.appendChild(document.createTextNode(r.name));
        card.appendChild(h);
        var dl = el("dl");
        dl.appendChild(el("dt", "", "Trigger")); var d1 = el("dd"); d1.appendChild(el("code", "", r.trigger)); dl.appendChild(d1);
        dl.appendChild(el("dt", "", "When")); dl.appendChild(el("dd", "", conditionText(r.when)));
        dl.appendChild(el("dt", "", "Then"));
        var d3 = el("dd"); var ol = el("ol");
        (r.actions || []).forEach(function (a) { ol.appendChild(el("li", "", actionText(a))); });
        d3.appendChild(ol); dl.appendChild(d3);
        card.appendChild(dl); box.appendChild(card);
      });
    });
  }

  // ---- outbox + log ----
  var seen = {};
  function renderOutbox() {
    var box = $("outbox"); box.replaceChildren();
    var items = window.Automation.getOutbox().slice().reverse();
    if (!items.length) { box.appendChild(el("p", "empty", "The outbox is empty. Send an urgent message to see an alert appear.")); return; }
    items.slice(0, 50).forEach(function (m) {
      var d = el("details", "mail");
      var s = el("summary");
      s.appendChild(el("span", "sub", m.subject));
      var line = el("span", "meta", when(m.t) + " · to " + m.to + " · from rule " + m.rule + " · ");
      line.appendChild(el("span", "badge b-queue", m.status));
      s.appendChild(line);
      d.appendChild(s);
      d.appendChild(el("div", "body", m.body));
      box.appendChild(d);
    });
  }
  function renderLog(announce) {
    var list = $("log"); list.replaceChildren();
    var lines = window.Automation.getLog().slice().reverse();
    if (!lines.length) { var li = el("li"); li.appendChild(el("span", "empty", "No rules have run yet.")); list.appendChild(li); return; }
    lines.slice(0, 100).forEach(function (l) {
      var li = el("li", announce && !seen[l.id] ? "new" : "");
      li.appendChild(el("time", "", when(l.t)));
      var cls = l.event === "rule.failed" ? "b-fail" : l.event === "rule.skipped" ? "b-skip" : l.event === "rule.ran" ? "b-ok" : "b-skip";
      var word = l.event === "rule.failed" ? "failed" : l.event === "rule.skipped" ? "skipped" : l.event === "rule.ran" ? "ran" : "event";
      li.appendChild(el("span", "badge " + cls, (l.rule ? l.rule + " " : "") + word));
      li.appendChild(el("span", "d", l.detail));
      list.appendChild(li);
      seen[l.id] = true;
    });
  }
  function refresh(announce) { renderOutbox(); renderLog(announce); }

  // ---- try it ----
  var NORMAL = { name: "Alex Brandt", email: "alex@brandt.example", topic: "Brand identity", message: "We would like a new logo and brand guidelines for our launch in spring." };
  var URGENT = { name: "Dana Kral", email: "dana@kral.example", topic: "Website or design system", message: "Our website is down and this is urgent. Please call us back today." };
  function fill(s) { $("t-name").value = s.name; $("t-email").value = s.email; $("t-topic").value = s.topic; $("t-message").value = s.message; $("t-err").hidden = true; }
  $("fill-normal").onclick = function () { fill(NORMAL); };
  $("fill-urgent").onclick = function () { fill(URGENT); };

  $("try").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("t-name").value.trim(), email = $("t-email").value.trim(), message = $("t-message").value.trim();
    var err = $("t-err"), problem = "";
    if (!name) problem = "Please enter a name.";
    else if (!window.NorthlightSecurity || window.NorthlightSecurity.emailProblem(email)) problem = "Please enter an email like name@company.com.";
    else if (message.length < 5) problem = "Please write a short message (at least 5 characters).";
    ["t-name", "t-email", "t-message"].forEach(function (id) { $(id).removeAttribute("aria-invalid"); });
    if (problem) { err.textContent = problem; err.hidden = false; $(!name ? "t-name" : !/^[^\s@]+@/.test(email) ? "t-email" : "t-message").setAttribute("aria-invalid", "true"); return; }
    err.hidden = true;
    window.Automation.run("form.submitted", { name: name, email: email, topic: $("t-topic").value, message: message, urgency: Number($("t-urgency").value) || 2 }).then(function (ctx) {
      var box = $("result"); box.hidden = false; box.replaceChildren();
      box.appendChild(el("strong", "", "The rules ran (" + ctx.runs.length + "):"));
      var ul = el("ul");
      ctx.runs.forEach(function (r) { ul.appendChild(el("li", "", r.rule + " " + r.status + ": " + r.detail)); });
      box.appendChild(ul);
      if (ctx.ticket) {
        var p = el("p", "meta", "Ticket #" + ctx.ticket.id + " is P" + ctx.ticket.priority + ". ");
        var a = el("a", "", "Open the help desk"); a.href = "helpdesk.html"; p.appendChild(a);
        box.appendChild(p);
      }
      refresh(true);
    });
  });

  // live: other tabs (the website form) add to the outbox and log
  window.addEventListener("storage", function (e) {
    if (e.key === window.Automation.KEYS.outbox || e.key === window.Automation.KEYS.log) refresh(true);
  });

  renderRules();
  refresh(false);
})();
