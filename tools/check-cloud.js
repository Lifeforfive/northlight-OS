"use strict";
/*
 * Checks northlight.cloud.json: every resource needs the tags owner, env and cost-center,
 * and every name must follow the cloud naming rules and our naming convention.
 * READ-ONLY: it only reads the file. It never talks to a cloud and changes nothing.
 *
 *   node tools/check-cloud.js [path-to-file]
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed, 2 = the file could not be read.
 *
 * The same rules also run in the browser (cloud.html loads this file), so the Cloud page and the
 * deploy check always agree. In the browser it exposes window.NorthlightCloudCheck.
 */
(function (root) {
const isNode = typeof require === "function" && typeof module !== "undefined";
const fs = isNode ? require("fs") : null;
const path = isNode ? require("path") : null;

const REQUIRED_TAGS = ["owner", "env", "cost-center"];
const ENVS = ["dev", "test", "prod"];
const COST_CENTER = /^CC-\d{4}$/;
// same strictness as the website's email check (security.js): no spaces or markup characters like < > " ( ) , ; :
const EMAIL = /^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const PRODUCT = "northlight";

// Naming rules per resource type (modelled on common cloud limits) plus our convention.
const TYPES = {
  resourceGroup: {
    label: "resource group", prefix: "rg-", min: 1, max: 90,
    chars: /^[A-Za-z0-9_().-]+$/, charsText: "letters, numbers, underscores, parentheses, hyphens and periods",
    notEnd: "."
  },
  webApp: {
    label: "web app", prefix: "app-", min: 2, max: 60,
    chars: /^[A-Za-z0-9-]+$/, charsText: "letters, numbers and hyphens",
    notStart: "-", notEnd: "-"
  },
  storageAccount: {
    label: "storage account", prefix: "st", min: 3, max: 24,
    chars: /^[a-z0-9]+$/, charsText: "lowercase letters and numbers only"
  }
};

function isText(v) { return typeof v === "string"; }

// Returns a list of problems for one name (empty list = the name is fine).
function nameProblems(res, rule, env) {
  const name = res.name;
  const out = [];
  if (!isText(name) || name === "") return ['has no name'];
  if (name.length < rule.min || name.length > rule.max) {
    out.push('name "' + name + '" is ' + name.length + " characters, a " + rule.label + " name must be " + rule.min + " to " + rule.max);
  }
  if (!rule.chars.test(name)) out.push('name "' + name + '" has characters a ' + rule.label + " cannot use (allowed: " + rule.charsText + ")");
  if (rule.notStart && name.startsWith(rule.notStart)) out.push('name "' + name + '" cannot start with "' + rule.notStart + '"');
  if (rule.notEnd && name.endsWith(rule.notEnd)) out.push('name "' + name + '" cannot end with "' + rule.notEnd + '"');

  // our convention: <prefix>northlight[-]<env>, all lowercase
  if (name !== name.toLowerCase()) out.push('name "' + name + '" must be lowercase');
  if (!name.startsWith(rule.prefix)) out.push('name "' + name + '" must start with "' + rule.prefix + '" (a ' + rule.label + ")");
  if (name.toLowerCase().indexOf(PRODUCT) < 0) out.push('name "' + name + '" must contain "' + PRODUCT + '"');
  if (ENVS.indexOf(env) >= 0 && !name.endsWith(env)) out.push('name "' + name + '" must end with its env tag "' + env + '"');
  return out;
}

function tagProblems(tags) {
  const out = [];
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) return ['has no "tags" object'];
  REQUIRED_TAGS.forEach(function (t) {
    if (!Object.prototype.hasOwnProperty.call(tags, t)) out.push('missing tag "' + t + '"');
    else if (!isText(tags[t]) || tags[t].trim() === "") out.push('tag "' + t + '" is empty');
    else if (tags[t] !== tags[t].trim()) out.push('tag "' + t + '" has spaces around its value');
  });
  const ok = function (t) { return isText(tags[t]) && tags[t].trim() !== ""; };
  if (ok("env") && ENVS.indexOf(tags.env) < 0) out.push('tag "env" is "' + tags.env + '", allowed: ' + ENVS.join(", "));
  if (ok("cost-center") && !COST_CENTER.test(tags["cost-center"])) out.push('tag "cost-center" is "' + tags["cost-center"] + '", expected a value like CC-1234');
  if (ok("owner") && !EMAIL.test(tags.owner)) out.push('tag "owner" is "' + tags.owner + '", expected an email address like team@company.example');
  return out;
}

// Returns [{ scope, check, pass, message }]
function validate(doc) {
  const checks = [];
  const add = (scope, check, pass, message) => checks.push({ scope: scope, check: check, pass: pass, message: message });
  // one PASS line if there are no problems, otherwise one FAIL line per problem
  const group = (scope, check, problems, okMessage) => {
    if (!problems.length) add(scope, check, true, okMessage);
    else problems.forEach(p => add(scope, check, false, p));
  };

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    add("file", "structure", false, "the file must contain a JSON object");
    return checks;
  }
  if (doc.schemaVersion !== 1) add("file", "structure", false, "schemaVersion must be 1");
  if (!Array.isArray(doc.resources) || !doc.resources.length) {
    add("file", "structure", false, 'the "resources" list is missing or empty');
    return checks;
  }
  add("file", "structure", true, doc.resources.length + " resource(s) listed");

  const groups = doc.resources.filter(r => r && r.type === "resourceGroup");
  group("file", "resource group", groups.length === 1 ? [] : ["expected exactly one resource group, found " + groups.length], "exactly one resource group");

  const seen = {};
  const groupEnv = groups.length === 1 && groups[0].tags ? groups[0].tags.env : undefined;
  const groupNames = groups.map(g => g.name);

  doc.resources.forEach(function (res, i) {
    const scope = res && isText(res.name) && res.name ? res.name : "resource #" + (i + 1);
    if (!res || typeof res !== "object") { add(scope, "structure", false, "is not an object"); return; }
    const rule = TYPES[res.type];
    if (!rule) { add(scope, "type", false, 'unknown type "' + res.type + '" (allowed: ' + Object.keys(TYPES).join(", ") + ")"); return; }

    const env = res.tags && typeof res.tags === "object" ? res.tags.env : undefined;
    const np = nameProblems(res, rule, env);
    if (isText(res.name) && res.name) {
      if (seen[res.name.toLowerCase()]) np.push('name "' + res.name + '" is used twice');
      seen[res.name.toLowerCase()] = true;
    }
    group(scope, "name", np, rule.label + " name follows the rules (" + String(res.name || "").length + " characters)");
    group(scope, "tags", tagProblems(res.tags), "owner, env and cost-center are set");

    const links = [];
    if (res.type !== "resourceGroup") {
      if (!isText(res.resourceGroup) || groupNames.indexOf(res.resourceGroup) < 0) links.push('resourceGroup "' + res.resourceGroup + '" is not in this file');
      else if (groupEnv && env && env !== groupEnv) links.push('env "' + env + '" differs from its resource group (' + groupEnv + ")");
    }
    if (res.type !== "resourceGroup") group(scope, "group", links, "in " + res.resourceGroup + ", same env");
  });
  return checks;
}

function format(checks) {
  const failed = checks.filter(c => !c.pass).length;
  const lines = checks.map(c => (c.pass ? "PASS" : "FAIL") + "  " + c.scope.padEnd(22) + c.check.padEnd(16) + c.message);
  lines.push("", failed ? failed + " of " + checks.length + " checks FAILED." : "All " + checks.length + " checks passed.");
  return lines.join("\n");
}

function main(argv) {
  const file = path.resolve(argv[2] || path.join(__dirname, "..", "northlight.cloud.json"));
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error("Cannot read " + file + ": " + e.message);
    return 2;
  }
  const checks = validate(doc);
  console.log("Cloud description check (read-only): " + path.basename(file) + "\n");
  console.log(format(checks));
  const failed = checks.filter(c => !c.pass);
  if (process.env.GITHUB_ACTIONS) {
    // shows each problem as an annotation on the workflow run
    failed.forEach(c => console.log("::error file=" + path.basename(file) + "::" + c.scope + " (" + c.check + "): " + c.message));
  }
  return failed.length ? 1 : 0;
}

const api = { validate, format, nameProblems, tagProblems, REQUIRED_TAGS, ENVS, TYPES };
if (isNode && require.main === module) process.exitCode = main(process.argv);
if (isNode) module.exports = api;
if (typeof window !== "undefined") window.NorthlightCloudCheck = api;
})(typeof window !== "undefined" ? window : globalThis);
