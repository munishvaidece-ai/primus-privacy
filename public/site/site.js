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
})();
