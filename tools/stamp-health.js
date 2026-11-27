#!/usr/bin/env node
"use strict";
/*
 * Checks health.json (name, version, buildDate) and, with --stamp, sets buildDate to today (UTC).
 * The deploy workflow runs this with --stamp so the published copy always shows the real build date.
 * Without --stamp it only reads the file.
 *
 *   node tools/stamp-health.js [--stamp] [path-to-health.json]
 *
 * Exit code 0 = valid, 1 = invalid, 2 = the file could not be read.
 */
const fs = require("fs");
const path = require("path");

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function validDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// Returns a list of problems (empty = valid).
function validateHealth(h) {
  const out = [];
  if (!h || typeof h !== "object" || Array.isArray(h)) return ["health.json must contain a JSON object"];
  if (typeof h.name !== "string" || !h.name.trim()) out.push('"name" must be a non-empty text');
  if (typeof h.version !== "string" || !SEMVER.test(h.version)) out.push('"version" must look like 1.2.3 (got ' + JSON.stringify(h.version) + ")");
  if (!validDate(h.buildDate)) out.push('"buildDate" must be a real date like 2026-11-27 (got ' + JSON.stringify(h.buildDate) + ")");
  return out;
}

function today() { return process.env.BUILD_DATE || new Date().toISOString().slice(0, 10); }

function main(argv) {
  const args = argv.slice(2);
  const stamp = args.includes("--stamp");
  const file = path.resolve(args.filter(a => !a.startsWith("--"))[0] || path.join(__dirname, "..", "health.json"));
  let health;
  try { health = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { console.error("Cannot read " + file + ": " + e.message); return 2; }

  const problems = validateHealth(health);
  if (problems.length) {
    problems.forEach(p => { console.log("FAIL  " + p); if (process.env.GITHUB_ACTIONS) console.log("::error file=" + path.basename(file) + "::" + p); });
    return 1;
  }
  console.log("PASS  " + path.basename(file) + ": " + health.name + " " + health.version + ", built " + health.buildDate);

  if (stamp) {
    const date = today();
    if (!validDate(date)) { console.error("FAIL  cannot stamp: " + JSON.stringify(date) + " is not a date"); return 1; }
    health.buildDate = date;
    fs.writeFileSync(file, JSON.stringify(health, null, 2) + "\n");
    console.log("PASS  stamped buildDate " + date);
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { validateHealth, validDate };
