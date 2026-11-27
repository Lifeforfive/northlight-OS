"use strict";
// Run with:  node --test tools/   (fake storage and a fake clock: nothing real is touched)
const test = require("node:test");
const assert = require("node:assert");
const S = require("../../security");

function fakeStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), raw: () => m };
}
function throttle(extra) {
  const clock = { t: 1_000_000 };
  const storage = fakeStorage();
  const th = S.createThrottle({ storage, now: () => clock.t, ...(extra || {}) });
  return { th, clock, storage };
}

// ---------- email ----------

test("email: normal addresses are accepted", () => {
  for (const ok of ["lena@acme.example", "o.sikora+news@sub.studio.co.uk", "a_b-c@x1.io", "UPPER@CASE.COM", "x@y.zz"]) {
    assert.strictEqual(S.emailProblem(ok), "", ok);
  }
});

test("email: attack strings and malformed addresses are refused", () => {
  const bad = [
    "a<img/src=x/onerror=window.__xss=1>@evil.co", "x@y.co<script>", '"><svg/onload=1>@z.co', "a b@c.co", "a@b", "a@b.c", "@b.co", "a@.co",
    "a..b@c.co", ".a@b.co", "a.@b.co", "a@b..co", "a@-b.co", "a@b-.co", "javascript:alert(1)", "a@b.co\nBcc: x@y.co", "", "   ", "a@@b.co", "a@b.c0m"
  ];
  for (const v of bad) assert.notStrictEqual(S.emailProblem(v), "", JSON.stringify(v));
});

test("email: too long is refused, an empty value gets its own message", () => {
  assert.notStrictEqual(S.emailProblem("a".repeat(65) + "@b.co"), "");
  assert.notStrictEqual(S.emailProblem("a@" + "b".repeat(130) + ".co"), "");
  assert.match(S.emailProblem(""), /enter your email/);
  assert.match(S.emailProblem("nope"), /does not look right/);
});

test("email: hostile input does not make the check slow", () => {
  const t = Date.now();
  S.emailProblem("a@" + ".".repeat(20000) + "!");
  S.emailProblem("a".repeat(50000) + "@");
  S.emailProblem("a@" + "b-".repeat(10000) + "c");
  assert.ok(Date.now() - t < 200, "took " + (Date.now() - t) + " ms");
});

// ---------- passwords ----------

test("password: short passwords are refused with the length shown", () => {
  assert.match(S.passwordProblems("Short1!")[0], /at least 12 characters \(you have 7\)/);
});

test("password: common passwords and simple variations are refused", () => {
  for (const pw of ["password1234", "Password123456", "qwertyuiop12", "iloveyou2026", "P@ssw0rd!!!!!", "123456789012", "northlight2026", "letmein123456"]) {
    assert.ok(S.passwordProblems(pw).length > 0, pw);
  }
});

test("password: repeated characters, sequences and the username are refused", () => {
  assert.match(S.passwordProblems("aaaaaaaaaaaaaa").join(" "), /repeats/);
  assert.match(S.passwordProblems("abababababab").join(" "), /repeats/);
  assert.match(S.passwordProblems("abcdefghijkl").join(" "), /sequence/);
  assert.match(S.passwordProblems("987654321098").join(" ") + S.passwordProblems("zyxwvutsrqpo").join(" "), /sequence/);
  assert.match(S.passwordProblems("my-sec-auditor-key", "sec-auditor").join(" "), /username/);
});

test("password: a long random-looking passphrase is accepted", () => {
  for (const pw of ["correct horse battery staple", "tangerine-glacier-flute-47", "Xk9#vQ2!mLw8$Rt4"]) assert.deepStrictEqual(S.passwordProblems(pw, "ada"), [], pw);
});

test("password: absurdly long passwords are refused (hashing them would be slow)", () => {
  assert.match(S.passwordProblems("x1Y".repeat(60)).join(" "), /at most 128/);
});

// ---------- throttle ----------

test("throttle: the first 5 failures are free, the 6th locks for 30 seconds", () => {
  const { th, clock } = throttle();
  for (let i = 1; i <= 5; i++) { assert.strictEqual(th.check("pw:ada").allowed, true); assert.strictEqual(th.fail("pw:ada").allowed, true, "failure " + i); }
  const r = th.fail("pw:ada");
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.waitMs, 30000);
  assert.strictEqual(th.check("pw:ada").allowed, false);
  clock.t += 29000; assert.strictEqual(th.check("pw:ada").allowed, false);
  clock.t += 1500; assert.strictEqual(th.check("pw:ada").allowed, true);
});

test("throttle: each further failure doubles the lock, up to the maximum", () => {
  const { th, clock } = throttle();
  for (let i = 0; i < 5; i++) th.fail("u");
  const waits = [];
  for (let i = 0; i < 8; i++) { const r = th.fail("u"); waits.push(r.waitMs); clock.t += r.waitMs + 1; }
  assert.deepStrictEqual(waits.slice(0, 5), [30000, 60000, 120000, 240000, 480000]);
  assert.ok(waits.slice(5).every(w => w === 900000), "capped at 15 minutes: " + waits.join(","));
});

test("throttle: a success clears the failures", () => {
  const { th } = throttle();
  for (let i = 0; i < 4; i++) th.fail("u");
  th.success("u");
  for (let i = 0; i < 5; i++) assert.strictEqual(th.fail("u").allowed, true);   // counting starts over
});

test("throttle: failures are forgotten after 15 quiet minutes", () => {
  const { th, clock } = throttle();
  for (let i = 0; i < 5; i++) th.fail("u");
  clock.t += 16 * 60 * 1000;
  assert.strictEqual(th.fail("u").allowed, true);
  assert.strictEqual(th.check("u").allowed, true);
});

test("throttle: subjects are independent, and unknown names are throttled like real ones", () => {
  const { th } = throttle();
  for (let i = 0; i < 6; i++) th.fail("pw:nobody-here");
  assert.strictEqual(th.check("pw:nobody-here").allowed, false);
  assert.strictEqual(th.check("pw:ada").allowed, true);
});

test("throttle: the lock survives a reload (same storage, new instance)", () => {
  const clock = { t: 5_000_000 }, storage = fakeStorage();
  const a = S.createThrottle({ storage, now: () => clock.t });
  for (let i = 0; i < 6; i++) a.fail("u");
  const b = S.createThrottle({ storage, now: () => clock.t });
  assert.strictEqual(b.check("u").allowed, false);
});

test("throttle: stricter thresholds can be configured, corrupt storage is tolerated", () => {
  const { th } = throttle({ freeAttempts: 2 });
  th.fail("u"); th.fail("u");
  assert.strictEqual(th.fail("u").allowed, false);
  const broken = S.createThrottle({ storage: fakeStorage({ "northlight-throttle-v1": "{not json" }) });
  assert.strictEqual(broken.check("u").allowed, true);
  assert.doesNotThrow(() => broken.fail("u"));
  const weird = S.createThrottle({ storage: fakeStorage({ "northlight-throttle-v1": JSON.stringify({ u: "x", __proto__: { n: 9 } }) }) });
  assert.strictEqual(weird.check("u").allowed, true);
});

test("throttle: old entries are pruned so the stored data stays small", () => {
  const { th, clock, storage } = throttle();
  for (let i = 0; i < 50; i++) th.fail("user" + i);
  clock.t += 20 * 60 * 1000;
  th.fail("fresh");
  assert.deepStrictEqual(Object.keys(JSON.parse(storage.raw().get("northlight-throttle-v1"))), ["fresh"]);
});

test("formatWait gives friendly text", () => {
  assert.strictEqual(S.formatWait(1000), "1 second");
  assert.strictEqual(S.formatWait(30000), "30 seconds");
  assert.strictEqual(S.formatWait(61000), "2 minutes");
  assert.strictEqual(S.formatWait(900000), "15 minutes");
});
