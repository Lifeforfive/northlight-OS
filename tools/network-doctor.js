#!/usr/bin/env node
"use strict";
/*
 * Network doctor (READ-ONLY).
 * Steps, in order:
 *   1. Router   : ping the default gateway
 *   2. Internet : ping 1.1.1.1
 *   3. Website  : resolve a website name (default: example.com)
 * Prints PASS or FAIL for each step and names the first failing one.
 * It only reads the routing table and sends a few pings / one DNS lookup.
 * It never changes any setting.
 */
const dns = require("dns").promises;
const { execFileSync } = require("child_process");

// ---------- command runner (replaced by fake output in tests) ----------

function defaultRun(cmd, args) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"]
  });
}

// Like run(), but a failing command (e.g. ping with no reply) yields its output.
function runAllowFail(run, cmd, args) {
  try { return run(cmd, args); } catch (e) { return String(e.stdout || ""); }
}

// ---------- parsers (pure functions, easy to test) ----------

const IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;

// Linux: "default via 192.168.1.1 dev eth0 ..."
function parseLinuxGateway(out) {
  const m = /^default via (\d{1,3}(?:\.\d{1,3}){3})/m.exec(out);
  return m ? m[1] : null;
}

// macOS: "   gateway: 192.168.1.1"
function parseMacGateway(out) {
  const m = /gateway:\s*(\d{1,3}(?:\.\d{1,3}){3})/.exec(out);
  return m ? m[1] : null;
}

// Windows (PowerShell NextHop): "192.168.1.1"
function parseWindowsGateway(out) {
  const m = IPV4.exec(out.trim());
  return m && m[1] !== "0.0.0.0" ? m[1] : null;
}

// A real reply contains TTL (Windows "TTL=", Linux/macOS "ttl=").
// Windows can exit 0 for "Destination host unreachable", so the exit code alone is not trusted.
function pingSucceeded(out) {
  return /ttl=\d+/i.test(out) && !/unreachable|timed out|100(\.0)?% (packet )?loss/i.test(out);
}

function findGateway(platform, run) {
  let out;
  if (platform === "win32") {
    out = run("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).NextHop"]);
    return parseWindowsGateway(out);
  }
  if (platform === "darwin") return parseMacGateway(run("route", ["-n", "get", "default"]));
  return parseLinuxGateway(run("ip", ["route", "show", "default"]));
}

function pingArgs(platform, host) {
  if (platform === "win32") return ["-n", "2", "-w", "2000", host];
  if (platform === "darwin") return ["-c", "2", "-t", "4", host];
  return ["-c", "2", "-W", "2", host];
}

// ---------- the steps ----------

const HINTS = {
  1: "Your PC cannot reach the router. Check Wi-Fi or the network cable, and that the router has power.",
  2: "The router answers but the internet does not. The problem is between the router and the provider: restart the router, check the modem/ISP.",
  3: "The internet is reachable but the website name does not resolve. This is a DNS problem."
};

async function runSteps(deps) {
  const d = Object.assign({
    platform: process.platform,
    run: defaultRun,
    lookup: name => dns.lookup(name),
    website: "example.com"
  }, deps || {});

  const steps = [];

  // The internet ping is measured first because it also proves the router works:
  // many routers ignore ping, but traffic to 1.1.1.1 cannot pass if the router is down.
  const okNet = pingSucceeded(runAllowFail(d.run, "ping", pingArgs(d.platform, "1.1.1.1")));

  // 1. Router
  let gateway = null;
  try { gateway = findGateway(d.platform, d.run); } catch (e) { gateway = null; }
  if (!gateway) {
    steps.push({ n: 1, name: "Router (default gateway)", pass: false, detail: "no default gateway found" });
  } else {
    const ok = pingSucceeded(runAllowFail(d.run, "ping", pingArgs(d.platform, gateway)));
    if (ok) {
      steps.push({ n: 1, name: "Router (default gateway)", pass: true, detail: gateway + " replied" });
    } else if (okNet) {
      steps.push({ n: 1, name: "Router (default gateway)", pass: true, detail: gateway + " ignores ping, but traffic passes through it" });
    } else {
      steps.push({ n: 1, name: "Router (default gateway)", pass: false, detail: gateway + " did not reply" });
    }
  }

  // 2. Internet by IP address
  steps.push({ n: 2, name: "Internet (1.1.1.1)", pass: okNet, detail: okNet ? "1.1.1.1 replied" : "1.1.1.1 did not reply" });

  // 3. Website name (DNS)
  try {
    const r = await d.lookup(d.website);
    const addr = typeof r === "string" ? r : r && r.address;
    steps.push({ n: 3, name: "Website name (" + d.website + ")", pass: !!addr, detail: addr ? "resolved to " + addr : "no address returned" });
  } catch (e) {
    steps.push({ n: 3, name: "Website name (" + d.website + ")", pass: false, detail: "could not resolve (" + (e.code || e.message) + ")" });
  }

  return steps;
}

function formatReport(steps) {
  const lines = steps.map(s => (s.pass ? "PASS" : "FAIL") + "  " + s.n + ". " + s.name.padEnd(30) + s.detail);
  const first = steps.find(s => !s.pass);
  lines.push("");
  if (first) {
    lines.push("First failing step: " + first.n + ". " + first.name);
    lines.push(HINTS[first.n]);
  } else {
    lines.push("All steps passed. The network looks healthy.");
  }
  return lines.join("\n");
}

async function main() {
  const website = process.argv[2] || "example.com";
  console.log("Network doctor (read-only)\n");
  const steps = await runSteps({ website });
  console.log(formatReport(steps));
  process.exitCode = steps.some(s => !s.pass) ? 1 : 0;
}

if (require.main === module) main();

module.exports = {
  parseLinuxGateway, parseMacGateway, parseWindowsGateway,
  pingSucceeded, findGateway, pingArgs, runSteps, formatReport
};
