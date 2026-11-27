(function () {
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function $(id) { return document.getElementById(id); }
  // Site-wide activity log (sitelog.js). Only counts and topics are logged, never what the visitor typed.
  function slog(event, detail, level) { if (window.NorthlightLog) window.NorthlightLog.add("site", event, detail, { level: level || "info" }); }

  // ---------- mobile menu ----------
  var toggle = $("nav-toggle"), nav = $("nav");
  function setMenu(open) {
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("open", open);
  }
  toggle.addEventListener("click", function () { setMenu(toggle.getAttribute("aria-expanded") !== "true"); });
  nav.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") setMenu(false); });

  // ---------- scroll reveal ----------
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    reveals.forEach(function (r) { io.observe(r); });
  } else {
    reveals.forEach(function (r) { r.classList.add("in"); });
  }

  // ---------- FAQ accordion ----------
  document.querySelectorAll(".faq-q").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var item = btn.closest(".faq-item");
      var open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", String(open));
      item.classList.toggle("open", open);
      slog("faq.toggled", "FAQ \"" + btn.childNodes[0].textContent.trim() + "\" " + (open ? "opened" : "closed"));
    });
  });

  // ---------- card spotlight follows the pointer ----------
  document.querySelectorAll(".card").forEach(function (card) {
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });

  // ---------- aurora (plain canvas, no libraries) ----------
  // Layered ribbons of light drift across the hero and bend toward the pointer or finger.
  (function aurora() {
    var canvas = $("aurora");
    var hero = canvas && canvas.parentElement;
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    var SCALE = 0.5;                       // render at half size: soft look, cheap on phones
    var RIBBONS = [
      { c: [78, 201, 160], y: 0.20, amp: 0.06, f: 2.1, s: 0.35, a: 0.34 },
      { c: [111, 183, 255], y: 0.27, amp: 0.07, f: 1.6, s: -0.28, a: 0.26 },
      { c: [167, 139, 250], y: 0.34, amp: 0.06, f: 2.6, s: 0.22, a: 0.2 },
      { c: [217, 178, 76], y: 0.40, amp: 0.05, f: 1.9, s: -0.18, a: 0.16 }
    ];
    var w = 0, h = 0, running = false, raf = 0, visible = true;
    var ptr = { x: 0.7, y: 0.4, tx: 0.7, ty: 0.4 };

    function resize() {
      var r = hero.getBoundingClientRect();
      w = Math.max(2, Math.round(r.width * SCALE));
      h = Math.max(2, Math.round(r.height * SCALE));
      canvas.width = w; canvas.height = h;
      if (!running) draw(2.2);
    }

    function draw(t) {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      var step = 6;
      RIBBONS.forEach(function (rb, i) {
        var base = h * rb.y + (ptr.y - 0.5) * h * 0.16 * (1 + i * 0.25);
        var amp = h * rb.amp;
        var curtain = h * (0.2 + i * 0.012);
        var top = [], bot = [];
        for (var x = 0; x <= w + step; x += step) {
          var u = x / w;
          var bump = Math.exp(-Math.pow((u - ptr.x) / 0.2, 2));           // light gathers near the pointer
          var y = base
            + Math.sin(u * rb.f * Math.PI * 2 + t * rb.s + i) * amp
            + Math.sin(u * rb.f * 5.3 - t * rb.s * 1.7) * amp * 0.35
            - bump * h * 0.09;
          var ch = curtain * (0.8 + 0.25 * Math.sin(u * 7 + t * 0.6 + i * 2)) * (1 + bump * 0.5);
          top.push([x, y]); bot.push([x, y + ch]);
        }
        var g = ctx.createLinearGradient(0, base - amp, 0, base + curtain + amp);
        var c = rb.c;
        g.addColorStop(0, "rgba(" + c + ",0)");
        g.addColorStop(0.14, "rgba(" + c + "," + rb.a + ")");
        g.addColorStop(1, "rgba(" + c + ",0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(top[0][0], top[0][1]);
        for (var k = 1; k < top.length; k++) ctx.lineTo(top[k][0], top[k][1]);
        for (var m = bot.length - 1; m >= 0; m--) ctx.lineTo(bot[m][0], bot[m][1]);
        ctx.closePath();
        ctx.fill();
      });
    }

    function frame(ms) {
      ptr.x += (ptr.tx - ptr.x) * 0.05;
      ptr.y += (ptr.ty - ptr.y) * 0.05;
      draw(ms / 1000);
      raf = running ? requestAnimationFrame(frame) : 0;
    }
    function start() { if (!running && visible && !document.hidden && !reduceMotion) { running = true; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

    hero.addEventListener("pointermove", function (e) {
      var r = hero.getBoundingClientRect();
      ptr.tx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      ptr.ty = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (en) { visible = en[0].isIntersecting; visible ? start() : stop(); }).observe(hero);
    }
    document.addEventListener("visibilitychange", function () { document.hidden ? stop() : start(); });
    window.addEventListener("resize", resize);
    resize();
    start();
  })();

  // ---------- contact form -> help desk ticket ----------
  // The form no longer writes to storage itself: automation.js runs the rules in rules.json.
  var form = $("contact-form");
  var fields = {
    name: { el: $("name"), err: $("name-err"), label: "Your name" },
    email: { el: $("email"), err: $("email-err"), label: "Email address" },
    topic: { el: $("topic"), err: $("topic-err"), label: "What do you need?" },
    message: { el: $("message"), err: $("message-err"), label: "Your message" }
  };

  function clean(s) { return s.replace(/\s+/g, " ").trim(); }

  function check(key) {
    var v = fields[key].el.value;
    if (key === "name") {
      v = clean(v);
      if (!v) return "Please enter your name.";
      if (v.length < 2) return "Your name needs at least 2 characters.";
    }
    if (key === "email") {
      v = v.trim();
      if (!v) return "Please enter your email address.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "That email address does not look right. Use the form name@company.com.";
    }
    if (key === "topic" && !v) return "Please choose a topic so we can send your message to the right person.";
    if (key === "message") {
      var m = v.trim();
      if (!m) return "Please tell us how we can help.";
      if (m.length < 10) return "Please write at least 10 characters so we understand your request. You have written " + m.length + ".";
    }
    return "";
  }

  function showError(key, msg, shake) {
    var f = fields[key];
    f.err.textContent = msg;
    f.err.hidden = !msg;
    if (msg) {
      f.el.setAttribute("aria-invalid", "true");
      if (shake && !reduceMotion) { f.el.classList.remove("shake"); void f.el.offsetWidth; f.el.classList.add("shake"); }
    } else {
      f.el.removeAttribute("aria-invalid");
    }
  }

  Object.keys(fields).forEach(function (key) {
    var el = fields[key].el;
    el.addEventListener("blur", function () { if (el.value !== "" || el.getAttribute("aria-invalid")) showError(key, check(key), false); });
    el.addEventListener("input", function () { if (el.getAttribute("aria-invalid") && !check(key)) showError(key, "", false); });
    el.addEventListener("change", function () { if (el.getAttribute("aria-invalid") && !check(key)) showError(key, "", false); });
  });

  function showSummary(problems) {
    var box = $("summary");
    box.replaceChildren();
    if (!problems.length) { box.hidden = true; return; }
    box.hidden = false;
    var p = document.createElement("p");
    p.textContent = problems.length === 1 ? "Please fix 1 thing before sending:" : "Please fix " + problems.length + " things before sending:";
    var ul = document.createElement("ul");
    problems.forEach(function (pr) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#" + fields[pr.key].el.id;
      a.textContent = fields[pr.key].label + ": " + pr.msg;
      a.addEventListener("click", function (e) { e.preventDefault(); fields[pr.key].el.focus(); });
      li.appendChild(a);
      ul.appendChild(li);
    });
    box.appendChild(p);
    box.appendChild(ul);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var problems = [];
    Object.keys(fields).forEach(function (key) {
      var msg = check(key);
      showError(key, msg, true);
      if (msg) problems.push({ key: key, msg: msg });
    });
    showSummary(problems);
    if (problems.length) {
      slog("form.invalid", "Contact form not sent: " + problems.length + " field problem(s) shown", "warn");
      fields[problems[0].key].el.focus();
      return;
    }

    var btn = $("send");
    slog("form.submitted", "Contact form sent (topic: " + fields.topic.el.value + ")");
    var data = {
      name: clean(fields.name.el.value),
      email: fields.email.el.value.trim(),
      topic: fields.topic.el.value,
      message: fields.message.el.value.trim(),
      urgency: Number($("urgency").value) || 2
    };
    btn.disabled = true;
    btn.firstChild.textContent = "Sending… ";

    function reset() { btn.disabled = false; btn.firstChild.textContent = "Send message "; }

    // The automation rules (rules.json) decide what happens: CRM lead, help desk ticket, urgent alert.
    var runner = window.Automation ? window.Automation.run("form.submitted", data) : Promise.reject(new Error("automation.js did not load"));
    runner.then(function (ctx) {
      var ticket = ctx.ticket;
      if (!ticket && ctx.errors.length) throw new Error(ctx.errors[0].message);
      $("success-title").textContent = "Thank you, " + data.name.split(" ")[0] + "!";
      if (ticket) {
        $("success-text").textContent = "Your request is ticket #" + ticket.id + " in our help desk. We will reply to " + data.email + " within one working day. Keep that number: with your email it lets you follow progress.";
        $("track-link").href = "track.html?ref=" + ticket.id;
        $("track-link").hidden = false;
      } else {
        $("success-text").textContent = "We have your message and will reply to " + data.email + " within one working day.";
        $("track-link").hidden = true;
      }
      form.hidden = true;
      $("success").hidden = false;
      $("success").focus();
      reset();
    }).catch(function () {
      reset();
      showSummary([{ key: "message", msg: "We could not save your request because this browser blocks storage. Please email hello@northlight.example instead." }]);
    });
  });

  $("again").addEventListener("click", function () {
    form.reset();
    Object.keys(fields).forEach(function (k) { showError(k, "", false); });
    showSummary([]);
    $("success").hidden = true;
    form.hidden = false;
    fields.name.el.focus();
  });
})();
