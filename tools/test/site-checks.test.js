"use strict";
// Run with:  node --test tools/   (builds into temporary folders; the repository itself is only read)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { build, isExcluded } = require("../build-site");
const { check, format } = require("../check-links");

const ROOT = path.join(__dirname, "..", "..");
function builtSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "site-"));
  build(ROOT, dir);
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const fails = r => r.filter(x => !x.pass);
const read = (dir, f) => fs.readFileSync(path.join(dir, f), "utf8");
const write = (dir, f, s) => fs.writeFileSync(path.join(dir, f), s);

// ---------- build-site ----------

test("build: pages and runtime files are published, tests, tooling and docs are not", () => {
  const s = builtSite();
  try {
    const have = f => fs.existsSync(path.join(s.dir, f));
    for (const f of ["index.html", "cloud.html", "rules.json", "northlight.cloud.json", "health.json", "config.js", "guard.js", "security.js", "tools/check-cloud.js", "tools/network-doctor.js", "tools/health-report.js", "logo.svg"]) assert.ok(have(f), f + " should be published");
    for (const f of ["README.md", ".github", ".git", "tools/test", "tools/stamp-health.js", "tools/build-site.js", "tools/check-links.js", ".gitignore"]) assert.ok(!have(f), f + " should NOT be published");
  } finally { s.cleanup(); }
});

test("build: the exclusion rules", () => {
  assert.ok(isExcluded("tools/test/security.test.js") && isExcluded("tools/test") && isExcluded(".github/workflows/deploy.yml") && isExcluded("README.md"));
  assert.ok(!isExcluded("tools/check-cloud.js") && !isExcluded("tools/testing-notes.txt") && !isExcluded("index.html"));
});

// SAFETY TESTS: everything below uses throw-away temporary folders only, never a real parent folder or a drive root.

test("build: the output-folder guard refuses the repository, its parent and a drive root (pure check, touches no files)", () => {
  const { assertSafeOutput } = require("../build-site");
  const repo = path.join(os.tmpdir(), "guard-demo", "repo");
  assert.throws(() => assertSafeOutput(repo, repo), /repository itself or a parent/);
  assert.throws(() => assertSafeOutput(repo, path.dirname(repo)), /repository itself or a parent/);
  assert.throws(() => assertSafeOutput(repo, os.tmpdir()), /repository itself or a parent/);
  assert.throws(() => assertSafeOutput(repo, path.parse(repo).root), /repository itself or a parent|drive root/);
  assert.doesNotThrow(() => assertSafeOutput(repo, path.join(repo, "_site")));
  assert.doesNotThrow(() => assertSafeOutput(repo, path.join(os.tmpdir(), "guard-demo", "elsewhere")));
});

test("build: pointing it at a parent folder fails and deletes nothing", () => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "parent-"));
  const repo = path.join(top, "repo"); fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "index.html"), "x");
  fs.writeFileSync(path.join(top, "precious.txt"), "do not delete");
  try {
    assert.throws(() => build(repo, top), /repository itself or a parent/);
    assert.ok(fs.existsSync(path.join(top, "precious.txt")), "the file in the parent folder must survive");
    assert.ok(fs.existsSync(path.join(repo, "index.html")), "the repository must survive");
  } finally { fs.rmSync(top, { recursive: true, force: true }); }
});

test("build: it will not empty an existing folder it did not create", () => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "unmarked-"));
  const repo = path.join(top, "repo"); fs.mkdirSync(repo); fs.writeFileSync(path.join(repo, "index.html"), "x");
  const other = path.join(top, "someone-elses-folder"); fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, "important.txt"), "keep me");
  try {
    assert.throws(() => build(repo, other), /not created by this tool/);
    assert.strictEqual(fs.readFileSync(path.join(other, "important.txt"), "utf8"), "keep me");
  } finally { fs.rmSync(top, { recursive: true, force: true }); }
});

test("build: an empty folder and a previous build output can both be rebuilt", () => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "rebuild-"));
  const repo = path.join(top, "repo"); fs.mkdirSync(repo); fs.writeFileSync(path.join(repo, "index.html"), "x");
  const out = path.join(top, "out");
  try {
    fs.mkdirSync(out);                                   // empty folder: allowed
    assert.strictEqual(build(repo, out).copied.length, 1);
    assert.ok(fs.existsSync(path.join(out, ".site-build")));
    fs.writeFileSync(path.join(out, "stale.html"), "old");
    fs.writeFileSync(path.join(repo, "second.html"), "y");
    assert.strictEqual(build(repo, out).copied.length, 2);   // marked folder: emptied and rebuilt
    assert.ok(!fs.existsSync(path.join(out, "stale.html")));
  } finally { fs.rmSync(top, { recursive: true, force: true }); }
});

test("build: it never changes the source files", () => {
  const before = fs.readFileSync(path.join(ROOT, "index.html"));
  const s = builtSite(); s.cleanup();
  assert.ok(before.equals(fs.readFileSync(path.join(ROOT, "index.html"))));
});

// ---------- check-links ----------

test("check-links: the real built site passes every check", () => {
  const s = builtSite();
  try { assert.deepStrictEqual(fails(check(s.dir)).map(f => f.scope + ": " + f.message), []); } finally { s.cleanup(); }
});

test("check-links: a missing page, script or runtime file is caught", () => {
  const s = builtSite();
  try {
    fs.rmSync(path.join(s.dir, "crm.html"));
    fs.rmSync(path.join(s.dir, "rules.json"));
    fs.rmSync(path.join(s.dir, "statusbar.js"));
    const f = fails(check(s.dir)).map(x => x.scope + " " + x.check + " " + x.message).join("\n");
    assert.match(f, /crm\.html" does not exist/);
    assert.match(f, /statusbar\.js" does not exist/);
    assert.match(f, /runtime rules\.json MISSING/);
  } finally { s.cleanup(); }
});

test("check-links: a javascript: link is caught", () => {
  const s = builtSite();
  try {
    write(s.dir, "cloud.html", read(s.dir, "cloud.html").replace("</main>", '<a href="javascript:alert(1)">x</a></main>'));
    assert.match(fails(check(s.dir)).map(x => x.message).join("|"), /javascript: link/);
  } finally { s.cleanup(); }
});

test("check-links: a page without the Content-Security-Policy is caught", () => {
  const s = builtSite();
  try {
    write(s.dir, "track.html", read(s.dir, "track.html").replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, ""));
    assert.match(fails(check(s.dir)).filter(x => x.scope === "track.html").map(x => x.message).join("|"), /no Content-Security-Policy/);
  } finally { s.cleanup(); }
});

test("check-links: a policy that allows unsafe-inline scripts is caught", () => {
  const s = builtSite();
  try {
    write(s.dir, "staff.html", read(s.dir, "staff.html").replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"));
    assert.match(fails(check(s.dir)).filter(x => x.scope === "staff.html").map(x => x.message).join("|"), /without unsafe-inline/);
  } finally { s.cleanup(); }
});

test("check-links: inline scripts and inline event handlers are caught", () => {
  const s = builtSite();
  try {
    write(s.dir, "logs.html", read(s.dir, "logs.html").replace("</body>", "<script>alert(1)</script></body>"));
    write(s.dir, "crm.html", read(s.dir, "crm.html").replace("</body>", '<button onclick="x()">b</button></body>'));
    const f = fails(check(s.dir));
    assert.match(f.filter(x => x.scope === "logs.html").map(x => x.message).join("|"), /inline script/);
    assert.match(f.filter(x => x.scope === "crm.html").map(x => x.message).join("|"), /inline event handler/);
  } finally { s.cleanup(); }
});

test("check-links: the JSON-LD data block is allowed, guard.js must come first", () => {
  const s = builtSite();
  try {
    assert.deepStrictEqual(fails(check(s.dir)).filter(x => x.scope === "index.html"), []);         // index.html has a JSON-LD block
    write(s.dir, "helpdesk.html", read(s.dir, "helpdesk.html").replace('<script src="guard.js"></script>', ""));
    assert.match(fails(check(s.dir)).filter(x => x.scope === "helpdesk.html").map(x => x.message).join("|"), /guard\.js must be the first script/);
  } finally { s.cleanup(); }
});

test("check-links: a script that fetches a file that is not there is caught", () => {
  const s = builtSite();
  try {
    write(s.dir, "cloud.js", read(s.dir, "cloud.js") + '\nfetch("missing-data.json");\n');
    assert.match(fails(check(s.dir)).map(x => x.scope + " " + x.message).join("|"), /cloud\.js fetches missing file\(s\): missing-data\.json/);
  } finally { s.cleanup(); }
});

test("check-links: the config's file locations must exist", () => {
  const s = builtSite();
  try {
    write(s.dir, "config.js", read(s.dir, "config.js").replace('healthUrl: "health.json"', 'healthUrl: "nope.json"'));
    assert.match(fails(check(s.dir)).map(x => x.message).join("|"), /config\.js points at it/);
  } finally { s.cleanup(); }
});

test("check-links CLI: exit 0 on a good site, 1 on a broken one, 2 for a missing folder", () => {
  const s = builtSite();
  try {
    const script = path.join(ROOT, "tools", "check-links.js");
    assert.strictEqual(spawnSync(process.execPath, [script, s.dir], { encoding: "utf8" }).status, 0);
    fs.rmSync(path.join(s.dir, "index.html"));
    const r = spawnSync(process.execPath, [script, s.dir], { encoding: "utf8" });
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /FAIL/);
    assert.strictEqual(spawnSync(process.execPath, [script, path.join(os.tmpdir(), "nope-" + Date.now())], { encoding: "utf8" }).status, 2);
  } finally { s.cleanup(); }
});

test("format prints PASS/FAIL lines and a summary", () => {
  const text = format([{ scope: "a.html", check: "links", pass: true, message: "ok" }, { scope: "b.html", check: "links", pass: false, message: "broken" }]);
  assert.match(text, /^PASS {2}a\.html/m);
  assert.match(text, /^FAIL {2}b\.html/m);
  assert.match(text, /1 of 2 checks FAILED/);
});
