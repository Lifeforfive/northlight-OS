(function () {
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- menu ----------
  var toggle = document.getElementById("sx-toggle"), nav = document.getElementById("sx-nav");
  if (toggle && nav) {
    var setMenu = function (open) {
      toggle.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("open", open);
    };
    toggle.addEventListener("click", function () { setMenu(toggle.getAttribute("aria-expanded") !== "true"); });
    nav.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setMenu(false); });
  }

  // ---------- header shadow once you scroll ----------
  var header = document.querySelector(".sx-header");
  if (header) {
    var onScroll = function () { header.classList.toggle("sx-scrolled", window.scrollY > 8); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // ---------- pointer spotlight on cards (works for elements that are re-rendered, too) ----------
  var SPOT = ".card, .tile, .tool, .ticket";
  document.addEventListener("pointermove", function (e) {
    var t = e.target.closest && e.target.closest(SPOT);
    if (!t) return;
    var r = t.getBoundingClientRect();
    t.style.setProperty("--mx", (e.clientX - r.left) + "px");
    t.style.setProperty("--my", (e.clientY - r.top) + "px");
  }, { passive: true });

  // ---------- aurora banner (plain canvas, no libraries) ----------
  // Each page picks a colour mood with data-palette.
  var PALETTES = {
    helpdesk: [[78, 201, 160], [111, 183, 255], [78, 201, 160], [217, 178, 76]],
    crm:      [[217, 178, 76], [245, 185, 66], [78, 201, 160], [111, 183, 255]],
    tools:    [[111, 183, 255], [78, 201, 160], [111, 183, 255], [167, 139, 250]],
    staff:    [[167, 139, 250], [111, 183, 255], [167, 139, 250], [217, 178, 76]],
    track:    [[111, 183, 255], [78, 201, 160], [217, 178, 76], [111, 183, 255]]
  };
  var SHAPES = [
    { y: 0.30, amp: 0.09, f: 1.9, s: 0.35, a: 0.34 },
    { y: 0.42, amp: 0.10, f: 1.5, s: -0.28, a: 0.26 },
    { y: 0.54, amp: 0.09, f: 2.4, s: 0.22, a: 0.2 },
    { y: 0.64, amp: 0.08, f: 1.8, s: -0.18, a: 0.16 }
  ];

  function aurora(canvas) {
    var banner = canvas.parentElement;
    if (!canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    var colors = PALETTES[canvas.getAttribute("data-palette")] || PALETTES.helpdesk;
    var SCALE = 0.5;
    var w = 0, h = 0, running = false, raf = 0, visible = true;
    var ptr = { x: 0.75, y: 0.4, tx: 0.75, ty: 0.4 };

    function resize() {
      var r = banner.getBoundingClientRect();
      w = Math.max(2, Math.round(r.width * SCALE));
      h = Math.max(2, Math.round(r.height * SCALE));
      canvas.width = w; canvas.height = h;
      if (!running) draw(2.2);
    }

    function draw(t) {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      var step = 6;
      SHAPES.forEach(function (rb, i) {
        var c = colors[i];
        var base = h * rb.y + (ptr.y - 0.5) * h * 0.2;
        var amp = h * rb.amp;
        var curtain = h * 0.34;
        var top = [], bot = [];
        for (var x = 0; x <= w + step; x += step) {
          var u = x / w;
          var bump = Math.exp(-Math.pow((u - ptr.x) / 0.2, 2));
          var y = base
            + Math.sin(u * rb.f * Math.PI * 2 + t * rb.s + i) * amp
            + Math.sin(u * rb.f * 5.3 - t * rb.s * 1.7) * amp * 0.35
            - bump * h * 0.1;
          var ch = curtain * (0.8 + 0.25 * Math.sin(u * 7 + t * 0.6 + i * 2)) * (1 + bump * 0.5);
          top.push([x, y]); bot.push([x, y + ch]);
        }
        var g = ctx.createLinearGradient(0, base - amp, 0, base + curtain + amp);
        g.addColorStop(0, "rgba(" + c + ",0)");
        g.addColorStop(0.16, "rgba(" + c + "," + rb.a + ")");
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

    banner.addEventListener("pointermove", function (e) {
      var r = banner.getBoundingClientRect();
      ptr.tx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      ptr.ty = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (en) { visible = en[0].isIntersecting; visible ? start() : stop(); }).observe(banner);
    }
    document.addEventListener("visibilitychange", function () { document.hidden ? stop() : start(); });
    window.addEventListener("resize", resize);
    resize();
    start();
  }

  Array.prototype.forEach.call(document.querySelectorAll(".sx-aurora"), aurora);

  // The staff-page ring drains over 30 s, in step with the real clock (same 30 s steps as the TOTP code).
  Array.prototype.forEach.call(document.querySelectorAll(".sx-ring"), function (ring) {
    ring.style.animationDelay = "-" + ((Date.now() / 1000) % 30).toFixed(2) + "s";
  });
})();
