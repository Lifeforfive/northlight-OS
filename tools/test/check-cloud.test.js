"use strict";
// Run with:  node --test tools/
// Uses temporary copies of the cloud file; the real northlight.cloud.json is only read.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const C = require("../check-cloud");

const REAL = path.join(__dirname, "..", "..", "northlight.cloud.json");
const SCRIPT = path.join(__dirname, "..", "check-cloud.js");
const good = () => JSON.parse(fs.readFileSync(REAL, "utf8"));
const RG = 0, APP = 1, ST = 2;

const failures = checks => checks.filter(c => !c.pass);
const failMsgs = checks => failures(checks).map(c => c.scope + " | " + c.check + " | " + c.message);
function expectFail(doc, scope, check, pattern) {
  const f = failures(C.validate(doc));
  assert.ok(f.some(c => c.scope === scope && c.check === check && pattern.test(c.message)),
    "expected a failure for " + scope + "/" + check + " matching " + pattern + ", got:\n" + failMsgs(C.validate(doc)).join("\n"));
}

test("the real northlight.cloud.json passes every check", () => {
  const checks = C.validate(good());
  assert.deepStrictEqual(failures(checks), []);
  assert.strictEqual(checks.length, 10);
});

// ---------- tags ----------

test("a missing tag fails, once per missing tag", () => {
  for (const tag of C.REQUIRED_TAGS) {
    const d = good(); delete d.resources[APP].tags[tag];
    expectFail(d, "app-northlight-prod", "tags", new RegExp('missing tag "' + tag + '"'));
  }
});

test("a mistyped tag name counts as missing", () => {
  const d = good(); d.resources[ST].tags.costcenter = d.resources[ST].tags["cost-center"]; delete d.resources[ST].tags["cost-center"];
  expectFail(d, "stnorthlightprod", "tags", /missing tag "cost-center"/);
});

test("an empty or padded tag value fails", () => {
  let d = good(); d.resources[RG].tags.owner = "   ";
  expectFail(d, "rg-northlight-prod", "tags", /tag "owner" is empty/);
  d = good(); d.resources[RG].tags.owner = " design-ops@northlight.example";
  expectFail(d, "rg-northlight-prod", "tags", /spaces around/);
});

test("no tags object at all fails", () => {
  const d = good(); delete d.resources[APP].tags;
  expectFail(d, "app-northlight-prod", "tags", /no "tags" object/);
});

test("bad env, cost-center and owner values fail", () => {
  let d = good(); d.resources[APP].tags.env = "staging";
  expectFail(d, "app-northlight-prod", "tags", /allowed: dev, test, prod/);
  d = good(); d.resources[APP].tags["cost-center"] = "1042";
  expectFail(d, "app-northlight-prod", "tags", /like CC-1234/);
  d = good(); d.resources[APP].tags.owner = "the design team";
  expectFail(d, "app-northlight-prod", "tags", /email address/);
});

// ---------- names ----------

test("resource group names: length and trailing period", () => {
  let d = good(); d.resources[RG].name = "rg-northlight-" + "x".repeat(80) + "prod";
  expectFail(d, d.resources[RG].name, "name", /must be 1 to 90/);
  d = good(); d.resources[RG].name = "rg-northlight-prod."; d.resources.forEach(r => { if (r.resourceGroup) r.resourceGroup = "rg-northlight-prod."; });
  expectFail(d, "rg-northlight-prod.", "name", /cannot end with "\."/);
});

test("web app names: characters, hyphen at the edges, length", () => {
  let d = good(); d.resources[APP].name = "app_northlight_prod";
  expectFail(d, "app_northlight_prod", "name", /characters a web app cannot use/);
  d = good(); d.resources[APP].name = "-app-northlight-prod";
  expectFail(d, "-app-northlight-prod", "name", /cannot start with "-"/);
  d = good(); d.resources[APP].name = "app-northlight-prod-";
  expectFail(d, "app-northlight-prod-", "name", /cannot end with "-"/);
  d = good(); d.resources[APP].name = "a";
  expectFail(d, "a", "name", /must be 2 to 60/);
});

test("storage account names: lowercase letters and numbers only, 3 to 24", () => {
  let d = good(); d.resources[ST].name = "st-northlight-prod";
  expectFail(d, "st-northlight-prod", "name", /lowercase letters and numbers only/);
  d = good(); d.resources[ST].name = "stNorthlightprod";
  expectFail(d, "stNorthlightprod", "name", /cannot use|must be lowercase/);
  d = good(); d.resources[ST].name = "stnorthlightprodstorage99";
  expectFail(d, "stnorthlightprodstorage99", "name", /25 characters, a storage account name must be 3 to 24/);
  d = good(); d.resources[ST].name = "st";
  expectFail(d, "st", "name", /must be 3 to 24/);
});

test("naming convention: prefix, product name and env suffix", () => {
  let d = good(); d.resources[APP].name = "northlight-prod";
  expectFail(d, "northlight-prod", "name", /must start with "app-"/);
  d = good(); d.resources[APP].name = "app-studio-prod";
  expectFail(d, "app-studio-prod", "name", /must contain "northlight"/);
  d = good(); d.resources[APP].name = "app-northlight-dev";
  expectFail(d, "app-northlight-dev", "name", /must end with its env tag "prod"/);
});

test("duplicate names are reported", () => {
  const d = good(); d.resources.push(JSON.parse(JSON.stringify(d.resources[APP])));
  expectFail(d, "app-northlight-prod", "name", /is used twice/);
});

// ---------- structure and references ----------

test("exactly one resource group is required", () => {
  let d = good(); d.resources.shift();
  expectFail(d, "file", "resource group", /found 0/);
  d = good(); d.resources.push({ type: "resourceGroup", name: "rg-northlight-dev", tags: { owner: "a@b.example", env: "dev", "cost-center": "CC-1000" } });
  expectFail(d, "file", "resource group", /found 2/);
});

test("a resource must point at a resource group in the file, with the same env", () => {
  let d = good(); d.resources[ST].resourceGroup = "rg-elsewhere";
  expectFail(d, "stnorthlightprod", "group", /not in this file/);
  d = good(); d.resources[ST].name = "stnorthlighttest"; d.resources[ST].tags.env = "test";
  expectFail(d, "stnorthlighttest", "group", /differs from its resource group \(prod\)/);
});

test("unknown types, non-objects and an empty file fail", () => {
  let d = good(); d.resources[APP].type = "database";
  expectFail(d, "app-northlight-prod", "type", /unknown type "database"/);
  assert.ok(failures(C.validate(null)).length);
  assert.ok(failures(C.validate([])).length);
  assert.ok(failures(C.validate({ schemaVersion: 1, resources: [] })).length);
  assert.ok(failures(C.validate({ schemaVersion: 2, resources: [{}] })).some(c => /schemaVersion/.test(c.message)));
});

test("a resource with no name (or a non-text name) fails cleanly instead of crashing", () => {
  for (const bad of [undefined, null, "", 42, ["x"]]) {
    const d = good();
    if (bad === undefined) delete d.resources[APP].name; else d.resources[APP].name = bad;
    let checks;
    assert.doesNotThrow(() => { checks = C.validate(d); });
    assert.ok(failures(checks).some(c => c.check === "name" && /no name/.test(c.message)), "name=" + JSON.stringify(bad));
    assert.doesNotThrow(() => C.format(checks));
  }
});

test("the checker also loads in a browser-like environment (no require or module)", () => {
  const vm = require("node:vm");
  const code = fs.readFileSync(SCRIPT, "utf8");
  const sandbox = { window: {}, console };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const api = sandbox.window.NorthlightCloudCheck;
  assert.ok(api && typeof api.validate === "function" && typeof api.format === "function");
  assert.strictEqual(api.validate(good()).filter(c => !c.pass).length, 0);   // (arrays from another realm: compare lengths)
  const d = good(); delete d.resources[RG].tags.env;
  assert.ok(api.validate(d).some(c => !c.pass && /missing tag "env"/.test(c.message)));
});

test("format() prints PASS/FAIL lines and a summary", () => {
  const d = good(); delete d.resources[APP].tags.owner;
  const text = C.format(C.validate(d));
  assert.match(text, /^PASS /m);
  assert.match(text, /^FAIL {2}app-northlight-prod {1,}tags {1,}missing tag "owner"/m);
  assert.match(text, /1 of \d+ checks FAILED\./);
});

// ---------- the command line: exit codes ----------

function runCli(doc, raw) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cloudcheck-"));
  const file = path.join(dir, "plan.json");
  if (doc !== undefined) fs.writeFileSync(file, raw !== undefined ? raw : JSON.stringify(doc));
  const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

test("CLI: exit 0 for a good file", () => {
  const r = runCli(good());
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /All 10 checks passed/);
});

test("CLI: exit 1 for a missing tag, naming the problem", () => {
  const d = good(); delete d.resources[RG].tags["cost-center"];
  const r = runCli(d);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /FAIL {2}rg-northlight-prod/);
  assert.match(r.stdout, /missing tag "cost-center"/);
});

test("CLI: exit 1 for a bad name", () => {
  const d = good(); d.resources[ST].name = "st-Northlight_prod";
  const r = runCli(d);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /FAIL/);
});

test("CLI: exit 2 for broken JSON or a missing file", () => {
  assert.strictEqual(runCli({}, "{ not json").status, 2);
  const r = spawnSync(process.execPath, [SCRIPT, path.join(os.tmpdir(), "does-not-exist-" + Date.now() + ".json")], { encoding: "utf8" });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /Cannot read/);
});

test("CLI: inside GitHub Actions every failure also becomes an ::error annotation", () => {
  const d = good(); delete d.resources[APP].tags.env; delete d.resources[APP].tags.owner;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cloudcheck-"));
  const file = path.join(dir, "plan.json"); fs.writeFileSync(file, JSON.stringify(d));
  const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true" } });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(r.status, 1);
  assert.strictEqual((r.stdout.match(/^::error /gm) || []).length, 2);
});

test("the checker never modifies the file it reads", () => {
  const before = fs.readFileSync(REAL);
  spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.ok(before.equals(fs.readFileSync(REAL)));
});
