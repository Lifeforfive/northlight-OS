/*
 * Shared security helpers: a strict email check, a password policy and a login throttle.
 * Loaded as window.NorthlightSecurity in the browser; also works in Node (for the tests).
 *
 * NOTE: this site has no server, so the throttle lives in the visitor's own browser. It stops
 * guessing through the page, but anyone who can edit localStorage can clear it. A real system
 * must enforce limits on the server.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NorthlightSecurity = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  // ---------------------------------------------------------------- email

  var ATEXT = "A-Za-z0-9!#$%&'*+/=?^_`{|}~-";           // characters allowed in the part before the @ (no < > " ( ) , ; : space)
  var EMAIL = new RegExp(
    "^[" + ATEXT + "]+(?:\\.[" + ATEXT + "]+)*@" +
    "(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,}$"
  );

  // Returns "" when the address is fine, otherwise a message for the visitor.
  function emailProblem(value) {
    var v = String(value == null ? "" : value).trim();
    if (!v) return "Please enter your email address.";
    if (v.length > 120 || v.split("@")[0].length > 64 || !EMAIL.test(v)) return "That email address does not look right. Use the form name@company.com.";
    return "";
  }

  // ---------------------------------------------------------------- passwords

  var COMMON = ("password passw0rd p@ssword passwort heslo 123456 1234567 12345678 123456789 1234567890 qwerty qwertz qwertyuiop qwerty123 " +
    "azerty abc123 abcdef abcdefgh letmein welcome welcome1 admin administrator root toor login master monkey dragon baseball football " +
    "iloveyou sunshine princess starwars trustno1 whatever freedom shadow superman batman hello hello123 secret changeme default guest " +
    "test testing test123 summer winter spring autumn michael jessica charlie ashley mustang computer internet iloveu 1q2w3e4r 1qaz2wsx " +
    "zaq12wsx asdfgh asdfghjkl zxcvbn zxcvbnm letmein123 northlight northlightstudio studio design pixel secure security").split(" ");
  var LEET = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

  // Three ways to read a password as plain letters: ignore digits and symbols, or undo common
  // character swaps (p@ssw0rd), with 1 read as "l" or as "i".
  function candidates(pw) {
    var lower = pw.toLowerCase();
    var swap = function (one) { return lower.replace(/[01345 7@$]/g, function (c) { return c === "1" ? one : LEET[c] || ""; }).replace(/[^a-z]/g, ""); };
    return [lower.replace(/[^a-z]/g, ""), swap("l"), swap("i")];
  }
  function isCommon(pw) {
    var lower = pw.toLowerCase();
    if (COMMON.indexOf(lower) >= 0) return true;
    return candidates(pw).some(function (c) {
      return c.length >= 4 && (COMMON.indexOf(c) >= 0 || COMMON.some(function (w) { return w.length >= 6 && c.indexOf(w) === 0 && c.length <= w.length + 2; }));
    });
  }
  // A run taken straight from the digits, the alphabet or a keyboard row (forwards or backwards).
  var RUNS = (function () {
    var rows = ["01234567890123456789", "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm", "qwertzuiopasdfghjklyxcvbnm"];
    return rows.concat(rows.map(function (r) { return r.split("").reverse().join(""); }));
  })();
  function isSequence(pw) {
    return pw.length >= 6 && RUNS.some(function (r) { return r.indexOf(pw) >= 0; });
  }

  // Returns a list of problems (empty = acceptable). `username` is optional.
  function passwordProblems(pw, username) {
    var out = [];
    pw = String(pw == null ? "" : pw);
    if (pw.length < 12) out.push("Use at least 12 characters (you have " + pw.length + ").");
    if (pw.length > 128) out.push("Use at most 128 characters.");
    var lower = pw.toLowerCase();
    if (isCommon(pw)) {
      out.push("That password is too common. Pick something only you would know, such as three random words.");
    }
    if (pw.length >= 4 && new Set(pw.split("")).size <= 3) out.push("That password repeats the same few characters.");
    else if (isSequence(lower)) out.push("That password is a simple sequence of characters.");
    if (username && String(username).length >= 3 && lower.indexOf(String(username).toLowerCase()) >= 0) out.push("Your password must not contain your username.");
    return out;
  }

  // ---------------------------------------------------------------- login throttle

  // Each subject (for example "pw:ada") may fail `freeAttempts` times, then it is locked for
  // baseMs, doubling with every further failure up to maxMs. Failures are forgotten after decayMs
  // without a new failure, and a success clears the subject. State is kept in `storage`.
  function createThrottle(opts) {
    opts = opts || {};
    var storage = opts.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    var KEY = opts.key || "northlight-throttle-v1";
    var now = opts.now || Date.now;
    var free = opts.freeAttempts == null ? 5 : opts.freeAttempts;
    var base = opts.baseMs || 30 * 1000;
    var max = opts.maxMs || 15 * 60 * 1000;
    var decay = opts.decayMs || 15 * 60 * 1000;

    function load() {
      try { var s = JSON.parse(storage.getItem(KEY)); return s && typeof s === "object" && !Array.isArray(s) ? s : {}; } catch (e) { return {}; }
    }
    // Failures are forgotten `decay` after the last failure OR after a lock ends, whichever is later.
    // (Otherwise waiting out one long lock would also wipe the counter and hand out fresh free guesses.)
    function quietFor(e, t) { return t - Math.max(e.last, e.until); }
    function save(state) {
      var t = now();
      Object.keys(state).forEach(function (k) { if (quietFor(state[k], t) > decay) delete state[k]; });   // forget old entries
      try { storage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    }
    function entry(state, subject) {
      var s = Object.prototype.hasOwnProperty.call(state, subject) ? state[subject] : null;
      return s && typeof s.n === "number" ? s : { n: 0, until: 0, last: 0 };
    }

    return {
      // { allowed: true } or { allowed: false, waitMs }
      check: function (subject) {
        var e = entry(load(), subject), t = now();
        return e.until > t ? { allowed: false, waitMs: e.until - t } : { allowed: true, waitMs: 0 };
      },
      // Record a failure. Returns the same shape as check(), so the caller can show the lock straight away.
      fail: function (subject) {
        var state = load(), e = entry(state, subject), t = now();
        if (quietFor(e, t) > decay) e.n = 0;
        e.n += 1; e.last = t;
        if (e.n > free) e.until = t + Math.min(max, base * Math.pow(2, e.n - free - 1));
        state[subject] = e; save(state);
        return e.until > t ? { allowed: false, waitMs: e.until - t } : { allowed: true, waitMs: 0, remaining: Math.max(0, free - e.n) };
      },
      success: function (subject) {
        var state = load();
        if (Object.prototype.hasOwnProperty.call(state, subject)) { delete state[subject]; save(state); }
      }
    };
  }

  function formatWait(ms) {
    var s = Math.ceil(ms / 1000);
    if (s < 60) return s + (s === 1 ? " second" : " seconds");
    var m = Math.ceil(s / 60);
    return m + (m === 1 ? " minute" : " minutes");
  }

  return { emailProblem: emailProblem, passwordProblems: passwordProblems, createThrottle: createThrottle, formatWait: formatWait, EMAIL: EMAIL };
});
