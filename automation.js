/*
 * Automation engine. Nothing here sends anything: alerts only go to a local "outbox" list.
 *
 *   Automation.run("form.submitted", { name, email, topic, message, urgency })
 *
 * loads the rules (rules.json), runs every rule whose trigger matches, and writes one log line
 * per rule: ran, skipped (condition not met) or failed. It works on the same localStorage the
 * CRM (northlight-crm-v1) and help desk (northlight-helpdesk-v2) pages read.
 * The engine has no DOM code, so it can be tested in Node with a fake storage.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Automation = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  var KEYS = {
    crm: "northlight-crm-v1",
    helpdesk: "northlight-helpdesk-v2",
    outbox: "northlight-outbox-v1",
    log: "northlight-logs-v1"
  };
  var MAX_LOG = 1000, MAX_OUTBOX = 200;
  var FREE_MAIL = ["gmail", "outlook", "hotmail", "yahoo", "icloud", "seznam", "proton", "protonmail", "live", "aol"];

  // Used only if rules.json cannot be loaded (for example when a page is opened as a file).
  // A test checks that this stays identical to rules.json.
  var FALLBACK_RULES = {
    version: 1,
    note: "Automation rules. Rules for the same trigger run in order. Nothing is really sent: alerts only go to the outbox list.",
    rules: [
      {
        id: "R1", name: "Create a CRM lead from the website form", trigger: "form.submitted", when: null,
        actions: [{
          type: "crm.createLead", source: "Website",
          valueByTopic: { "Brand identity": 8000, "Product & app design": 15000, "Website or design system": 12000, "Something else": 3000 }
        }]
      },
      {
        id: "R2", name: "Create a help desk ticket from the website form", trigger: "form.submitted", when: null,
        actions: [{ type: "helpdesk.createTicket" }]
      },
      {
        id: "R3", name: "Urgent message: make the ticket P1 and alert the on-call team", trigger: "form.submitted",
        when: { field: "message", containsWord: "urgent" },
        actions: [
          { type: "ticket.setPriority", priority: 1 },
          {
            type: "outbox.add", channel: "email", to: "oncall@northlight.example",
            subject: "URGENT website request #{ticket.id}: {data.topic}",
            body: "{data.name} wrote: {data.message}\nTicket #{ticket.id} is now P1. Reply to {data.email}."
          }
        ]
      }
    ]
  };

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // {data.name} / {ticket.id} placeholders
  function fill(str, ctx) {
    return String(str).replace(/\{([\w.]+)\}/g, function (_, path) {
      var v = path.split(".").reduce(function (o, k) { return o == null ? undefined : o[k]; }, ctx);
      return v == null ? "" : String(v);
    });
  }

  // when: null (always) | {field, containsWord|contains|equals} | [conditions that must all be true]
  function test(cond, ctx) {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every(function (c) { return test(c, ctx); });
    var v = String((ctx.data || {})[cond.field] == null ? "" : ctx.data[cond.field]);
    if (cond.containsWord) return new RegExp("\\b" + escapeRe(cond.containsWord) + "\\b", "i").test(v);
    if (cond.contains) return v.toLowerCase().indexOf(String(cond.contains).toLowerCase()) >= 0;
    if (Object.prototype.hasOwnProperty.call(cond, "equals")) return v.toLowerCase() === String(cond.equals).toLowerCase();
    return false;
  }

  function priorityFor(impact, urgency) {
    var score = impact + urgency;
    return score >= 5 ? 1 : score === 4 ? 2 : 3;
  }

  function companyFromEmail(email, name) {
    var domain = String(email || "").split("@")[1] || "";
    var label = domain.split(".")[0] || "";
    if (!label || FREE_MAIL.indexOf(label.toLowerCase()) >= 0) return "Private enquiry (" + name + ")";
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function createEngine(opts) {
    opts = opts || {};
    var storage = opts.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    var now = opts.now || Date.now;
    var seq = 0;

    function readJson(key, fallback) {
      var raw = storage.getItem(key);
      if (!raw) return fallback;
      try { var v = JSON.parse(raw); return v == null ? fallback : v; } catch (e) { return fallback; }
    }
    function writeJson(key, value) { storage.setItem(key, JSON.stringify(value)); }

    // Same entry format as sitelog.js, so the logs site shows these lines too.
    function log(entry) {
      try {
        var list = readJson(KEYS.log, []);
        if (!Array.isArray(list)) list = [];
        entry.id = now().toString(36) + "a" + (seq++).toString(36);
        entry.t = now();
        entry.source = "automation";
        entry.page = entry.page || (typeof location !== "undefined" ? (location.pathname.split("/").pop() || "index.html") : "index.html");
        list.push(entry);
        writeJson(KEYS.log, list.slice(-MAX_LOG));
      } catch (e) { /* a log problem must never stop the rules */ }
    }

    // ----- actions: each returns a short sentence describing what it did -----
    var ACTIONS = {
      "crm.createLead": function (ctx, a) {
        var db = readJson(KEYS.crm, null);
        if (!db || typeof db !== "object" || Array.isArray(db)) db = {};
        ["leads", "accounts", "contacts", "opps", "cases"].forEach(function (k) { if (!Array.isArray(db[k])) db[k] = []; });
        if (typeof db.nextId !== "number") db.nextId = 10;
        var topicValue = (a.valueByTopic || {})[ctx.data.topic];
        var lead = {
          id: db.nextId++,
          name: ctx.data.name,
          company: companyFromEmail(ctx.data.email, ctx.data.name),
          email: ctx.data.email,
          source: a.source || "Website",
          value: typeof topicValue === "number" ? topicValue : 0,
          status: "New",
          created: now()
        };
        db.leads.unshift(lead);
        writeJson(KEYS.crm, db);
        ctx.lead = lead;
        return "Created CRM lead #" + lead.id + " (" + lead.company + ", est. EUR " + lead.value + ")";
      },

      "helpdesk.createTicket": function (ctx) {
        var list = readJson(KEYS.helpdesk, []);
        if (!Array.isArray(list)) list = [];
        var id = list.reduce(function (m, t) { return Math.max(m, Number(t && t.id) || 0); }, 1000) + 1;
        var impact = 1; // one person asking
        var urgency = Number(ctx.data.urgency) || 2;
        var ticket = {
          id: id,
          requester: ctx.data.name,
          issue: "[Website: " + ctx.data.topic + "] " + ctx.data.message + "\nReply to: " + ctx.data.email,
          impact: impact,
          urgency: urgency,
          priority: priorityFor(impact, urgency),
          status: "New",
          created: now(),
          source: "website",
          email: ctx.data.email // lets the customer follow it on track.html
        };
        list.push(ticket);
        writeJson(KEYS.helpdesk, list);
        ctx.ticket = ticket;
        return "Created help desk ticket #" + id + " (P" + ticket.priority + ")";
      },

      "ticket.setPriority": function (ctx, a) {
        if (!ctx.ticket) throw new Error("no ticket exists in this run (a rule that creates one must come first)");
        var list = readJson(KEYS.helpdesk, []);
        var t = list.filter(function (x) { return x.id === ctx.ticket.id; })[0];
        if (!t) throw new Error("ticket #" + ctx.ticket.id + " was not found in the help desk");
        var p = Number(a.priority);
        if (!(p >= 1 && p <= 3)) throw new Error("priority must be 1, 2 or 3");
        t.priority = p;
        if (p === 1) {
          t.urgency = 3;
          if (t.issue.indexOf("[URGENT]") !== 0) t.issue = "[URGENT] " + t.issue;
        }
        t.escalatedBy = ctx.ruleId;
        writeJson(KEYS.helpdesk, list);
        ctx.ticket = t;
        return "Set ticket #" + t.id + " to P" + p;
      },

      "outbox.add": function (ctx, a) {
        var list = readJson(KEYS.outbox, []);
        if (!Array.isArray(list)) list = [];
        var item = {
          id: now().toString(36) + "o" + (seq++).toString(36),
          t: now(),
          channel: a.channel || "email",
          to: a.to,
          subject: fill(a.subject, ctx),
          body: fill(a.body, ctx),
          status: "Not sent (demo)",
          rule: ctx.ruleId
        };
        list.push(item);
        writeJson(KEYS.outbox, list.slice(-MAX_OUTBOX));
        ctx.outbox.push(item);
        return 'Added alert to the outbox: "' + item.subject + '" (not sent)';
      }
    };

    async function loadRules() {
      if (opts.rules) return { rules: opts.rules.rules || opts.rules, from: "supplied rules" };
      try {
        var res = await fetch("rules.json", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        var json = await res.json();
        if (!json || !Array.isArray(json.rules)) throw new Error("rules.json has no rules list");
        return { rules: json.rules, from: "rules.json" };
      } catch (e) {
        return { rules: FALLBACK_RULES.rules, from: "built-in copy (could not load rules.json: " + (e.message || "error") + ")" };
      }
    }

    // Runs every rule for an event, in order. Always resolves; failures are in ctx.errors and the log.
    async function run(eventName, data) {
      var ctx = { event: eventName, data: data || {}, lead: null, ticket: null, outbox: [], runs: [], errors: [], rulesFrom: "" };
      var loaded = await loadRules();
      ctx.rulesFrom = loaded.from;
      var rules = loaded.rules.filter(function (r) { return r && r.enabled !== false && r.trigger === eventName; });

      log({
        event: "trigger", level: "info",
        detail: eventName + " received: " + rules.length + " rule(s) to check (rules from " + loaded.from + ")"
      });

      rules.forEach(function (rule) {
        ctx.ruleId = rule.id;
        var base = { rule: rule.id, ruleName: rule.name };
        try {
          if (!test(rule.when, ctx)) {
            var skipped = "Condition not met, nothing done";
            log(Object.assign({ event: "rule.skipped", level: "info", detail: rule.id + " " + rule.name + ": " + skipped }, base));
            ctx.runs.push({ rule: rule.id, name: rule.name, status: "skipped", detail: skipped });
            return;
          }
          var done = [];
          (rule.actions || []).forEach(function (action) {
            var fn = ACTIONS[action.type];
            if (!fn) throw new Error("unknown action \"" + action.type + "\"");
            done.push(fn(ctx, action));
          });
          var summary = done.join(". ");
          log(Object.assign({ event: "rule.ran", level: "ok", detail: rule.id + " " + rule.name + ": " + summary }, base));
          ctx.runs.push({ rule: rule.id, name: rule.name, status: "ran", detail: summary });
        } catch (e) {
          var msg = e && e.message ? e.message : String(e);
          log(Object.assign({ event: "rule.failed", level: "error", detail: rule.id + " " + rule.name + " failed: " + msg }, base));
          ctx.runs.push({ rule: rule.id, name: rule.name, status: "failed", detail: msg });
          ctx.errors.push({ rule: rule.id, message: msg });
        }
      });
      return ctx;
    }

    return {
      run: run,
      getRules: async function () { return loadRules(); },
      getOutbox: function () { var l = readJson(KEYS.outbox, []); return Array.isArray(l) ? l : []; },
      getLog: function () { var l = readJson(KEYS.log, []); return (Array.isArray(l) ? l : []).filter(function (e) { return e.source === "automation"; }); }
    };
  }

  var defaultEngine = null;
  function engine() { return defaultEngine || (defaultEngine = createEngine()); }

  return {
    KEYS: KEYS,
    FALLBACK_RULES: FALLBACK_RULES,
    createEngine: createEngine,
    run: function (e, d) { return engine().run(e, d); },
    getRules: function () { return engine().getRules(); },
    getOutbox: function () { return engine().getOutbox(); },
    getLog: function () { return engine().getLog(); }
  };
});
