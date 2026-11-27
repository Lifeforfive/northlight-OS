"use strict";
// Run with:  node --test tools/
// Uses FAKE command output only. Nothing real is executed or changed.
const test = require("node:test");
const assert = require("node:assert");
const health = require("../health-report");
const net = require("../network-doctor");

const NOW = Date.UTC(2026, 10, 27); // 2026-11-27

// ---------- health report: parsers ----------

test("windows firewall: all profiles on -> PASS", () => {
  const r = health.parseWindowsFirewall("Domain=True\r\nPrivate=True\r\nPublic=True\r\n");
  assert.strictEqual(r.pass, true);
});

test("windows firewall: a profile off -> FAIL naming it", () => {
  const r = health.parseWindowsFirewall("Domain=True\nPrivate=True\nPublic=False\n");
  assert.strictEqual(r.pass, false);
  assert.match(r.detail, /Public/);
});

test("windows firewall: empty output -> FAIL", () => {
  assert.strictEqual(health.parseWindowsFirewall("").pass, false);
});

test("mac firewall", () => {
  assert.strictEqual(health.parseMacFirewall("Firewall is enabled. (State = 1)").pass, true);
  assert.strictEqual(health.parseMacFirewall("Firewall is disabled. (State = 0)").pass, false);
});

test("linux firewall", () => {
  assert.strictEqual(health.parseLinuxFirewall({ ufw: "active\n", firewalld: "inactive\n" }).pass, true);
  assert.strictEqual(health.parseLinuxFirewall({ ufw: "inactive\n", firewalld: "" }).pass, false);
});

test("last update: recent -> PASS, old -> FAIL, garbage -> FAIL", () => {
  assert.strictEqual(health.parseLastUpdate("2026-11-10\r\n", NOW).pass, true);
  assert.strictEqual(health.parseLastUpdate("2026-01-05\r\n", NOW).pass, false);
  assert.strictEqual(health.parseLastUpdate("nothing", NOW).pass, false);
});

test("mac and apt updates", () => {
  assert.strictEqual(health.parseMacUpdates("No new software available.").pass, true);
  assert.strictEqual(health.parseMacUpdates("Software Update found:\n* Label: macOS 15.1\n").pass, false);
  assert.strictEqual(health.parseAptUpdates("Listing...\n").pass, true);
  assert.strictEqual(health.parseAptUpdates("Listing...\nbash/stable 5.2 amd64 [upgradable from: 5.1]\n").pass, false);
});

test("disk: 25% free -> PASS, 5% free -> FAIL", () => {
  const GB = 1024 ** 3;
  assert.strictEqual(health.describeDisk({ free: 100 * GB, total: 400 * GB }).pass, true);
  assert.strictEqual(health.describeDisk({ free: 20 * GB, total: 400 * GB }).pass, false);
});

// ---------- health report: whole run with a fake runner ----------

test("runChecks on fake Windows output", () => {
  const GB = 1024 ** 3;
  const run = (cmd, args) => {
    const script = args[args.length - 1];
    if (/Get-NetFirewallProfile/.test(script)) return "Domain=True\nPrivate=True\nPublic=True\n";
    if (/Get-HotFix/.test(script)) return "2026-11-15\n";
    throw new Error("unexpected command: " + cmd);
  };
  const results = health.runChecks({
    platform: "win32", run, now: NOW,
    osInfo: () => ({ name: "Windows 11 Pro", release: "10.0.26200", arch: "x64" }),
    diskStat: () => ({ free: 200 * GB, total: 500 * GB })
  });
  assert.deepStrictEqual(results.map(r => r.name), ["Operating system", "Free disk space", "Firewall", "Updates"]);
  assert.ok(results.every(r => r.pass));
  assert.match(health.formatReport(results), /^PASS {2}Operating system/);
});

test("runChecks: a failing command becomes FAIL, not a crash", () => {
  const run = () => { throw new Error("access denied"); };
  const results = health.runChecks({
    platform: "win32", run, now: NOW,
    osInfo: () => ({ name: "Windows", release: "1", arch: "x64" }),
    diskStat: () => ({ free: 1, total: 100 })
  });
  const fw = results.find(r => r.name === "Firewall");
  assert.strictEqual(fw.pass, false);
  assert.match(fw.detail, /could not determine/);
  assert.match(health.formatReport(results), /FAIL {2}Firewall/);
});

// ---------- network doctor: parsers ----------

test("gateway parsing", () => {
  assert.strictEqual(net.parseLinuxGateway("default via 192.168.1.1 dev eth0 proto dhcp\n"), "192.168.1.1");
  assert.strictEqual(net.parseMacGateway("   route to: default\n    gateway: 10.0.0.1\n"), "10.0.0.1");
  assert.strictEqual(net.parseWindowsGateway("192.168.0.1\r\n"), "192.168.0.1");
  assert.strictEqual(net.parseWindowsGateway("0.0.0.0\r\n"), null);
  assert.strictEqual(net.parseLinuxGateway(""), null);
});

test("ping parsing: replies vs unreachable vs timeout", () => {
  assert.strictEqual(net.pingSucceeded("Reply from 1.1.1.1: bytes=32 time=12ms TTL=57"), true);
  assert.strictEqual(net.pingSucceeded("64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=11 ms"), true);
  assert.strictEqual(net.pingSucceeded("Reply from 192.168.1.50: Destination host unreachable."), false);
  assert.strictEqual(net.pingSucceeded("Request timed out."), false);
  assert.strictEqual(net.pingSucceeded(""), false);
});

// ---------- network doctor: whole run with a fake runner ----------

const REPLY = "Reply from X: bytes=32 time=4ms TTL=64";
const TIMEOUT = "Request timed out.";

function fakeRun(responses) {
  // responses: { gateway, router, internet }
  return (cmd, args) => {
    if (cmd === "powershell") return responses.gateway;
    if (cmd === "ping") {
      const host = args[args.length - 1];
      const out = host === "1.1.1.1" ? responses.internet : responses.router;
      if (!/TTL=/.test(out)) { const e = new Error("ping failed"); e.stdout = out; throw e; }
      return out;
    }
    throw new Error("unexpected command: " + cmd);
  };
}

const okLookup = async () => ({ address: "93.184.216.34" });
const badLookup = async () => { const e = new Error("ENOTFOUND"); e.code = "ENOTFOUND"; throw e; };

test("network doctor: everything works", async () => {
  const steps = await net.runSteps({
    platform: "win32", lookup: okLookup,
    run: fakeRun({ gateway: "192.168.1.1\n", router: REPLY, internet: REPLY })
  });
  assert.ok(steps.every(s => s.pass));
  assert.match(net.formatReport(steps), /All steps passed/);
});

test("network doctor: router down -> first failing step is 1", async () => {
  const steps = await net.runSteps({
    platform: "win32", lookup: badLookup,
    run: fakeRun({ gateway: "192.168.1.1\n", router: TIMEOUT, internet: TIMEOUT })
  });
  assert.deepStrictEqual(steps.map(s => s.pass), [false, false, false]);
  const report = net.formatReport(steps);
  assert.match(report, /First failing step: 1\. Router/);
  assert.match(report, /FAIL {2}1\./);
});

test("network doctor: router ok, internet down -> step 2", async () => {
  const steps = await net.runSteps({
    platform: "win32", lookup: badLookup,
    run: fakeRun({ gateway: "192.168.1.1\n", router: REPLY, internet: TIMEOUT })
  });
  assert.deepStrictEqual(steps.map(s => s.pass), [true, false, false]);
  assert.match(net.formatReport(steps), /First failing step: 2\. Internet/);
});

test("network doctor: only DNS broken -> step 3", async () => {
  const steps = await net.runSteps({
    platform: "win32", lookup: badLookup, website: "northlight.example",
    run: fakeRun({ gateway: "192.168.1.1\n", router: REPLY, internet: REPLY })
  });
  assert.deepStrictEqual(steps.map(s => s.pass), [true, true, false]);
  assert.match(net.formatReport(steps), /First failing step: 3\. Website name \(northlight\.example\)/);
});

test("network doctor: router ignores ping but internet works -> router PASS", async () => {
  const steps = await net.runSteps({
    platform: "win32", lookup: okLookup,
    run: fakeRun({ gateway: "192.168.1.254\n", router: TIMEOUT, internet: REPLY })
  });
  assert.ok(steps.every(s => s.pass));
  assert.match(steps[0].detail, /ignores ping/);
});

test("network doctor: no gateway found -> step 1 FAIL", async () => {
  const steps = await net.runSteps({
    platform: "win32", lookup: okLookup,
    run: fakeRun({ gateway: "", router: REPLY, internet: REPLY })
  });
  assert.strictEqual(steps[0].pass, false);
  assert.match(steps[0].detail, /no default gateway/);
});
