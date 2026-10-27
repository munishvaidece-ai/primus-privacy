/* Primus Privacy microsite: theme, menu, reveal-on-scroll, countdown. No dependencies. */
(function () {
  var d = document, root = d.documentElement;
  root.classList.add("js");
  var safe = function (f) { try { return f(); } catch (e) { return null; } };
  var saved = safe(function () { return localStorage.getItem("pp-theme"); });
  if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  var tb = d.getElementById("themeBtn");
  if (tb) tb.addEventListener("click", function () {
    var dark = root.getAttribute("data-theme") === "dark" || (!root.getAttribute("data-theme") && matchMedia("(prefers-color-scheme:dark)").matches);
    var next = dark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    safe(function () { localStorage.setItem("pp-theme", next); });
  });
  var mb = d.getElementById("menuBtn"), nl = d.getElementById("navLinks");
  if (mb && nl) mb.addEventListener("click", function () { var o = nl.classList.toggle("open"); mb.setAttribute("aria-expanded", o ? "true" : "false"); });
  var els = d.querySelectorAll(".reveal, .ladder");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { threshold: 0.05, rootMargin: "0px 0px -40px 0px" });
    els.forEach(function (e) { io.observe(e); });
  } else els.forEach(function (e) { e.classList.add("in"); });

  // countdown to a date, and in-force / days-to-go labels on timeline cards
  var DAY = 86400000, now = Date.now();
  d.querySelectorAll("[data-days-to]").forEach(function (el) {
    var t = Date.parse(el.getAttribute("data-days-to") + "T00:00:00Z");
    var n = Math.ceil((t - now) / DAY);
    el.textContent = n > 0 ? n.toLocaleString("en-IN") : "0";
  });
  d.querySelectorAll("[data-state-for]").forEach(function (el) {
    var t = Date.parse(el.getAttribute("data-state-for") + "T00:00:00Z");
    var n = Math.ceil((t - now) / DAY);
    if (n <= 0) { el.className = "st live"; el.textContent = "In force"; }
    else { el.className = "st soon"; el.textContent = n.toLocaleString("en-IN") + " days to go"; }
  });

  // ---- motion layer (all of it skipped when the visitor asks for reduced motion) ----
  var calm = safe(function () { return matchMedia("(prefers-reduced-motion:reduce)").matches; });
  // staggered reveals among siblings
  d.querySelectorAll(".reveal").forEach(function (e) {
    var sibs = e.parentNode ? Array.prototype.filter.call(e.parentNode.children, function (x) { return x.classList.contains("reveal"); }) : [];
    var i = sibs.indexOf(e); if (i > 0) e.style.setProperty("--d", Math.min(i, 6) * 0.07 + "s");
  });
  // header shadow, scroll progress
  var hd = d.querySelector("header.nav"), sp = d.createElement("div"); sp.id = "sp"; d.body.appendChild(sp);
  var tick = false;
  function onScroll() {
    if (tick) return; tick = true;
    requestAnimationFrame(function () {
      var y = window.scrollY || 0, h = d.documentElement.scrollHeight - window.innerHeight;
      if (hd) hd.classList.toggle("scrolled", y > 8);
      sp.style.transform = "scaleX(" + (h > 0 ? Math.min(1, y / h) : 0) + ")";
      tick = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  if (!calm) {
    // pointer spotlight on cards
    d.querySelectorAll(".card, .path, .portal, .bento .b, .lv .card").forEach(function (c) {
      c.classList.add("spot");
      c.addEventListener("pointermove", function (ev) { var r = c.getBoundingClientRect(); c.style.setProperty("--mx", ev.clientX - r.left + "px"); c.style.setProperty("--my", ev.clientY - r.top + "px"); });
    });
    // aurora and sparks in every hero
    d.querySelectorAll(".hero").forEach(function (h) {
      var a = d.createElement("div"); a.className = "aurora"; a.innerHTML = "<i></i><i></i><i></i>"; h.insertBefore(a, h.firstChild);
      for (var k = 0; k < 14; k++) {
        var s = d.createElement("span"); s.className = "spark";
        s.style.left = (Math.random() * 100).toFixed(1) + "%"; s.style.top = (Math.random() * 100).toFixed(1) + "%";
        s.style.setProperty("--t", (7 + Math.random() * 8).toFixed(1) + "s"); s.style.setProperty("--dl", (-Math.random() * 8).toFixed(1) + "s");
        h.appendChild(s);
      }
    });
    // count-up on the big figures when they scroll into view
    var nums = d.querySelectorAll(".bento .num");
    if ("IntersectionObserver" in window) {
      var co = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return; co.unobserve(e.target);
          var el = e.target, m = (el.getAttribute("data-final") || el.textContent).match(/^(\D*)([\d,]+)(.*)$/); if (!m) return;
          var end = parseInt(m[2].replace(/,/g, ""), 10), t0 = performance.now(), dur = 1100;
          (function step(t) { var p = Math.min(1, (t - t0) / dur), v = Math.round(end * (1 - Math.pow(1 - p, 3))); el.textContent = m[1] + v.toLocaleString("en-IN") + m[3]; if (p < 1) requestAnimationFrame(step); })(t0);
        });
      }, { threshold: 0.6 });
      nums.forEach(function (n) { n.setAttribute("data-final", n.textContent); co.observe(n); });
    }
  }
})();
