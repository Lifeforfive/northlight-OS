(function () {
  "use strict";

  // Customer request tracker. Looks a request up in the same localStorage the CRM and help desk use.
  // Demo only: it can only see requests created in this browser, and all data is fake.
  var CRM_KEY = "northlight-crm-v1";
  var HD_KEY = "northlight-helpdesk-v2";
  var HOUR = 60 * 60 * 1000, MIN = 60 * 1000;
  var HD_TARGET = { 1: 1 * HOUR, 2: 4 * HOUR, 3: 24 * HOUR };
  var STEPS = [
    { name: "Received", note: "We have your request" },
    { name: "In progress", note: "Someone is working on it" },
    { name: "Resolved", note: "All done" }
  ];
  var TONES = ["blue", "gold", "teal"];

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // ---------- reading the stored data ----------

  function readCases() {
    try { var d = JSON.parse(localStorage.getItem(CRM_KEY)); return d && Array.isArray(d.cases) ? d.cases : []; } catch (e) { return []; }
  }
  function readTickets() {
    try { var d = JSON.parse(localStorage.getItem(HD_KEY)); return Array.isArray(d) ? d : []; } catch (e) { return []; }
  }

  function demoRequest(now) {
    return {
      kind: "sample", ref: "DEMO", subject: "Sample request: logo files in the wrong format", step: 1,
      priorityLabel: "High priority", opened: now - 3 * HOUR, due: now + 90 * MIN,
      events: [
        { t: now - 3 * HOUR, text: "Request received. A team member will pick this up shortly." },
        { t: now - 150 * MIN, text: "We are working on it. Our designer is exporting the SVG and PNG versions you asked for." },
        { t: now - 40 * MIN, text: "First versions are ready for a final check. We will send them to you today." }
      ]
    };
  }

  // Returns a normalised request when the reference AND the email both match, otherwise null.
  function find(refInput, emailInput) {
    var now = Date.now();
    var ref = refInput.trim().toUpperCase().replace(/^#/, "");
    var email = emailInput.trim().toLowerCase();
    if (!ref || !email) return null;

    if (ref === "DEMO") return email === "demo@example.com" ? demoRequest(now) : null;

    var m = /^C-?(\d+)$/.exec(ref);
    if (m) {
      var c = readCases().filter(function (x) { return String(x.ref || "").toUpperCase() === "C-" + m[1] && String(x.email || "").trim().toLowerCase() === email; })[0];
      if (!c) return null;
      return {
        kind: "case", ref: c.ref, subject: c.subject,
        step: c.status === "Closed" ? 2 : c.status === "In progress" ? 1 : 0,
        priorityLabel: c.priority === "High" ? "High priority" : c.priority === "Low" ? "Low priority" : "Standard priority",
        opened: c.created, due: c.due,
        events: (c.events || []).slice()
      };
    }

    var n = /^(?:T-?)?(\d+)$/.exec(ref);
    if (n) {
      var t = readTickets().filter(function (x) {
        if (String(x.id) !== n[1]) return false;
        var mail = x.email || ((/Reply to:\s*(\S+)/i.exec(x.issue || "") || [])[1] || "");
        return mail.trim().toLowerCase() === email;
      })[0];
      if (!t) return null;
      var pr = t.priority || 3;
      return {
        kind: "ticket", ref: "#" + t.id,
        subject: String(t.issue || "").replace(/^\[[^\]]*\]\s*/, "").split("\n")[0].slice(0, 110) || "Your request",
        step: t.status === "Resolved" ? 2 : t.status === "In progress" ? 1 : 0,
        priorityLabel: pr === 1 ? "Urgent" : pr === 2 ? "High priority" : "Standard priority",
        opened: t.created, due: t.created + (HD_TARGET[pr] || HD_TARGET[3]),
        events: [{ t: t.created, text: "Request received. Your reference is #" + t.id + "." }]
      };
    }
    return null;
  }

  // ---------- wording ----------

  function pad(n) { return String(n).padStart(2, "0"); }
  function when(ms) {
    var d = new Date(ms);
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) + ", " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function span(ms) {
    var m = Math.max(1, Math.round(ms / MIN));
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60), r = m % 60;
    if (h < 24) return h + " h" + (r ? " " + r + " min" : "");
    return Math.floor(h / 24) + " d " + (h % 24) + " h";
  }
  function rel(ms, now) { return ms >= now ? "in " + span(ms - now) : span(now - ms) + " ago"; }

  function nextStep(r, now) {
    if (r.step === 2) return "This request is resolved. If something is still not right, contact us and quote your reference.";
    var late = now > r.due;
    var base = r.step === 0 ? "A team member will pick this up. " : "We are working on it. ";
    if (!late) return base + "We aim to respond by " + when(r.due) + " (" + rel(r.due, now) + ").";
    return base + "We aimed to respond by " + when(r.due) + " and we are running late. We are sorry. Your request is flagged so it gets attention first.";
  }

  // ---------- rendering ----------

  var current = null;      // {ref, email, signature} of the request on screen
  var tracker = $("result");

  function signature(r) { return r.step + "|" + r.events.length + "|" + (r.events[r.events.length - 1] || {}).t; }

  function render(r, opts) {
    var now = Date.now();
    var box = tracker;
    box.hidden = false;
    box.setAttribute("data-win", "request " + r.ref);
    box.setAttribute("data-tone", TONES[r.step]);
    box.replaceChildren();

    var head = el("div", "r-head");
    var h = el("h2", "", r.subject);
    h.id = "result-h"; h.tabIndex = -1;
    head.appendChild(h);
    var chips = el("div", "chips");
    chips.appendChild(el("span", "chip", "Reference " + r.ref));
    chips.appendChild(el("span", "chip", r.priorityLabel));
    chips.appendChild(el("span", "chip", "Opened " + when(r.opened)));
    if (r.kind === "sample") chips.appendChild(el("span", "chip sample", "Sample request"));
    head.appendChild(chips);
    box.appendChild(head);

    var ol = el("ol", "stepper");
    ol.setAttribute("aria-label", "Progress");
    STEPS.forEach(function (s, i) {
      var li = el("li", i < r.step ? "done reached" : i === r.step ? (r.step === 2 ? "done current reached" : "current reached") : "");
      if (i === r.step) li.setAttribute("aria-current", "step");
      li.appendChild(el("strong", "", s.name));
      li.appendChild(el("span", "", s.note));
      ol.appendChild(li);
    });
    box.appendChild(ol);

    var msg = el("p", "next" + (r.step < 2 && now > r.due ? " late" : ""));
    msg.appendChild(el("b", "", "What happens next: "));
    msg.appendChild(document.createTextNode(nextStep(r, now)));
    box.appendChild(msg);

    box.appendChild(el("h3", "sub", "Updates"));
    var tl = el("ul", "tl");
    r.events.slice().sort(function (a, b) { return b.t - a.t; }).forEach(function (e) {
      var li = el("li");
      var time = el("time", "", when(e.t) + " · " + rel(e.t, now));
      time.title = new Date(e.t).toLocaleString();
      li.appendChild(time);
      li.appendChild(el("p", "", e.text));
      tl.appendChild(li);
    });
    box.appendChild(tl);

    var row = el("div", "actions");
    var again = el("button", "btn", "Check another request");
    again.type = "button";
    again.onclick = function () { reset(); };
    var contact = el("a", "btn", "Contact us");
    contact.href = "index.html#contact";
    row.appendChild(again);
    row.appendChild(contact);
    box.appendChild(row);

    current.signature = signature(r);
    if (!opts || !opts.quiet) {
      h.focus({ preventScroll: true });
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    // grow the progress line after the first paint (background refreshes skip the animation)
    if (opts && opts.quiet) ol.classList.add("go");
    else requestAnimationFrame(function () { requestAnimationFrame(function () { ol.classList.add("go"); }); });
  }

  function reset() {
    current = null;
    tracker.hidden = true;
    tracker.replaceChildren();
    $("lookup-window").hidden = false;
    $("ref").focus();
  }

  // ---------- form ----------

  var refEl = $("ref"), emailEl = $("email"), refErr = $("ref-err"), emailErr = $("email-err"), formErr = $("form-err");

  function setErr(input, box, msg) {
    box.textContent = msg; box.hidden = !msg;
    if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  }
  function checkRef() {
    var v = refEl.value.trim();
    if (!v) return "Please enter your reference, for example C-1001 or 1013.";
    if (!/^(#|T-?)?\d+$/i.test(v) && !/^C-?\d+$/i.test(v) && v.toUpperCase() !== "DEMO") return "That does not look like a reference. It looks like C-1001 or 1013.";
    return "";
  }
  function checkEmail() {
    var v = emailEl.value.trim();
    if (!v) return "Please enter the email address you used for your request.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "That email address does not look right. Use the form name@company.com.";
    return "";
  }
  refEl.addEventListener("input", function () { if (refEl.getAttribute("aria-invalid") && !checkRef()) setErr(refEl, refErr, ""); });
  emailEl.addEventListener("input", function () { if (emailEl.getAttribute("aria-invalid") && !checkEmail()) setErr(emailEl, emailErr, ""); });

  $("lookup").addEventListener("submit", function (e) {
    e.preventDefault();
    formErr.hidden = true;
    var a = checkRef(), b = checkEmail();
    setErr(refEl, refErr, a); setErr(emailEl, emailErr, b);
    if (a || b) { (a ? refEl : emailEl).focus(); return; }
    var r = find(refEl.value, emailEl.value);
    if (!r) {
      formErr.hidden = false;
      formErr.textContent = "We could not find a request with that reference and email. Check both and try again, or contact us and we will help.";
      return;
    }
    current = { ref: refEl.value, email: emailEl.value, signature: "" };
    $("lookup-window").hidden = true;
    render(r);
  });

  $("demo").addEventListener("click", function () {
    refEl.value = "DEMO"; emailEl.value = "demo@example.com";
    setErr(refEl, refErr, ""); setErr(emailEl, emailErr, ""); formErr.hidden = true;
    $("lookup").requestSubmit();
  });

  // ---------- live updates ----------

  function refresh(quiet, announce) {
    if (!current) return;
    var r = find(current.ref, current.email);
    if (!r) return;
    var changed = signature(r) !== current.signature;
    if (changed || !quiet) render(r, { quiet: true });
    if (changed && announce) toast("Your request has a new update");
  }
  // Another tab (the CRM or help desk) changed the data: show it right away.
  window.addEventListener("storage", function (e) { if (e.key === CRM_KEY || e.key === HD_KEY) refresh(true, true); });
  // Keep "in 5 min" style wording fresh.
  setInterval(function () { if (current) { var r = find(current.ref, current.email); if (r) render(r, { quiet: true }); } }, 30 * 1000);

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 3200);
  }

  // Link from the CRM or the contact form: track.html?ref=C-1001
  var qs = new URLSearchParams(location.search);
  if (qs.get("ref")) { refEl.value = qs.get("ref").slice(0, 20); emailEl.focus(); }
})();
