#!/usr/bin/env node
"use strict";
/*
 * PC health report (READ-ONLY).
 * Checks: operating system, free disk space, firewall status, updates.
 * Every command used here only reads information. Nothing is changed.
 */
const os = require("os");
const fs = require("fs");
const { execFileSync } = require("child_process");

const GB = 1024 ** 3;
const DAY = 24 * 60 * 60 * 1000;
const MAX_UPDATE_AGE_DAYS = 60;

// ---------- command runner (replaced by fake output in tests) ----------

function defaultRun(cmd, args) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"]
  });
}

function ps(run, script) {
  return run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
}

// ---------- parsers (pure functions, easy to test) ----------

// "Domain=True\nPrivate=True\nPublic=False"
function parseWindowsFirewall(out) {
  const profiles = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const [name, value] = l.split("=");
    return { name, on: /^true$/i.test((value || "").trim()) };
  });
  if (!profiles.length) return { pass: false, detail: "no firewall profiles reported" };
  const off = profiles.filter(p => !p.on).map(p => p.name);
  return off.length
    ? { pass: false, detail: "OFF for: " + off.join(", ") }
    : { pass: true, detail: "ON for all profiles (" + profiles.map(p => p.name).join(", ") + ")" };
}

// "Firewall is enabled. (State = 1)"
function parseMacFirewall(out) {
  return /enabled/i.test(out) && !/disabled/i.test(out)
    ? { pass: true, detail: "application firewall is enabled" }
    : { pass: false, detail: "application firewall is not enabled" };
}

// output of `systemctl is-active ufw` / `firewalld`: "active" or "inactive"
function parseLinuxFirewall(outs) {
  const active = Object.keys(outs).filter(name => /^active\s*$/i.test(outs[name] || ""));
  return active.length
    ? { pass: true, detail: active.join(", ") + " is active" }
    : { pass: false, detail: "neither ufw nor firewalld is active" };
}

// "2026-11-02" (date of newest installed Windows update)
function parseLastUpdate(out, now) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(out);
  if (!m) return { pass: false, detail: "could not read the date of the last update" };
  const when = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const days = Math.floor((now - when) / DAY);
  return days <= MAX_UPDATE_AGE_DAYS
    ? { pass: true, detail: "last update installed " + days + " days ago (" + m[0] + ")" }
    : { pass: false, detail: "last update installed " + days + " days ago (" + m[0] + "), older than " + MAX_UPDATE_AGE_DAYS + " days" };
}

function parseMacUpdates(out) {
  if (/No new software available/i.test(out)) return { pass: true, detail: "no updates available" };
  const n = (out.match(/^\s*\*/gm) || []).length;
  return { pass: false, detail: n ? n + " update(s) available" : "updates may be available" };
}

function parseAptUpdates(out) {
  const lines = out.split(/\r?\n/).filter(l => l.trim() && !/^Listing/i.test(l));
  return lines.length
    ? { pass: false, detail: lines.length + " package update(s) available" }
    : { pass: true, detail: "no package updates available" };
}

function describeDisk(stat) {
  const pct = stat.total ? (stat.free / stat.total) * 100 : 0;
  const detail = (stat.free / GB).toFixed(1) + " GB free of " + (stat.total / GB).toFixed(1) +
    " GB (" + pct.toFixed(0) + "%)";
  return { pass: pct >= 10, detail: pct >= 10 ? detail : detail + ", below 10%" };
}

// ---------- checks ----------

function attempt(name, fn) {
  try {
    const r = fn();
    return { name, pass: r.pass, detail: r.detail };
  } catch (e) {
    return { name, pass: false, detail: "could not determine (" + (e.message || "command failed").split("\n")[0] + ")" };
  }
}

function runChecks(deps) {
  const d = Object.assign({
    platform: process.platform,
    run: defaultRun,
    now: Date.now(),
    osInfo: () => ({ name: os.version(), release: os.release(), arch: os.arch() }),
    diskStat: () => {
      const root = process.platform === "win32" ? (process.env.SystemDrive || "C:") + "\\" : "/";
      const s = fs.statfsSync(root);
      return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
    }
  }, deps || {});

  const results = [];

  results.push(attempt("Operating system", () => {
    const i = d.osInfo();
    return { pass: !!i.name, detail: i.name + " " + i.release + " (" + i.arch + ")" };
  }));

  results.push(attempt("Free disk space", () => describeDisk(d.diskStat())));

  results.push(attempt("Firewall", () => {
    if (d.platform === "win32") {
      return parseWindowsFirewall(ps(d.run,
        "Get-NetFirewallProfile | ForEach-Object { $_.Name + '=' + $_.Enabled }"));
    }
    if (d.platform === "darwin") {
      return parseMacFirewall(d.run("/usr/libexec/ApplicationFirewall/socketfilterfw", ["--getglobalstate"]));
    }
    const outs = {};
    for (const svc of ["ufw", "firewalld"]) {
      try { outs[svc] = d.run("systemctl", ["is-active", svc]); } catch (e) { outs[svc] = ""; }
    }
    return parseLinuxFirewall(outs);
  }));

  results.push(attempt("Updates", () => {
    if (d.platform === "win32") {
      return parseLastUpdate(ps(d.run,
        "Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | " +
        "Select-Object -First 1 | ForEach-Object { $_.InstalledOn.ToString('yyyy-MM-dd') }"), d.now);
    }
    if (d.platform === "darwin") return parseMacUpdates(d.run("softwareupdate", ["-l"]));
    return parseAptUpdates(d.run("apt", ["list", "--upgradable"]));
  }));

  return results;
}

function formatReport(results) {
  const lines = results.map(r => (r.pass ? "PASS" : "FAIL") + "  " + r.name.padEnd(18) + r.detail);
  const failed = results.filter(r => !r.pass).length;
  lines.push("", failed ? failed + " of " + results.length + " checks FAILED." : "All " + results.length + " checks passed.");
  return lines.join("\n");
}

function main() {
  console.log("PC health report (read-only)\n");
  const results = runChecks();
  console.log(formatReport(results));
  process.exitCode = results.some(r => !r.pass) ? 1 : 0;
}

if (require.main === module) main();

module.exports = {
  parseWindowsFirewall, parseMacFirewall, parseLinuxFirewall,
  parseLastUpdate, parseMacUpdates, parseAptUpdates, describeDisk,
  runChecks, formatReport
};
