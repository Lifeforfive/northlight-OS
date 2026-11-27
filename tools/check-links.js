#!/usr/bin/env node
"use strict";
/*
 * Checks a built site folder (default: _site) before it is published. READ-ONLY.
 *   1. Every page, script, style and image a page links to exists in the folder.
 *   2. Files the scripts fetch at run time exist (rules.json, health.json, ...).
 *   3. Security rules still hold: every page has a Content-Security-Policy and loads guard.js,
 *      no page has inline executable code or inline event handlers, and nothing links to javascript:.
 *
 *   node tools/check-links.js [folder]
 *
 * Exit code 0 = all checks passed, 1 = a check failed, 2 = the folder could not be read.
 */
const fs = require("fs");
const path = require("path");

const RUNTIME = ["rules.json", "health.json", "northlight.cloud.json", "tools/check-cloud.js"];   // fetched or loaded by scripts

function files(dir, rel) {
  rel = rel || "";
  return fs.readdirSync(path.join(dir, rel)).flatMap(n => {
    const r = rel ? rel + "/" + n : n;
    return fs.statSync(path.join(dir, r)).isDirectory() ? files(dir, r) : [r];
  });
}

function check(dir) {
  const results = [];
  const add = (scope, check, pass, message) => results.push({ scope, check, pass, message });
  const all = files(dir);
  const set = new Set(all);
  const pages = all.filter(f => f.endsWith(".html"));
  if (!pages.length) { add("site", "pages", false, "no .html pages were found"); return results; }
  add("site", "pages", true, pages.length + " pages, " + all.length + " files");

  RUNTIME.forEach(f => add("runtime", f, set.has(f), set.has(f) ? "present" : "MISSING: scripts fetch or load this file"));

  for (const page of pages) {
    const html = fs.readFileSync(path.join(dir, page), "utf8");
    const base = path.posix.dirname(page);

    // 1. links
    const bad = [];
    const refs = [...html.matchAll(/\b(?:href|src)\s*=\s*"([^"]*)"/g)].map(m => m[1]);
    for (const ref of refs) {
      if (/^javascript:/i.test(ref.trim())) { bad.push('"' + ref + '" is a javascript: link'); continue; }
      if (/^(#|https?:|mailto:|tel:|data:|\/\/)/i.test(ref) || ref === "") continue;
      const target = path.posix.normalize(path.posix.join(base, ref.split("#")[0].split("?")[0]));
      if (!set.has(target)) bad.push('"' + ref + '" does not exist');
    }
    add(page, "links", !bad.length, bad.length ? bad.join("; ") : refs.length + " references resolve");

    // 2. security rules
    const problems = [];
    if (!/http-equiv="Content-Security-Policy"/.test(html)) problems.push("no Content-Security-Policy meta tag");
    const csp = (/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html) || [])[1] || "";
    if (/script-src[^;]*'unsafe-(inline|eval)'/.test(csp) || !/script-src 'self'/.test(csp)) problems.push("the policy must say script-src 'self' without unsafe-inline or unsafe-eval");
    const headScripts = [...html.matchAll(/<script\b[^>]*>/g)].map(m => m[0]);
    if (!headScripts.length || !/src="guard\.js"/.test(headScripts[0])) problems.push("guard.js must be the first script on the page");
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m => !/\bsrc=/.test(m[1]) && !/type="application\/ld\+json"/.test(m[1]) && m[2].trim());
    if (inline.length) problems.push(inline.length + " inline script(s) would be blocked by the policy");
    if (/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, ""))) problems.push("inline event handler attribute (onclick=...)");
    add(page, "security", !problems.length, problems.length ? problems.join("; ") : "CSP set, guard.js first, no inline code");
  }

  // 3. fetches in scripts
  for (const f of all.filter(f => f.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    const bad = [...src.matchAll(/\bfetch\(\s*"([^"]+)"/g)].map(m => m[1]).filter(u => !/^https?:/.test(u) && !set.has(path.posix.normalize(path.posix.join(path.posix.dirname(f), u.split("?")[0]))) && !set.has(u.split("?")[0]));
    if (bad.length) add(f, "fetch", false, "fetches missing file(s): " + bad.join(", "));
  }
  const cfg = fs.existsSync(path.join(dir, "config.js")) ? fs.readFileSync(path.join(dir, "config.js"), "utf8") : "";
  [...cfg.matchAll(/(?:healthUrl|cloudPlanUrl):\s*"([^"]+)"/g)].forEach(m => add("config.js", m[1], set.has(m[1]), set.has(m[1]) ? "present" : "MISSING: config.js points at it"));
  return results;
}

function format(results) {
  const failed = results.filter(r => !r.pass).length;
  const lines = results.map(r => (r.pass ? "PASS" : "FAIL") + "  " + r.scope.padEnd(24) + r.check.padEnd(24) + r.message);
  lines.push("", failed ? failed + " of " + results.length + " checks FAILED." : "All " + results.length + " checks passed.");
  return lines.join("\n");
}

function main(argv) {
  const dir = path.resolve(argv[2] || path.join(__dirname, "..", "_site"));
  let results;
  try { results = check(dir); } catch (e) { console.error("Cannot read " + dir + ": " + e.message); return 2; }
  console.log("Site check (read-only): " + path.basename(dir) + "\n");
  console.log(format(results));
  const failed = results.filter(r => !r.pass);
  if (process.env.GITHUB_ACTIONS) failed.forEach(r => console.log("::error::" + r.scope + " (" + r.check + "): " + r.message));
  return failed.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { check, format };
