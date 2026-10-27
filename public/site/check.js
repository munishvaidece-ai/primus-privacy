/* The obligations and readiness checker. Runs the product's own engine (engine.js) in the browser; nothing is sent anywhere. */
(function () {
  var E = window.PrimusRegulation; if (!E) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var form = $("#qform"), out = $("#results");
  var GROUPS = [
    ["basis", "Why you may process data at all", "Lawful grounds, notice and consent."],
    ["duties", "What you must do with the data", "Accuracy, processors, security, breaches, erasure."],
    ["rights", "What people can ask of you", "Access, correction, erasure, nomination and grievances."],
    ["children", "Children and guardians", "Verifiable consent and the bans on tracking."],
    ["sdf", "If you are a Significant Data Fiduciary", "Extra duties for the biggest and riskiest processors."],
    ["transfers", "Data leaving India", "Allowed unless the Government restricts the destination."],
    ["exemptions", "Exemptions", "State bodies and small organisations."]
  ];
  var fmt = function (iso) { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var tri = function (v) { return v === "yes" ? true : v === "no" ? false : null; };
  var crore = {}; E.PENALTY_SCHEDULE.forEach(function (p) { crore[p.key] = p.maxCrore || 0; });
  var ready = {}; // obligation id -> "yes" | "part" | "no"
  var last = null;

  function facts() {
    var f = new FormData(form), g = function (n) { return f.get(n); };
    return {
      sectors: f.getAll("sector"),
      reliesOnConsent: tri(g("consent")), legitimateUses: null,
      children: tri(g("children")), largeOrSensitive: tri(g("large")),
      notifiedSdf: g("sdf") || null, usesProcessors: tri(g("processors")), crossBorder: tri(g("abroad")),
      automatedDecisions: tri(g("auto")), employees: g("emp") || null
    };
  }

  function score(list) {
    var on = list.filter(function (o) { return o.status !== "not_applicable"; });
    if (!on.length) return { pct: 0, answered: 0, total: 0 };
    var pts = 0, ans = 0;
    on.forEach(function (o) { var r = ready[o.id]; if (r) ans++; pts += r === "yes" ? 1 : r === "part" ? 0.5 : 0; });
    return { pct: Math.round((pts / on.length) * 100), answered: ans, total: on.length };
  }

  function render() {
    var list = E.applicableObligations(facts()), sum = E.summarise(list, new Date());
    last = list;
    var sectors = facts().sectors.map(function (k) { var s = E.SELECTABLE_SECTORS.filter(function (x) { return x.key === k; })[0]; return s ? s.label : k; });
    var h = "";
    h += '<div class="sumband">' +
      '<div class="s"><b>' + sum.applies + '</b><span>obligations apply</span></div>' +
      '<div class="s"><b>' + sum.mayApply + '</b><span>may apply, depending on facts</span></div>' +
      '<div class="s"><b>' + sum.rules.length + '</b><span>Rules bind you</span></div>' +
      '<div class="s"><b>' + (sum.highestCeilingText ? sum.highestCeilingText.replace("up to ", "") : "n/a") + '</b><span>highest penalty ceiling</span></div>' +
      '<div class="s"><b>' + Math.max(sum.daysToFirstDuty, 0).toLocaleString("en-IN") + '</b><span>days to ' + fmt(sum.firstDuty) + '</span></div></div>';
    h += '<div class="ready" id="readyBox"></div>';
    if (sectors.length) h += '<p class="note">Sector rules sit beside these for: <b>' + esc(sectors.join(", ")) + '</b>. <a href="/site/sectors.html">See each sector\'s laws, circulars and how they sit with DPDP</a>.</p>';
    GROUPS.forEach(function (g) {
      var items = list.filter(function (o) { return o.group === g[0] && o.status !== "not_applicable"; });
      if (!items.length) return;
      h += '<div class="grp"><h3>' + g[1] + '</h3><p>' + g[2] + '</p><div class="obs">';
      items.forEach(function (o) {
        var cls = o.status === "may_apply" ? "ob may" : "ob";
        h += '<article class="' + cls + '" data-id="' + o.id + '"><div class="h"><div><span class="ref">' + esc(o.sections.join(", ")) + (o.rules.length ? " · Rule " + o.rules.join(", ") : "") + '</span><h4>' + esc(o.title) + '</h4></div><span class="tag ' + (o.status === "applies" ? "good" : "warn") + '">' + (o.status === "applies" ? "Applies" : "May apply") + '</span></div>' +
          '<p>' + esc(o.asks) + '</p><p><b>Why:</b> ' + esc(o.reasons.join(" ")) + '</p>' +
          '<div class="meta"><span>Enforceable from <b>' + fmt(o.inForce) + '</b></span><span>Penalty ceiling <b>' + esc(o.penalty.text) + '</b></span></div>' +
          '<div class="rd" role="group" aria-label="Where are you on: ' + esc(o.title) + '"><button type="button" data-v="yes" aria-pressed="false">In place</button><button type="button" data-v="part" aria-pressed="false">Partly</button><button type="button" data-v="no" aria-pressed="false">Not yet</button></div></article>';
      });
      h += "</div></div>";
    });
    var na = list.filter(function (o) { return o.status === "not_applicable"; });
    if (na.length) h += '<p class="note">' + na.length + ' provision' + (na.length === 1 ? "" : "s") + ' do not apply on your answers: ' + esc(na.map(function (o) { return o.title; }).join("; ")) + ".</p>";
    h += '<p class="note">Indicative, not legal advice. "May apply" means it turns on something you have not said or on a decision by the Central Government. Confirm against the Gazette before relying on it.</p>';
    out.innerHTML = h; out.classList.add("on");
    out.querySelectorAll(".rd button").forEach(function (b) {
      var id = b.closest(".ob").getAttribute("data-id");
      b.setAttribute("aria-pressed", ready[id] === b.getAttribute("data-v") ? "true" : "false");
      b.addEventListener("click", function () {
        ready[id] = b.getAttribute("data-v");
        b.parentNode.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        readiness();
      });
    });
    readiness();
  }

  function readiness() {
    var box = $("#readyBox"); if (!box || !last) return;
    var s = score(last);
    var gaps = last.filter(function (o) { return o.status !== "not_applicable" && ready[o.id] && ready[o.id] !== "yes"; })
      .sort(function (a, b) { return (crore[b.penalty.key] - crore[a.penalty.key]) || (ready[a.id] === "no" ? -1 : 1); }).slice(0, 5);
    box.innerHTML = '<div class="ring" style="--p:' + s.pct + '"><b>' + s.pct + '%</b></div><div><h3 style="font-size:19px">Your readiness</h3><p style="color:var(--ink2);font-size:14.5px">' +
      (s.answered === 0 ? "Mark each obligation below as in place, partly or not yet. Your readiness and the gaps to close first appear here." : s.answered + " of " + s.total + " answered. In place counts in full, partly counts half.") + "</p>" +
      (gaps.length ? '<ol class="gaps" style="margin-top:10px">' + gaps.map(function (o) { return "<li><b>" + esc(o.title) + "</b> <small>" + esc(o.sections.join(", ")) + " · ceiling " + esc(o.penalty.text) + "</small></li>"; }).join("") + "</ol>" : "") + "</div>";
  }

  form.addEventListener("submit", function (e) { e.preventDefault(); ready = {}; render(); out.scrollIntoView({ behavior: "smooth", block: "start" }); });
  form.addEventListener("reset", function () { setTimeout(function () { out.classList.remove("on"); out.innerHTML = ""; ready = {}; }, 0); });
})();
