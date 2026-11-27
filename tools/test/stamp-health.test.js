"use strict";
// Run with:  node --test tools/   (works on temporary copies; the real health.json is only read)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const H = require("../stamp-health");

const SCRIPT = path.join(__dirname, "..", "stamp-health.js");
const REAL = path.join(__dirname, "..", "..", "health.json");

function tmp(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "health-"));
  const file = path.join(dir, "health.json");
  fs.writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
  return { dir, file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const run = (args, env) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

test("the real health.json is valid", () => {
  assert.deepStrictEqual(H.validateHealth(JSON.parse(fs.readFileSync(REAL, "utf8"))), []);
});

test("validation: name, version and build date", () => {
  const ok = { name: "Northlight Studio", version: "1.2.3", buildDate: "2026-11-27" };
  assert.deepStrictEqual(H.validateHealth(ok), []);
  assert.deepStrictEqual(H.validateHealth({ ...ok, version: "1.2.3-beta.1" }), []);
  assert.match(H.validateHealth({ ...ok, name: "" })[0], /name/);
  assert.match(H.validateHealth({ ...ok, version: "v1" })[0], /version/);
  assert.match(H.validateHealth({ ...ok, buildDate: "2026-02-30" })[0], /buildDate/);
  assert.match(H.validateHealth({ ...ok, buildDate: "27.11.2026" })[0], /buildDate/);
  const none = H.validateHealth({});
  assert.strictEqual(none.length, 3);
  assert.ok(H.validateHealth(null).length && H.validateHealth([]).length);
});

test("dates: leap days and impossible days", () => {
  assert.ok(H.validDate("2028-02-29"));
  assert.ok(!H.validDate("2027-02-29"));
  assert.ok(!H.validDate("2026-13-01"));
  assert.ok(!H.validDate(20261127));
});

test("CLI without --stamp only reads: exit 0 and the file is unchanged", () => {
  const t = tmp({ name: "N", version: "1.0.0", buildDate: "2020-01-01" });
  const before = fs.readFileSync(t.file, "utf8");
  const r = run([t.file]);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(fs.readFileSync(t.file, "utf8"), before);
  t.cleanup();
});

test("CLI --stamp sets buildDate and keeps everything else", () => {
  const t = tmp({ name: "Northlight Studio", version: "1.4.0", buildDate: "2020-01-01" });
  const r = run(["--stamp", t.file], { BUILD_DATE: "2031-05-09" });
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(t.file, "utf8")), { name: "Northlight Studio", version: "1.4.0", buildDate: "2031-05-09" });
  t.cleanup();
});

test("CLI --stamp uses today's UTC date by default", () => {
  const t = tmp({ name: "N", version: "1.0.0", buildDate: "2020-01-01" });
  run(["--stamp", t.file], { BUILD_DATE: "" });
  assert.strictEqual(JSON.parse(fs.readFileSync(t.file, "utf8")).buildDate, new Date().toISOString().slice(0, 10));
  t.cleanup();
});

test("CLI: an invalid file exits 1 and is not touched, even with --stamp", () => {
  const t = tmp({ name: "N", version: "banana", buildDate: "2020-01-01" });
  const before = fs.readFileSync(t.file, "utf8");
  const r = run(["--stamp", t.file], { BUILD_DATE: "2031-05-09" });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /FAIL.*version/);
  assert.strictEqual(fs.readFileSync(t.file, "utf8"), before);
  t.cleanup();
});

test("CLI: unreadable JSON or a missing file exits 2", () => {
  const t = tmp("{ nope");
  assert.strictEqual(run([t.file]).status, 2);
  t.cleanup();
  assert.strictEqual(run([path.join(os.tmpdir(), "missing-" + Date.now() + ".json")]).status, 2);
});

test("CLI --stamp refuses a bad BUILD_DATE", () => {
  const t = tmp({ name: "N", version: "1.0.0", buildDate: "2020-01-01" });
  const r = run(["--stamp", t.file], { BUILD_DATE: "not-a-date" });
  assert.strictEqual(r.status, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(t.file, "utf8")).buildDate, "2020-01-01");
  t.cleanup();
});
