#!/usr/bin/env node
"use strict";
/*
 * Copies only the files the website needs into an output folder (default: _site).
 * Tests, build tooling, the README and the workflow stay out of what is published.
 *
 *   node tools/build-site.js [output-folder]
 *
 * Exit code 0 = built, 1 = the output folder is unsafe, 2 = the copy failed.
 */
const fs = require("fs");
const path = require("path");

// Paths (relative to the repository root, with forward slashes) that are NOT published.
const EXCLUDE = [
  ".git", ".github", ".gitignore", ".playwright-mcp", "node_modules", "_site",
  "README.md",
  "tools/test",
  "tools/build-site.js", "tools/check-links.js", "tools/stamp-health.js"
];

function isExcluded(rel) {
  rel = rel.split(path.sep).join("/");
  return EXCLUDE.some(e => rel === e || rel.startsWith(e + "/"));
}

const MARKER = ".site-build";    // written into every output folder this tool creates

// Throws unless `dest` is a place this tool may safely empty and fill. Touches nothing on disk.
function assertSafeOutput(src, dest) {
  src = path.resolve(src); dest = path.resolve(dest);
  const rel = path.relative(dest, src);                     // how to get from the output folder to the repository
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error("the output folder must not be the repository itself or a parent of it");
  }
  if (dest === path.parse(dest).root || dest.split(path.sep).filter(Boolean).length < 2) {
    throw new Error("the output folder must not be a drive root or a top-level folder");
  }
}

function build(root, out) {
  const src = path.resolve(root), dest = path.resolve(out);
  assertSafeOutput(src, dest);
  // Only ever delete a folder that is empty, missing, or was created by this tool earlier.
  if (fs.existsSync(dest)) {
    const entries = fs.readdirSync(dest);
    if (entries.length && !entries.includes(MARKER)) {
      throw new Error("the output folder already exists and was not created by this tool, so it will not be emptied: " + dest);
    }
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, MARKER), "created by tools/build-site.js; safe to delete\n");
  const copied = [], skipped = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name), rel = path.relative(src, full);
      if (full === dest || isExcluded(rel)) { skipped.push(rel.split(path.sep).join("/")); continue; }
      if (name === MARKER) continue;
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      const to = path.join(dest, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(full, to);
      copied.push(rel.split(path.sep).join("/"));
    }
  })(src);
  return { copied, skipped };
}

function main(argv) {
  const root = path.join(__dirname, "..");
  const out = path.resolve(argv[2] || path.join(root, "_site"));
  try {
    const r = build(root, out);
    console.log("PASS  built " + path.relative(root, out) + ": " + r.copied.length + " files published");
    console.log("      left out: " + r.skipped.sort().join(", "));
    return 0;
  } catch (e) {
    console.error("FAIL  " + e.message);
    return /output folder/.test(e.message) ? 1 : 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { build, isExcluded, assertSafeOutput, EXCLUDE, MARKER };
