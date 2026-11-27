"use strict";
// Run with:  node --test tools/
// The engine runs against a FAKE storage here, so nothing real is read or written.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const A = require("../../automation");

const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "rules.json"), "utf8"));

function fakeStorage(initial) {
  const m = new Map(Object.entries(initial || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    json: k => JSON.parse(m.get(k))
  };
}
function engine(storage, rules) {
  let t = 1_000_000;
  return A.createEngine({ storage, rules: rules || RULES, now: () => (t += 10) });
}
const NORMAL = { name: "Lena Marek", email: "lena@acme.example", topic: "Brand identity", message: "We would like a brand refresh.", urgency: 2 };
const URGENT = { ...NORMAL, message: "Our site is down and this is URGENT, please call." };

test("rules.json has the three expected rules, in order", () => {
  assert.deepStrictEqual(RULES.rules.map(r => r.id), ["R1", "R2", "R3"]);
  assert.ok(RULES.rules.every(r => r.trigger === "form.submitted"));
});

test("the built-in fallback is identical to rules.json", () => {
  assert.deepStrictEqual(A.FALLBACK_RULES, RULES);
});

test("normal message: lead + ticket, urgent rule skipped, empty outbox", async () => {
  const s = fakeStorage();
  const ctx = await engine(s).run("form.submitted", NORMAL);

  assert.strictEqual(s.json(A.KEYS.crm).leads.length, 1);
  assert.deepStrictEqual(
    { name: ctx.lead.name, company: ctx.lead.company, status: ctx.lead.status, value: ctx.lead.value, source: ctx.lead.source },
    { name: "Lena Marek", company: "Acme", status: "New", value: 8000, source: "Website" });
  const tickets = s.json(A.KEYS.helpdesk);
  assert.strictEqual(tickets.length, 1);
  assert.strictEqual(tickets[0].id, 1001);
  assert.strictEqual(tickets[0].priority, 3);            // impact 1 + urgency 2
  assert.strictEqual(tickets[0].email, "lena@acme.example");
  assert.deepStrictEqual(ctx.runs.map(r => r.rule + ":" + r.status), ["R1:ran", "R2:ran", "R3:skipped"]);
  assert.strictEqual(s.getItem(A.KEYS.outbox), null);
});

test("urgent message: ticket becomes P1 and an alert is queued (not sent)", async () => {
  const s = fakeStorage();
  const ctx = await engine(s).run("form.submitted", URGENT);

  const t = s.json(A.KEYS.helpdesk)[0];
  assert.strictEqual(t.priority, 1);
  assert.strictEqual(t.urgency, 3);
  assert.match(t.issue, /^\[URGENT\] /);
  assert.strictEqual(t.escalatedBy, "R3");
  const outbox = s.json(A.KEYS.outbox);
  assert.strictEqual(outbox.length, 1);
  assert.strictEqual(outbox[0].status, "Not sent (demo)");
  assert.strictEqual(outbox[0].subject, "URGENT website request #1001: Brand identity");
  assert.match(outbox[0].body, /Lena Marek wrote:/);
  assert.match(outbox[0].body, /Ticket #1001 is now P1/);
  assert.deepStrictEqual(ctx.runs.map(r => r.status), ["ran", "ran", "ran"]);
});

test("a log line is written for every rule that runs, plus the trigger line", async () => {
  const s = fakeStorage();
  await engine(s).run("form.submitted", URGENT);
  const lines = s.json(A.KEYS.log);
  assert.deepStrictEqual(lines.map(l => l.event), ["trigger", "rule.ran", "rule.ran", "rule.ran"]);
  assert.deepStrictEqual(lines.slice(1).map(l => l.rule), ["R1", "R2", "R3"]);
  assert.ok(lines.every(l => l.source === "automation" && l.t && l.id));
  assert.match(lines[1].detail, /Created CRM lead #10/);
  assert.match(lines[2].detail, /Created help desk ticket #1001/);
  assert.match(lines[3].detail, /Set ticket #1001 to P1/);
});

test("a skipped rule is logged as skipped", async () => {
  const s = fakeStorage();
  await engine(s).run("form.submitted", NORMAL);
  const r3 = s.json(A.KEYS.log).find(l => l.rule === "R3");
  assert.strictEqual(r3.event, "rule.skipped");
  assert.strictEqual(r3.level, "info");
});

test("the word 'urgent' is matched as a whole word, ignoring capitals", async () => {
  const cases = [
    ["URGENT!", true], ["This is Urgent.", true], ["urgent", true],
    ["urgently needed", false], ["resurgent growth", false], ["nothing special", false]
  ];
  for (const [message, expected] of cases) {
    const s = fakeStorage();
    const ctx = await engine(s).run("form.submitted", { ...NORMAL, message });
    assert.strictEqual(ctx.runs.find(r => r.rule === "R3").status === "ran", expected, message);
  }
});

test("existing CRM and help desk data is kept and ids keep counting up", async () => {
  const s = fakeStorage({
    [A.KEYS.crm]: { nextId: 15, leads: [{ id: 3, name: "Old Lead" }], accounts: [{ id: 5 }], contacts: [], opps: [], cases: [{ id: 4 }] },
    [A.KEYS.helpdesk]: [{ id: 1012, priority: 3, status: "New" }],
    [A.KEYS.log]: [{ id: "x", t: 1, source: "site", event: "page.view", level: "info", detail: "Opened index.html" }]
  });
  const ctx = await engine(s).run("form.submitted", NORMAL);
  const crm = s.json(A.KEYS.crm);
  assert.strictEqual(ctx.lead.id, 15);
  assert.strictEqual(crm.nextId, 16);
  assert.deepStrictEqual(crm.leads.map(l => l.id), [15, 3]);
  assert.strictEqual(crm.accounts.length, 1);
  assert.strictEqual(crm.cases.length, 1);
  assert.strictEqual(ctx.ticket.id, 1013);
  assert.strictEqual(s.json(A.KEYS.helpdesk).length, 2);
  assert.strictEqual(s.json(A.KEYS.log)[0].id, "x");
});

test("company name comes from the email domain; free mail becomes a private enquiry", async () => {
  const a = await engine(fakeStorage()).run("form.submitted", { ...NORMAL, email: "x@brewery.cz" });
  assert.strictEqual(a.lead.company, "Brewery");
  const b = await engine(fakeStorage()).run("form.submitted", { ...NORMAL, email: "x@gmail.com" });
  assert.strictEqual(b.lead.company, "Private enquiry (Lena Marek)");
});

test("a failing rule is logged as failed and the other rules still run", async () => {
  const s = fakeStorage();
  const rules = [
    { id: "A", name: "needs a ticket first", trigger: "form.submitted", actions: [{ type: "ticket.setPriority", priority: 1 }] },
    RULES.rules[0]
  ];
  const ctx = await engine(s, rules).run("form.submitted", NORMAL);
  assert.deepStrictEqual(ctx.runs.map(r => r.status), ["failed", "ran"]);
  assert.strictEqual(ctx.errors.length, 1);
  const lines = s.json(A.KEYS.log);
  assert.strictEqual(lines.find(l => l.rule === "A").event, "rule.failed");
  assert.strictEqual(lines.find(l => l.rule === "A").level, "error");
  assert.strictEqual(s.json(A.KEYS.crm).leads.length, 1);
});

test("an unknown action fails that rule only", async () => {
  const s = fakeStorage();
  const rules = [{ id: "Z", name: "bad", trigger: "form.submitted", actions: [{ type: "email.sendForReal" }] }];
  const ctx = await engine(s, rules).run("form.submitted", NORMAL);
  assert.strictEqual(ctx.runs[0].status, "failed");
  assert.match(ctx.runs[0].detail, /unknown action/);
});

test("disabled rules and rules for other triggers are not run or logged", async () => {
  const s = fakeStorage();
  const rules = [
    { ...RULES.rules[0], enabled: false },
    { ...RULES.rules[1], trigger: "something.else" },
    RULES.rules[1]
  ];
  const ctx = await engine(s, rules).run("form.submitted", NORMAL);
  assert.deepStrictEqual(ctx.runs.map(r => r.rule), ["R2"]);
  assert.strictEqual(s.getItem(A.KEYS.crm), null);
});

test("blocked storage: run still resolves, every rule is reported as failed", async () => {
  const broken = { getItem: () => { throw new Error("storage blocked"); }, setItem: () => { throw new Error("storage blocked"); } };
  const ctx = await engine(broken).run("form.submitted", NORMAL);
  assert.strictEqual(ctx.ticket, null);
  assert.ok(ctx.errors.length >= 2);
});

test("the log keeps at most 1000 lines (oldest dropped)", async () => {
  const filler = Array.from({ length: 999 }, (_, i) => ({ id: "f" + i, t: i, source: "site", event: "page.view", level: "info", detail: "x" }));
  const s = fakeStorage({ [A.KEYS.log]: filler });
  await engine(s).run("form.submitted", NORMAL);          // adds 4 lines
  const lines = s.json(A.KEYS.log);
  assert.strictEqual(lines.length, 1000);
  assert.strictEqual(lines[0].id, "f3");
  assert.strictEqual(lines[lines.length - 1].rule, "R3");
});

test("getOutbox and getLog only return what the engine wrote", async () => {
  const s = fakeStorage({ [A.KEYS.log]: [{ id: "p", t: 1, source: "site", event: "page.view", level: "info", detail: "x" }] });
  const e = engine(s);
  await e.run("form.submitted", URGENT);
  assert.strictEqual(e.getOutbox().length, 1);
  assert.ok(e.getLog().every(l => l.source === "automation"));
  assert.strictEqual(e.getLog().length, 4);
});
