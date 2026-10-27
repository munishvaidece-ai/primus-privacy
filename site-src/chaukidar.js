/* Chaukidar: the guided DPDP conversation. No free text and no language model. Every question and answer is written in
   lib/regulation/chaukidar.ts, and the numbers come from the product's own engine (engine.js), loaded on first use.
   Nothing the visitor picks leaves the browser. */
(function () {
  "use strict";
  if (window.__chaukidar) return;
  window.__chaukidar = true;

  var E = null, loadingEngine = false, waiting = [];
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var st = fresh();
  var els = {};
  var open = false, started = false, busy = false, nudged = false;

  function fresh() { return { sectors: [], sectorsSet: false, sectorPick: null, facts: {}, aware: null, shown: 0 }; }

  // ---------------------------------------------------------------- small helpers
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (attrs[k] === false || attrs[k] == null) return;
      else n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, reduce ? 0 : ms); }); };
  var fmt = function (iso) { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); };
  var nf = function (n) { return Math.max(0, n).toLocaleString("en-IN"); };

  function withEngine(cb, fail) {
    if (window.PrimusRegulation && window.PrimusRegulation.CH_NODES) { E = window.PrimusRegulation; return cb(); }
    waiting.push({ ok: cb, fail: fail });
    if (loadingEngine) return;
    loadingEngine = true;
    var s = document.createElement("script");
    s.src = "/site/engine.js";
    s.onload = function () { loadingEngine = false; E = window.PrimusRegulation; waiting.splice(0).forEach(function (w) { w.ok(); }); };
    s.onerror = function () { loadingEngine = false; waiting.splice(0).forEach(function (w) { if (w.fail) w.fail(); }); };
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------- the engine, in the visitor's terms
  function tri(v) { return v === "yes" ? true : v === "no" ? false : null; }
  function engineFacts() {
    var f = st.facts;
    return { sectors: st.sectors, reliesOnConsent: tri(f.consent), legitimateUses: null, children: tri(f.children), largeOrSensitive: tri(f.large), notifiedSdf: null, usesProcessors: tri(f.processors), crossBorder: tri(f.abroad), automatedDecisions: null, employees: null };
  }
  function sectorLabel(k) { var s = E.SELECTABLE_SECTORS.filter(function (x) { return x.key === k; })[0]; return s ? s.label : k; }
  function crore(key) { var p = E.PENALTY_SCHEDULE.filter(function (x) { return x.key === key; })[0]; return p && p.maxCrore ? p.maxCrore : 0; }

  // ---------------------------------------------------------------- the shell
  function avatar(size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><defs><linearGradient id="ckg' + size + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0c9a0"/><stop offset=".55" stop-color="#c88a4a"/><stop offset="1" stop-color="#8f3d2a"/></linearGradient></defs>' +
      '<path d="M24 3 6 10v13c0 11 7.6 18.6 18 22 10.4-3.4 18-11 18-22V10z" fill="#3b0d0b" stroke="url(#ckg' + size + ')" stroke-width="2.2"/>' +
      '<g class="ck-lamp"><circle cx="24" cy="24" r="9" fill="#f0c9a0" opacity=".22"/><path d="M24 14v3M19.5 19.5h9l1.5 11h-12z" fill="none" stroke="url(#ckg' + size + ')" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><rect x="21.5" y="22" width="5" height="6" rx="1.5" fill="#f0c9a0"/></g></svg>';
  }

  function build() {
    var root = h("div", { id: "ck", class: "ck" });
    els.launch = h("button", { class: "ck-launch", type: "button", "aria-expanded": "false", "aria-controls": "ck-panel", html: '<span class="ck-av">' + avatar(30) + '</span><span class="ck-lt"><b>Ask Chaukidar</b><small>Your DPDP watchman</small></span>' });
    els.nudge = h("div", { class: "ck-nudge", role: "status", hidden: true }, []);
    els.nudge.innerHTML = '<button type="button" class="ck-nx" aria-label="Dismiss">×</button><b>Namaste.</b> Not sure what the DPDP Act means for you? Ask me, one question at a time.';
    els.panel = h("div", { id: "ck-panel", class: "ck-panel", role: "dialog", "aria-labelledby": "ck-title", "aria-modal": "false", hidden: true });
    var head = h("div", { class: "ck-head" }, [
      h("span", { class: "ck-av big", html: avatar(40) }),
      h("div", { class: "ck-ht" }, [h("h2", { id: "ck-title", text: "Chaukidar" }), h("p", { text: "Your DPDP watchman. Guided answers, no typing." })]),
      h("button", { class: "ck-ib", type: "button", "aria-label": "Start again", title: "Start again", html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>' }),
      h("button", { class: "ck-ib ck-close", type: "button", "aria-label": "Close", title: "Close", html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' }),
    ]);
    els.restart = head.querySelectorAll(".ck-ib")[0];
    els.close = head.querySelector(".ck-close");
    els.watch = h("div", { class: "ck-watch", "aria-label": "Your watchtower" });
    els.thread = h("div", { class: "ck-thread", role: "log", "aria-live": "polite", tabindex: "0", "aria-label": "Conversation" });
    var foot = h("div", { class: "ck-foot" }, [h("p", { text: "Indicative, not legal advice. Nothing you pick leaves your browser." })]);
    els.panel.appendChild(head); els.panel.appendChild(els.watch); els.panel.appendChild(els.thread); els.panel.appendChild(foot);
    root.appendChild(els.nudge); root.appendChild(els.panel); root.appendChild(els.launch);
    document.body.appendChild(root);

    els.launch.addEventListener("click", function () { open ? closePanel() : openPanel(); });
    els.close.addEventListener("click", closePanel);
    els.restart.addEventListener("click", function () { restart(); });
    els.nudge.querySelector(".ck-nx").addEventListener("click", function () { hideNudge(true); });
    els.nudge.addEventListener("click", function (e) { if (e.target.closest(".ck-nx")) return; openPanel(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) closePanel(); });
  }

  function openPanel() {
    hideNudge(true);
    open = true;
    els.panel.hidden = false;
    document.documentElement.classList.add("ck-open");
    els.launch.setAttribute("aria-expanded", "true");
    requestAnimationFrame(function () { els.panel.classList.add("on"); });
    if (!started) {
      started = true;
      els.thread.appendChild(h("div", { class: "ck-loading", text: "Waking the watchman…" }));
      withEngine(function () { els.thread.innerHTML = ""; paintWatch(); go(E.CH_START); }, function () {
        els.thread.innerHTML = "";
        els.thread.appendChild(h("div", { class: "ck-bot" }, [h("p", { text: "I could not load just now. Please refresh the page and try again." })]));
        started = false;
      });
    }
  }
  function closePanel() {
    open = false;
    els.panel.classList.remove("on");
    document.documentElement.classList.remove("ck-open");
    els.launch.setAttribute("aria-expanded", "false");
    setTimeout(function () { if (!open) els.panel.hidden = true; }, reduce ? 0 : 220);
    els.launch.focus({ preventScroll: true });
  }
  function restart() {
    st = fresh(); busy = false; els.thread.innerHTML = ""; paintWatch(); go(E.CH_START);
  }

  function hideNudge(remember) {
    els.nudge.hidden = true;
    if (remember) { try { sessionStorage.setItem("ck-nudged", "1"); } catch (e) { /* storage may be blocked; the nudge is only a convenience */ } }
  }
  function scheduleNudge() {
    var seen = false;
    try { seen = sessionStorage.getItem("ck-nudged") === "1"; } catch (e) { seen = false; }
    if (seen) return;
    setTimeout(function () {
      if (open || nudged) return;
      nudged = true; els.nudge.hidden = false;
      setTimeout(function () { if (!els.nudge.hidden) hideNudge(true); }, 9000);
    }, 7000);
  }

  // ---------------------------------------------------------------- the watchtower strip
  var shownApplies = null;
  function paintWatch() {
    if (!E) return;
    var list = E.applicableObligations(engineFacts()), sum = E.summarise(list, new Date());
    var chips = [];
    if (st.sectors.length) chips.push(st.sectors.map(sectorLabel).join(" + "));
    [["consent", "Consent"], ["children", "Children"], ["processors", "Vendors"], ["abroad", "Abroad"], ["large", "Scale"]].forEach(function (p) {
      var v = st.facts[p[0]]; if (!v) return;
      chips.push(p[1] + (v === "yes" ? ": yes" : v === "no" ? ": no" : ": not sure"));
    });
    els.watch.innerHTML = "";
    var num = h("b", { class: "ck-n", text: String(shownApplies == null ? sum.applies : shownApplies) });
    els.watch.appendChild(h("div", { class: "ck-w1" }, [num, h("span", { text: "duties apply to you so far" })]));
    els.watch.appendChild(h("div", { class: "ck-w2" }, [h("b", { text: nf(sum.daysToFirstDuty) }), h("span", { text: "days to " + fmt(sum.firstDuty) })]));
    var row = h("div", { class: "ck-chips" }, []);
    if (!chips.length) row.appendChild(h("span", { class: "ck-chip dim", text: "Answer a few questions and I will start counting." }));
    chips.forEach(function (c) { row.appendChild(h("span", { class: "ck-chip", text: c })); });
    els.watch.appendChild(row);
    tween(num, shownApplies == null ? sum.applies : shownApplies, sum.applies);
    shownApplies = sum.applies;
  }
  function tween(node, from, to) {
    if (reduce || from === to) { node.textContent = String(to); return; }
    var t0 = performance.now(), dur = 600;
    (function step(t) {
      var p = Math.min(1, (t - t0) / dur);
      node.textContent = String(Math.round(from + (to - from) * p));
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  // ---------------------------------------------------------------- the conversation
  function toBottom() { els.thread.scrollTo({ top: els.thread.scrollHeight, behavior: reduce ? "auto" : "smooth" }); }
  // A tall card is read from its top, so when it is longer than the window, show where it starts instead of its end.
  function toCardTop(card) { els.thread.scrollTo({ top: Math.max(0, card.offsetTop - 10), behavior: reduce ? "auto" : "smooth" }); }

  async function say(text) {
    var typing = h("div", { class: "ck-bot typing", "aria-hidden": "true" }, [h("span"), h("span"), h("span")]);
    els.thread.appendChild(typing); toBottom();
    await wait(Math.min(900, 280 + text.length * 7));
    var msg = h("div", { class: "ck-bot" }, [h("p", { text: text })]);
    els.thread.replaceChild(msg, typing); toBottom();
  }
  function you(text) { els.thread.appendChild(h("div", { class: "ck-you" }, [h("p", { text: text })])); toBottom(); }

  function tray(options, onPick, label) {
    var box = h("div", { class: "ck-tray", role: "group", "aria-label": label || "Choose an answer" });
    box.appendChild(h("div", { class: "ck-tray-h", text: "Choose one" }));
    options.forEach(function (o, i) {
      var b = h("button", { class: "ck-opt", type: "button", style: "animation-delay:" + (reduce ? 0 : 70 + i * 60) + "ms" }, [h("b", { text: o.label }), o.hint ? h("small", { text: o.hint }) : null]);
      b.addEventListener("click", function () { if (busy) return; busy = true; box.classList.add("done"); setTimeout(function () { box.remove(); }, reduce ? 0 : 180); onPick(o); });
      box.appendChild(b);
    });
    els.thread.appendChild(box);
    var prev = box.previousElementSibling;
    if (prev && prev.classList.contains("ck-card") && prev.offsetHeight + box.offsetHeight > els.thread.clientHeight - 24) toCardTop(prev); else toBottom();
    var first = box.querySelector(".ck-opt"); if (first) first.focus({ preventScroll: true });
    return box;
  }

  async function picked(o) {
    you(o.label);
    if (o.set) { Object.keys(o.set).forEach(function (k) { st.facts[k] = o.set[k]; }); paintWatch(); }
    if (typeof o.aware === "number") st.aware = o.aware;
    if (o.reply) await say(o.reply);
    busy = false;
    go(o.next);
  }

  async function go(id) {
    var n = E.CH_NODES[id];
    if (!n) { busy = false; return go(E.CH_START); }
    busy = true;
    if (n.kind === "ask") { await say(n.say); busy = false; tray(n.options, picked); return; }
    if (n.kind === "sectors") { return sectors(n); }
    if (n.kind === "tell") { await card(tellCard(n)); busy = false; tray(n.follow, picked, "What next?"); return; }
    await say(n.say);
    var c = n.kind === "map" ? mapCard() : n.kind === "who" ? whoCard() : n.kind === "dates" ? datesCard() : n.kind === "penalties" ? penaltiesCard() : briefCard();
    await card(c);
    busy = false;
    tray(n.follow, picked, "What next?");
  }

  async function card(node) {
    await wait(260);
    els.thread.appendChild(node);
    if (node.offsetHeight > els.thread.clientHeight - 24) toCardTop(node); else toBottom();
    node.querySelectorAll("[data-grow]").forEach(function (b) { requestAnimationFrame(function () { b.style.width = b.getAttribute("data-grow"); }); });
    if (!reduce) await wait(200);
  }

  // ---------------------------------------------------------------- sector picker
  async function sectors(n) {
    if (!n.single && st.sectorsSet) {
      await say(st.sectors.length ? "I will use the sectors you already gave me: " + st.sectors.map(sectorLabel).join(", ") + "." : "I will carry on without a sector, as you said you were not sure.");
      busy = false; return go(n.next);
    }
    await say(n.say);
    var box = h("div", { class: "ck-tray ck-sec", role: "group", "aria-label": n.single ? "Choose a sector" : "Choose your sectors" });
    box.appendChild(h("div", { class: "ck-tray-h", text: n.single ? "Choose one" : "Choose all that fit" }));
    if (n.hint) box.appendChild(h("p", { class: "ck-hint", text: n.hint }));
    var grid = h("div", { class: "ck-grid" }, []);
    var chosen = [];
    E.SELECTABLE_SECTORS.forEach(function (s, i) {
      var b = h("button", { class: "ck-sc", type: "button", "aria-pressed": "false", style: "animation-delay:" + (reduce ? 0 : 60 + i * 35) + "ms", text: s.label });
      b.addEventListener("click", function () {
        if (busy) return;
        if (n.single) { finish([s.key], s.label); return; }
        var on = b.getAttribute("aria-pressed") !== "true";
        b.setAttribute("aria-pressed", on ? "true" : "false");
        chosen = on ? chosen.concat([s.key]) : chosen.filter(function (k) { return k !== s.key; });
        go2.textContent = chosen.length ? "Continue with " + chosen.length : "Continue";
      });
      grid.appendChild(b);
    });
    box.appendChild(grid);
    var go2 = h("button", { class: "ck-go", type: "button", text: "Continue" });
    var skip = h("button", { class: "ck-skip", type: "button", text: "Not sure, skip" });
    if (!n.single) {
      go2.addEventListener("click", function () { finish(chosen, chosen.length ? chosen.map(sectorLabel).join(", ") : "Continue without a sector"); });
      skip.addEventListener("click", function () { finish([], "Not sure, skip"); });
      box.appendChild(h("div", { class: "ck-act" }, [go2, skip]));
    }
    els.thread.appendChild(box); toBottom();
    busy = false;
    function finish(keys, said) {
      if (busy) return; busy = true;
      box.classList.add("done"); setTimeout(function () { box.remove(); }, reduce ? 0 : 180);
      you(said);
      if (n.single) st.sectorPick = keys[0]; else { st.sectors = keys; st.sectorsSet = true; }
      paintWatch(); busy = false; go(n.next);
    }
  }

  // ---------------------------------------------------------------- cards
  function cite(list) {
    return h("div", { class: "ck-cite" }, list.map(function (c) { return h("span", { text: c }); }));
  }
  function tellCard(n) {
    var c = h("article", { class: "ck-card" }, [h("h3", { text: n.title })]);
    n.body.forEach(function (p) { c.appendChild(h("p", { text: p })); });
    if (n.cite && n.cite.length) c.appendChild(cite(n.cite));
    if (n.takeaway) c.appendChild(h("div", { class: "ck-so" }, [h("b", { text: "So what for you" }), h("p", { text: n.takeaway })]));
    return c;
  }

  function mapCard() {
    var list = E.applicableObligations(engineFacts()), sum = E.summarise(list, new Date());
    var top = list.filter(function (o) { return o.status === "applies"; }).sort(function (a, b) { return crore(b.penalty.key) - crore(a.penalty.key); }).slice(0, 6);
    var c = h("article", { class: "ck-card map" }, [h("h3", { text: "Your DPDP map" })]);
    var band = h("div", { class: "ck-stats" }, [
      stat(sum.applies, "duties apply"), stat(sum.mayApply, "may apply"), stat(sum.rules.length, "Rules bind you"),
      stat(sum.highestCeilingText ? sum.highestCeilingText.replace("up to ", "") : "n/a", "highest penalty ceiling"),
    ]);
    c.appendChild(band);
    c.appendChild(h("p", { class: "ck-dim", text: nf(sum.daysToFirstDuty) + " days until the main duties can be enforced on " + fmt(sum.firstDuty) + "." }));
    if (st.sectors.length) c.appendChild(h("p", { class: "ck-dim", text: "Sector rules sit beside these for: " + st.sectors.map(sectorLabel).join(", ") + "." }));
    c.appendChild(h("h4", { text: "Where to look first" }));
    var ol = h("ol", { class: "ck-top" }, []);
    top.forEach(function (o) {
      ol.appendChild(h("li", null, [h("b", { text: o.title }), h("small", { text: o.sections.join(", ") + (o.rules.length ? " · Rule " + o.rules.join(", ") : "") + " · ceiling " + o.penalty.text })]));
    });
    c.appendChild(ol);
    var acts = h("div", { class: "ck-act wrapish" }, []);
    var copy = h("button", { class: "ck-btn", type: "button", text: "Copy my summary" });
    copy.addEventListener("click", function () { copyText(summaryText(list, sum, top), copy); });
    acts.appendChild(copy);
    acts.appendChild(h("a", { class: "ck-btn alt", href: "/site/check.html", text: "Get a readiness score" }));
    acts.appendChild(h("a", { class: "ck-btn alt", href: "/login", text: "See it live on the platform" }));
    c.appendChild(acts);
    c.appendChild(h("p", { class: "ck-fine", text: "Indicative. “May apply” means it turns on something you have not said or on a Government decision. Confirm against the Gazette before relying on it." }));
    return c;
  }
  function stat(v, l) { return h("div", { class: "ck-stat" }, [h("b", { text: String(v) }), h("span", { text: l })]); }
  function summaryText(list, sum, top) {
    var lines = ["Chaukidar summary (Primus Privacy), " + new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })];
    if (st.sectors.length) lines.push("Sectors: " + st.sectors.map(sectorLabel).join(", "));
    lines.push(sum.applies + " duties apply, " + sum.mayApply + " may apply, " + sum.rules.length + " DPDP Rules bind. Highest penalty ceiling " + (sum.highestCeilingText || "n/a") + ".");
    lines.push("Main duties enforceable from " + fmt(sum.firstDuty) + " (" + nf(sum.daysToFirstDuty) + " days).");
    lines.push("Look first at:");
    top.forEach(function (o, i) { lines.push((i + 1) + ". " + o.title + " (" + o.sections.join(", ") + "), ceiling " + o.penalty.text); });
    lines.push("Indicative, not legal advice. Confirm against the Gazette.");
    return lines.join("\n");
  }
  function copyText(text, btn) {
    var done = function () { var t = btn.textContent; btn.textContent = "Copied"; setTimeout(function () { btn.textContent = t; }, 1600); };
    var fallback = function () {
      var ta = h("textarea", { "aria-hidden": "true", style: "position:fixed;opacity:0" }); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { btn.textContent = "Select and copy from the card"; }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }

  function whoCard() {
    var left = st.aware == null ? 72 : Math.max(0, 72 - st.aware);
    var c = h("article", { class: "ck-card who" }, [h("h3", { text: "The clock, and who to tell" })]);
    var R = 38, C = 2 * Math.PI * R, frac = left / 72;
    var ring = h("div", { class: "ck-clock" }, []);
    ring.innerHTML = '<svg viewBox="0 0 100 100" width="92" height="92" aria-hidden="true"><circle cx="50" cy="50" r="' + R + '" fill="none" stroke="var(--line)" stroke-width="9"/><circle class="ck-arc" cx="50" cy="50" r="' + R + '" fill="none" stroke="' + (left <= 12 ? "var(--crit)" : "var(--copper)") + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '" transform="rotate(-90 50 50)" data-off="' + (C * (1 - frac)).toFixed(1) + '"/></svg>';
    ring.appendChild(h("div", { class: "ck-cl" }, [h("b", { text: left >= 1 ? String(Math.round(left)) + " h" : "0 h" }), h("span", { text: left > 0 ? "left of the 72 hour window" : "the 72 hour window has passed" })]));
    c.appendChild(ring);
    c.appendChild(h("p", { text: left > 0 ? "The DPDP Rules give you 72 hours from becoming aware to send the Board a detailed report, after telling it without delay. Sector regulators may set shorter limits." : "If the 72 hours have passed, report to the Board now and take legal advice. Late is better than never." }));
    var ul = h("ul", { class: "ck-duties" }, []);
    E.incidentDuties(st.sectors).forEach(function (d) {
      ul.appendChild(h("li", null, [
        h("b", { text: d.body }), h("p", { text: d.asks }),
        h("small", { text: (d.inForce ? "Enforceable from " + fmt(d.inForce) + ". " : "Check the circular for the timeline and whether it already applies. ") + (d.confirmed ? "" : "Source still to be confirmed. ") + (d.control ? "Platform control " + d.control + "." : "") }),
      ]));
    });
    c.appendChild(ul);
    c.appendChild(h("div", { class: "ck-so" }, [h("b", { text: "If you are in the middle of it" }), h("p", { text: "Speak to your security team and your counsel now, and write down the time you became aware. This is a guide, not advice." })]));
    requestAnimationFrame(function () { setTimeout(function () { var a = c.querySelector(".ck-arc"); if (a) a.setAttribute("stroke-dashoffset", a.getAttribute("data-off")); }, 60); });
    return c;
  }

  function datesCard() {
    var c = h("article", { class: "ck-card" }, [h("h3", { text: "The timeline" })]);
    var now = Date.now(), phases = ["immediate", "12m", "18m"];
    var what = { immediate: "The Board is set up and the Act's foundations apply.", "12m": "Consent managers can register (Rule 4).", "18m": "The main duties: notice, consent, security, breach reporting, children, rights and penalties." };
    var tl = h("ol", { class: "ck-tl" }, []);
    phases.forEach(function (k) {
      var p = E.RULE_PHASES[k], t = new Date(p.date).getTime(), days = Math.ceil((t - now) / 86400000);
      var n = E.DPDP_RULES.filter(function (r) { return r.phase === k; }).length;
      tl.appendChild(h("li", { class: days <= 0 ? "past" : "next" }, [
        h("b", { text: fmt(p.date) }), h("span", { class: "ck-tag", text: days <= 0 ? "In force" : "In " + nf(days) + " days" }),
        h("p", { text: what[k] + " " + n + (n === 1 ? " Rule." : " Rules.") }),
      ]));
    });
    c.appendChild(tl);
    c.appendChild(h("p", { class: "ck-fine", text: "From the notification of 13 November 2025, as checked on " + fmt(E.DPDP_VERIFIED_ON) + ". Confirm against the Gazette." }));
    return c;
  }

  function penaltiesCard() {
    var c = h("article", { class: "ck-card" }, [h("h3", { text: "The penalty ceilings" })]);
    var max = 250;
    E.PENALTY_SCHEDULE.forEach(function (p) {
      var w = p.maxCrore ? Math.max(6, Math.round((p.maxCrore / max) * 100)) : 3;
      c.appendChild(h("div", { class: "ck-bar" }, [
        h("div", { class: "ck-bl" }, [h("span", { text: p.breach }), h("b", { text: p.maxText })]),
        h("div", { class: "ck-bt" }, [h("i", { style: "width:0", "data-grow": w + "%" })]),
        h("small", { text: p.section }),
      ]));
    });
    c.appendChild(h("p", { class: "ck-fine", text: "These are ceilings, not predictions. The Board decides the amount after weighing the factors in section 33(2)." }));
    return c;
  }

  function briefCard() {
    var key = st.sectorPick, s = E.SECTORS.filter(function (x) { return x.key === key; })[0];
    if (!st.sectorsSet && key) { st.sectors = [key]; st.sectorsSet = true; paintWatch(); }
    if (!s) return h("article", { class: "ck-card" }, [h("p", { text: "I could not find that sector." })]);
    var c = h("article", { class: "ck-card" }, [h("h3", { text: s.label }), h("p", { text: s.blurb })]);
    c.appendChild(h("div", { class: "ck-cite" }, s.regulators.map(function (r) { return h("span", { text: r }); })));
    c.appendChild(h("h4", { text: "What binds you besides DPDP" }));
    var ul = h("ul", { class: "ck-duties" }, []);
    s.instruments.slice(0, 4).forEach(function (i) {
      ul.appendChild(h("li", null, [h("b", { text: i.name }), h("p", { text: i.summary }), h("small", { text: i.regulator + (i.confirmed ? "" : " · source still to be confirmed") })]));
    });
    c.appendChild(ul);
    if (s.dpdpInterplay && s.dpdpInterplay.length) {
      c.appendChild(h("h4", { text: "How it sits with DPDP" }));
      var li = h("ul", { class: "ck-plain" }, []);
      s.dpdpInterplay.slice(0, 3).forEach(function (t) { li.appendChild(h("li", { text: t })); });
      c.appendChild(li);
    }
    c.appendChild(h("a", { class: "ck-btn alt", href: "/site/sectors.html", text: "See every sector" }));
    return c;
  }

  // ---------------------------------------------------------------- start
  function init() {
    build();
    scheduleNudge();
    var idle = window.requestIdleCallback || function (f) { setTimeout(f, 2500); };
    idle(function () { if (!window.PrimusRegulation) withEngine(function () {}, function () {}); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
