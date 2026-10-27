// Builds the public microsite (public/site) from the same catalogue the product uses (lib/regulation, lib/live/config),
// so the site and the product can never disagree about a Rule, a date, a penalty or a sector.
//
//   npm run site:build
//
// Writes: public/site/{index,dpdp,sectors,check,platform}.html, site.css, site.js, check.js, engine.js
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";
import { DPDP_RULES, DPDP_SECTIONS, DPDP_VERIFIED_ON, PENALTY_SCHEDULE, RULE_PHASES, SECTORS } from "../lib/regulation";
import { STARTER_CONTROLS } from "../db/seed/starter-library";
import { PHASES } from "../lib/live/config";

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public", "site");
const SRC = path.join(ROOT, "site-src");
mkdirSync(OUT, { recursive: true });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const sectors = SECTORS.filter((s) => s.key !== "all");
const allSector = SECTORS.find((s) => s.key === "all")!;
const instruments = SECTORS.flatMap((s) => s.instruments);
const sectorControls = SECTORS.reduce((n, s) => n + s.controls.length, 0);
const totalControls = STARTER_CONTROLS.length + sectorControls;
const regulators = [...new Set(sectors.flatMap((s) => s.regulators))];
const maxCeiling = PENALTY_SCHEDULE.filter((p) => p.maxCrore).sort((a, b) => b.maxCrore! - a.maxCrore!)[0]!;
const STAMP = fmt(DPDP_VERIFIED_ON);

// ------------------------------------------------------------------ art
const GRAD = `<linearGradient id="gc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0c9a0"/><stop offset=".55" stop-color="#c88a4a"/><stop offset="1" stop-color="#8f3d2a"/></linearGradient>
<linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".16"/><stop offset="1" stop-color="#ffffff" stop-opacity=".02"/></linearGradient>`;
function heroArt(): string {
  const chips = [
    ["Notice", "s.5", 40, 120], ["Consent", "s.6", 410, 70], ["Security", "s.8(5)", 450, 250], ["Breach", "s.8(6)", 30, 330], ["Children", "s.9", 380, 430], ["Rights", "s.11–14", 90, 460],
  ] as const;
  const nodes = [0, 60, 120, 180, 240, 300].map((a) => { const r = (a * Math.PI) / 180; return `<circle cx="${300 + 245 * Math.cos(r)}" cy="${270 + 245 * Math.sin(r)}" r="${a % 120 ? 4 : 6}" fill="#f0c9a0"/>`; }).join("");
  const nodes2 = [30, 110, 190, 270, 330].map((a) => { const r = (a * Math.PI) / 180; return `<circle cx="${300 + 195 * Math.cos(r)}" cy="${270 + 195 * Math.sin(r)}" r="3.5" fill="#fff" opacity=".7"/>`; }).join("");
  return `<svg class="hero-art" viewBox="0 0 600 560" role="img" aria-label="A shield protecting personal data, ringed by the main duties of the DPDP Act">
<defs>${GRAD}</defs>
<circle cx="300" cy="270" r="250" fill="none" stroke="#fff" stroke-opacity=".12"/><circle cx="300" cy="270" r="195" fill="none" stroke="#fff" stroke-opacity=".16" stroke-dasharray="3 7"/><circle cx="300" cy="270" r="140" fill="rgba(255,255,255,.04)" stroke="#fff" stroke-opacity=".1"/>
<g class="orbit">${nodes}</g><g class="orbit r">${nodes2}</g>
<path d="M300 100 L452 156 V290 C452 372 388 428 300 462 C212 428 148 372 148 290 V156 Z" fill="url(#gf)" stroke="url(#gc)" stroke-width="3"/>
<path d="M300 128 L426 174 V288 C426 354 374 400 300 430 C226 400 174 354 174 288 V174 Z" fill="none" stroke="#fff" stroke-opacity=".18"/>
<circle cx="300" cy="262" r="30" fill="none" stroke="url(#gc)" stroke-width="5"/><path d="M300 292 V334" stroke="url(#gc)" stroke-width="7" stroke-linecap="round"/><circle cx="300" cy="262" r="8" fill="url(#gc)"/>
${chips.map(([t, s, x, y]) => `<g transform="translate(${x},${y})"><g class="chip-float"><rect width="124" height="46" rx="14" fill="rgba(42,7,6,.72)" stroke="#f0c9a0" stroke-opacity=".5"/><text x="14" y="20" fill="#fff" font-family="Sora,sans-serif" font-size="14" font-weight="600">${t}</text><text x="14" y="36" fill="#e9bd8c" font-family="IBM Plex Mono,monospace" font-size="11">${s}</text></g></g>`).join("")}
</svg>`;
}
function ringsArt(): string {
  return `<svg class="art" style="right:-120px;top:50%;transform:translateY(-50%);width:640px;opacity:.5" viewBox="0 0 600 600" aria-hidden="true"><g fill="none" stroke="#f0c9a0">${[90, 150, 210, 270].map((r, i) => `<circle cx="300" cy="300" r="${r}" stroke-opacity="${0.35 - i * 0.07}" ${i % 2 ? 'stroke-dasharray="4 9"' : ""}/>`).join("")}</g></svg>`;
}
function togglesArt(): string {
  return `<svg class="art" style="inset:0;width:100%;height:100%;opacity:.5;color:var(--copper)" aria-hidden="true"><defs><pattern id="tg" width="84" height="64" patternUnits="userSpaceOnUse"><rect x="14" y="20" width="36" height="20" rx="10" fill="none" stroke="currentColor" stroke-opacity=".22"/><circle cx="40" cy="30" r="6" fill="currentColor" fill-opacity=".3"/></pattern><linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient><mask id="mk"><rect width="100%" height="100%" fill="url(#fade)"/></mask></defs><rect width="100%" height="100%" fill="url(#tg)" mask="url(#mk)"/></svg>`;
}

// ------------------------------------------------------------------ layout
const NAV = [["index.html", "Overview"], ["dpdp.html", "DPDP"], ["sectors.html", "Sectors"], ["check.html", "Check"], ["platform.html", "Platform"]] as const;
const MARK = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="pmg" gradientUnits="userSpaceOnUse" x1="29" y1="444" x2="446" y2="29"><stop offset="0" stop-color="#b27a42"/><stop offset=".55" stop-color="#8a4a2a"/><stop offset="1" stop-color="#5a0f13"/></linearGradient><symbol id="pmark" viewBox="18 18 439 439"><path d="M29,29 H446 V444 H175 V161.5 H294 A73.75,73.75 0 0 1 294,309 H229 V254 H245 A72.75,72.75 0 0 0 245,108.5 H122.5 V390.5 H29 Z" fill="none" stroke="url(#pmg)" stroke-width="16" stroke-linejoin="miter"/></symbol></defs></svg>`;

function page(file: string, title: string, desc: string, body: string, scripts = ""): string {
  const links = NAV.map(([f, l]) => `<a href="/site/${f}"${f === file ? ' class="on" aria-current="page"' : ""}>${l}</a>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="18 18 439 439"><path d="M29,29 H446 V444 H175 V161.5 H294 A73.75,73.75 0 0 1 294,309 H229 V254 H245 A72.75,72.75 0 0 0 245,108.5 H122.5 V390.5 H29 Z" fill="none" stroke="#8a4a2a" stroke-width="40"/></svg>')}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Fira+Sans:wght@500&display=swap">
<link rel="stylesheet" href="/site/site.css">
<script>try{var t=localStorage.getItem("pp-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
</head><body>${MARK}
<header class="nav"><div class="wrap nav-in">
<a class="logo" href="/site/index.html" aria-label="Primus Partners, Privacy home"><svg aria-hidden="true"><use href="#pmark"/></svg><span class="lt"><span>PRIMUS</span><span>PARTNERS<sup>®</sup></span></span><span class="prod">Privacy<sup>™</sup></span></a>
<nav class="nav-links" id="navLinks" aria-label="Sections">${links}</nav>
<div class="nav-right"><button class="theme-btn" id="themeBtn" type="button" aria-label="Switch colour theme"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button><a class="btn btn-primary" href="/login">Sign in</a><button class="theme-btn menu-btn" id="menuBtn" type="button" aria-label="Menu" aria-expanded="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button></div>
</div></header>
<main>${body}</main>
<footer><div class="wrap foot"><div><div class="logo" style="color:var(--logo)"><svg aria-hidden="true" style="width:30px;height:30px"><use href="#pmark"/></svg><span class="lt" style="font-size:14px"><span>PRIMUS</span><span>PARTNERS<sup>®</sup></span></span></div><p class="disc" style="margin-top:10px">Data Privacy &amp; Digital Advisory. Indicative reference content, not legal advice. DPDP content last checked ${STAMP}. Confirm dates and provisions against the Gazette and the official text before relying on them.</p></div><nav aria-label="Footer">${NAV.map(([f, l]) => `<a href="/site/${f}">${l}</a>`).join("")}<a href="/login">Sign in</a></nav></div></footer>
<script src="/site/site.js"></script>${scripts}
</body></html>`;
}

const ICON = {
  check: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/></svg>',
  map: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/></svg>',
  flow: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="18" r="2"/><path d="M7 6h5a3 3 0 0 1 3 3v0M7 18h5a3 3 0 0 0 3-3v0M17 12H9"/></svg>',
};

// ------------------------------------------------------------------ index
function indexPage(): string {
  const body = `
<section class="hero"><div class="wrap hero-grid">
  <div>
    <span class="eyebrow">Digital Personal Data Protection Act, 2023 · Rules, 2025</span>
    <h1>Know what DPDP asks of you. <em>Then prove you have done it.</em></h1>
    <p class="lead">Primus Privacy turns the DPDP Act, the Rules and the laws of your own sector into one assessment: what applies to your organisation, what evidence shows it, and what to fix first.</p>
    <div class="hero-cta"><a class="btn btn-copper" href="/site/check.html">Check your obligations</a><a class="btn btn-glass" href="/site/dpdp.html">See the DPDP timeline</a></div>
  </div>
  <div style="position:relative">
    ${heroArt()}
    <div class="clock" style="position:relative;margin-top:-70px;max-width:340px;margin-left:auto">
      <div class="k">Days to the main duties</div>
      <div class="big" data-days-to="${RULE_PHASES["18m"].date}">—</div>
      <div class="sub">${fmt(RULE_PHASES["18m"].date)}: notice, consent, security, breach reporting, children, rights and penalties</div>
      <div class="rail"><div class="row"><span>Consent managers (Rule 4)</span><b>${fmt(RULE_PHASES["12m"].date)}</b></div><div class="row"><span>Data Protection Board rules</span><b>In force</b></div></div>
    </div>
  </div>
</div></section>

<div class="strip" aria-label="Regulators covered"><div class="track" aria-hidden="true"><span>${regulators.map(esc).join("</span><span>")}</span><span>${regulators.map(esc).join("</span><span>")}</span></div><p class="wrap" style="position:absolute;left:-9999px">Regulators covered: ${regulators.map(esc).join(", ")}</p></div>

<section><div class="wrap">
  <div class="sec-head reveal"><span class="eyebrow">The scale of it</span><h2>One law, ${sectors.length} sectors, and everything that sits beside it.</h2></div>
  <div class="bento reveal">
    <div class="b w2 dark"><div class="num">${DPDP_RULES.length}</div><div class="lbl">Rules in the DPDP Rules, 2025</div><div class="d">Commencing in three phases from 13 November 2025.</div></div>
    <div class="b w2"><div class="num">₹${maxCeiling.maxCrore}cr</div><div class="lbl">Highest penalty ceiling</div><div class="d">For failing to take reasonable security safeguards, s.8(5).</div></div>
    <div class="b w2"><div class="num">${sectors.length}</div><div class="lbl">Sectors mapped</div><div class="d">From broking and banking to health, telecom, education and government.</div></div>
    <div class="b w3"><div class="num">${instruments.length}</div><div class="lbl">Laws, circulars and guidelines catalogued</div><div class="d">${instruments.filter((i) => i.confirmed).length} checked against a published source. The rest are marked "check before use".</div></div>
    <div class="b w3 dark"><div class="num">${totalControls}</div><div class="lbl">Controls the assessment can test</div><div class="d">${STARTER_CONTROLS.length} for DPDP and ${sectorControls} added by sector rules. Each one traces to a section, a Rule and a penalty ceiling.</div></div>
  </div>
</div></section>

<section class="band-soft"><div class="wrap">
  <div class="sec-head reveal"><span class="eyebrow">Where to go</span><h2>Three ways in.</h2></div>
  <div class="paths reveal">
    <a class="path" href="/site/check.html"><span class="ico">${ICON.check}</span><h3>Check your obligations</h3><p>Answer nine questions and see which provisions of the Act and Rules apply to you, from when, and at what penalty ceiling. Then mark where you stand.</p><span class="go">Run the check →</span></a>
    <a class="path" href="/site/sectors.html"><span class="ico">${ICON.map}</span><h3>Find your sector</h3><p>The regulators, the instruments and how each one sits with DPDP, for ${sectors.length} sectors, plus the documents an auditor would expect to see.</p><span class="go">Open the sector map →</span></a>
    <a class="path" href="/site/platform.html"><span class="ico">${ICON.flow}</span><h3>See how the platform works</h3><p>Seven phases from the first upload to the final report, an AI that stops where a person must decide, and one view for Primus and one for your organisation.</p><span class="go">See the platform →</span></a>
  </div>
</div></section>

<section class="band-dark"><div class="wrap cta">${ringsArt()}<span class="eyebrow">Primus Partners · Data Privacy &amp; Digital Advisory</span><h2>Start with what applies to you.</h2><p>Sign in to the platform to run an engagement, or check your obligations first. Nothing you enter on the check page leaves your browser.</p><div class="hero-cta" style="justify-content:center"><a class="btn btn-copper" href="/login">Sign in</a><a class="btn btn-glass" href="/site/check.html">Check obligations</a></div></div></section>`;
  return page("index.html", "Primus Privacy: DPDP readiness", "Know which parts of the DPDP Act and your sector's laws apply to you, and prove you are ready.", body);
}

// ------------------------------------------------------------------ dpdp
function dpdpPage(): string {
  const phases = (["immediate", "12m", "18m"] as const).map((k) => ({ k, ...RULE_PHASES[k], rules: DPDP_RULES.filter((r) => r.phase === k) }));
  const maxC = Math.max(...PENALTY_SCHEDULE.map((p) => p.maxCrore ?? 0));
  const body = `
<section class="hero slim">${ringsArt()}<div class="wrap"><span class="eyebrow">DPDP at a glance</span><h1>The Act, the Rules, and the dates that matter.</h1><p class="lead">What the Digital Personal Data Protection Act, 2023 asks of a Data Fiduciary, when each part can be enforced, and what a failure can cost. Checked on ${STAMP}.</p></div></section>

<section><div class="wrap">
  <div class="sec-head reveal"><span class="eyebrow">Timeline</span><h2>Three dates, from the notification of the Rules on 13 November 2025.</h2></div>
  <div class="tl reveal">
    ${phases.map((p) => `<div class="t${p.k === "18m" ? " main" : ""}"><div class="when">${fmt(p.date)}</div><span data-state-for="${p.date}" class="st soon">…</span><ul>${p.rules.map((r) => `<li>Rule ${r.number}: ${esc(r.title)}</li>`).join("")}</ul></div>`).join("")}
  </div>
  <p class="stamp">Dates are the commencement phases of the DPDP Rules, 2025 as reported by law-firm summaries; some count a day later. Confirm against the Gazette.</p>
</div></section>

<section class="band-soft"><div class="wrap">
  <div class="sec-head reveal"><span class="eyebrow">What it asks</span><h2>The provisions that decide your work.</h2><p>Each card is a section of the Act. Together they are what the platform's controls test.</p></div>
  <div class="grid reveal">${DPDP_SECTIONS.map((s) => `<article class="card"><span class="ref">${esc(s.ref)}</span><h3>${esc(s.title)}</h3><p>${esc(s.summary)}</p></article>`).join("")}</div>
  <div class="card reveal" style="margin-top:16px"><span class="ref">s.3</span><h3>Who it covers</h3><p>Processing of digital personal data within India, including personal data collected offline and then digitised, and processing outside India in connection with offering goods or services to people in India. It does not cover personal or domestic use, or data that the person made public herself or that was made public under a legal duty.</p></div>
</div></section>

<section><div class="wrap">
  <div class="sec-head reveal"><span class="eyebrow">What it costs</span><h2>Penalty ceilings under the Schedule to the Act.</h2><p>These are the most the Data Protection Board can impose, after an inquiry and after weighing the factors in section 33(2). They do not predict what any firm would pay.</p></div>
  <div class="ladder reveal">${PENALTY_SCHEDULE.map((p) => `<div class="r"><div class="what">${esc(p.breach)}<small>${esc(p.section)}</small></div><div class="bar"><i style="--w:${p.maxCrore ? Math.max((p.maxCrore / maxC) * 100, 4) : 2}%"></i><b>${esc(p.maxText)}</b></div></div>`).join("")}</div>
</div></section>

<section class="band-soft"><div class="wrap">
  <div class="sec-head reveal"><span class="eyebrow">Status of the machinery</span><h2>What is settled, and what is still moving.</h2></div>
  <div class="facts reveal">
    <div class="f"><b>The Rules</b><span>Notified on 13 November 2025. The Board rules took effect at once; the consent-manager rule follows after 12 months and the main duties after 18.</span></div>
    <div class="f"><b>Shortening the window</b><span>In January 2026 MeitY consulted on cutting the 18 months to 12. Comments closed on 4 February 2026. No amending notification had been found at the last check, so 13 May 2027 stands.</span></div>
    <div class="f"><b>Data Protection Board</b><span>It exists in law and its Rules are in force. MeitY invited applications for the Chairperson and Members on 6 May 2026. No appointments had been reported at the last check.</span></div>
    <div class="f"><b>Significant Data Fiduciaries</b><span>The Central Government notifies them, by volume and sensitivity of data and risk to rights. None had been reported at the last check, so "may apply" is the honest answer for large processors.</span></div>
  </div>
  <p class="stamp">As checked on ${STAMP} against public law-firm and MeitY-tracking sources. This page is a summary, not legal advice.</p>
</div></section>

<section class="band-dark"><div class="wrap cta">${ringsArt()}<h2>See what this means for your organisation.</h2><p>The check turns these provisions into a list for your sector and your facts, with a readiness score.</p><div class="hero-cta" style="justify-content:center"><a class="btn btn-copper" href="/site/check.html">Check your obligations</a></div></div></section>`;
  return page("dpdp.html", "DPDP at a glance | Primus Privacy", "The DPDP Act and Rules: what they ask, when each part is enforceable and what a failure can cost.", body);
}

// ------------------------------------------------------------------ sectors
const GROUPS: Record<string, string> = { broking: "finance", banking: "finance", insurance: "finance", healthcare: "health", telecom: "digital", ecommerce: "digital", ott: "digital", ai: "digital", aviation: "travel", education: "public", government: "public", msme: "small" };
function sectorsPage(): string {
  const cards = sectors.map((s) => `
<article class="sector reveal" data-group="${GROUPS[s.key] ?? "other"}" data-text="${esc((s.label + " " + s.blurb + " " + s.regulators.join(" ") + " " + s.instruments.map((i) => i.name).join(" ")).toLowerCase())}">
  <div class="top"><span class="eyebrow">${esc(s.regulators[0] ?? "")}</span><h3>${esc(s.label)}</h3><p class="blurb">${esc(s.blurb)}</p><div class="regs">${s.regulators.map((r) => `<span class="tag">${esc(r)}</span>`).join("")}</div></div>
  <div class="stats"><span><b>${s.instruments.length}</b>${s.instruments.length === 1 ? "instrument" : "instruments"}</span><span><b>${s.controls.length}</b>added ${s.controls.length === 1 ? "control" : "controls"}</span></div>
  <button class="open" type="button" aria-expanded="false"><span>Laws and how they sit with DPDP</span><span aria-hidden="true">+</span></button>
  <div class="more">
    <div><h4>Laws, circulars and guidelines</h4><ul>${s.instruments.map((i) => `<li class="inst"><b>${i.source ? `<a href="${esc(i.source)}" target="_blank" rel="noreferrer">${esc(i.name)}</a>` : esc(i.name)}</b> <span class="tag ${i.confirmed ? "good" : "warn"}">${i.confirmed ? "checked against a source" : "check before use"}</span><small>${esc(i.regulator)} · ${esc(i.summary)}</small></li>`).join("")}</ul></div>
    <div><h4>How it sits with DPDP</h4><ul>${s.dpdpInterplay.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
    <div><h4>Documents an auditor would expect</h4><ul>${s.typicalEvidence.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
  </div>
</article>`).join("");
  const chips: Array<[string, string]> = [["all", "All sectors"], ["finance", "Financial services"], ["health", "Health"], ["digital", "Digital and media"], ["travel", "Travel"], ["public", "Education and government"], ["small", "Small business"]];
  const body = `
<section class="hero slim">${ringsArt()}<div class="wrap"><span class="eyebrow">Sector map</span><h1>DPDP is the floor. Your sector adds the rest.</h1><p class="lead">${sectors.length} sectors, ${regulators.length} regulators and ${instruments.length} instruments mapped against the DPDP Act, with the documents an auditor would expect to see.</p></div></section>
<section><div class="wrap">
  <div class="tools"><input class="search" id="q" type="search" placeholder="Search a sector, a regulator or a law (for example RBI, telemedicine, IRDAI)" aria-label="Search sectors"><div class="chips" role="group" aria-label="Filter by group">${chips.map(([k, l], i) => `<button class="chip" type="button" data-g="${k}" aria-pressed="${i === 0}">${l}</button>`).join("")}</div></div>
  <div class="sectors" id="list">${cards}</div>
  <p id="none" class="stamp" hidden>Nothing matches. Clear the search or pick another group.</p>
  <div class="card" style="margin-top:22px"><span class="ref">All sectors</span><h3>${esc(allSector.label)}</h3><p>${esc(allSector.blurb)} ${allSector.controls.length} controls apply to every organisation, whatever its sector.</p></div>
  <p class="stamp">Instruments marked "check before use" have not been confirmed against a published source. Content checked ${STAMP}; not legal advice.</p>
</div></section>
<noscript><style>.sector .more{display:grid}.sector button.open{display:none}</style></noscript>`;
  const js = `<script>(function(){var q=document.getElementById("q"),cards=[].slice.call(document.querySelectorAll(".sector")),chips=[].slice.call(document.querySelectorAll(".chip")),none=document.getElementById("none"),g="all";
function f(){var t=q.value.trim().toLowerCase(),n=0;cards.forEach(function(c){var ok=(g==="all"||c.getAttribute("data-group")===g)&&(!t||c.getAttribute("data-text").indexOf(t)>-1);c.hidden=!ok;if(ok)n++});none.hidden=n>0}
q.addEventListener("input",f);chips.forEach(function(b){b.addEventListener("click",function(){g=b.getAttribute("data-g");chips.forEach(function(x){x.setAttribute("aria-pressed",x===b?"true":"false")});f()})});
cards.forEach(function(c){var b=c.querySelector("button.open");b.addEventListener("click",function(){var o=c.classList.toggle("expanded");b.setAttribute("aria-expanded",o?"true":"false");b.lastElementChild.textContent=o?"−":"+"})});
var h=location.hash.slice(1);if(h){var c=document.querySelector('[data-group="'+h+'"]');}})();</script>`;
  return page("sectors.html", "Sector map | Primus Privacy", "The regulators, laws and DPDP interplay for twelve sectors, with the documents an auditor would expect.", body, js);
}

// ------------------------------------------------------------------ check
function checkPage(): string {
  const seg = (name: string, opts: Array<[string, string]>, type = "radio", checked = "") => `<div class="seg">${opts.map(([v, l]) => `<label><input type="${type}" name="${name}" value="${v}"${v === checked ? " checked" : ""}><span>${l}</span></label>`).join("")}</div>`;
  const yn = (name: string) => seg(name, [["yes", "Yes"], ["no", "No"], ["", "Not sure"]], "radio", "");
  const body = `
<section class="hero slim">${ringsArt()}<div class="wrap"><span class="eyebrow">Know your obligations and your readiness</span><h1>Which parts of DPDP apply to you, and where you stand.</h1><p class="lead">Nine questions. The answer comes from the same engine the platform uses on a live engagement. Nothing you enter leaves your browser.</p></div></section>
<section><div class="wrap">
  <form id="qform" class="panel" aria-label="About your organisation">
    <div class="qs">
      <div class="q"><h3>Which sectors do you operate in?</h3><p class="help">Pick every one that applies. A broker with a lending arm picks both.</p>${seg("sector", sectors.map((s) => [s.key, s.label] as [string, string]), "checkbox")}</div>
      <div class="qgrid">
        <div class="q"><h3>Does any processing rely on consent?</h3>${yn("consent")}</div>
        <div class="q"><h3>Do you process children's data (under 18)?</h3>${yn("children")}</div>
        <div class="q"><h3>Large volume, or sensitive data at scale?</h3><p class="help">For example health, financial or biometric data, or a very large customer base.</p>${yn("large")}</div>
        <div class="q"><h3>Have you been notified as a Significant Data Fiduciary?</h3>${seg("sdf", [["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]])}</div>
        <div class="q"><h3>Do vendors process personal data for you?</h3>${yn("processors")}</div>
        <div class="q"><h3>Does personal data go outside India?</h3>${yn("abroad")}</div>
        <div class="q"><h3>Do automated decisions affect people?</h3>${yn("auto")}</div>
        <div class="q"><h3>How many employees?</h3><div class="seg">${[["", "Skip"], ["lt_50", "Under 50"], ["50_250", "50 to 250"], ["250_1000", "250 to 1,000"], ["1000_5000", "1,000 to 5,000"], ["gt_5000", "Over 5,000"]].map(([v, l], i) => `<label><input type="radio" name="emp" value="${v}"${i === 0 ? " checked" : ""}><span>${l}</span></label>`).join("")}</div></div>
      </div>
      <div class="hero-cta" style="margin:0"><button class="btn btn-primary" type="submit">Show my obligations</button><button class="btn btn-ghost" type="reset">Start again</button></div>
    </div>
  </form>
  <div id="results" class="results" aria-live="polite"></div>
</div></section>`;
  return page("check.html", "Check your obligations | Primus Privacy", "Answer nine questions and see which provisions of the DPDP Act and Rules apply to you, from when, and your readiness.", body, `<script src="/site/engine.js"></script><script src="/site/check.js"></script>`);
}

// ------------------------------------------------------------------ platform
function platformPage(): string {
  const body = `
<section class="hero slim">${ringsArt()}<div class="wrap"><span class="eyebrow">The platform</span><h1>From the first upload to the final report, with a person at every decision.</h1><p class="lead">Seven phases. At each one a fixed-format document goes in, the platform checks it, an AI does the reading and the drafting, and people decide what matters.</p></div></section>

<section><div class="wrap">
  <div class="sec-head reveal"><span class="eyebrow">The flow</span><h2>Seven phases, one thread.</h2><p>Each phase hands its result to the next. Who sends what is fixed, so the audit trail is clean.</p></div>
  <div class="flow">${PHASES.map((p) => `<div class="st reveal"><div class="n">${p.n}</div><div class="c"><h3>${esc(p.name)}</h3><p>${esc(p.headline)}</p><div class="who"><span class="tag">${p.from.side === "client" ? "Organisation sends" : p.from.side === "primus" ? "Primus team records" : "Primus and the AI"}</span><span class="tag good">Result: ${esc(p.handsOn.replace(/\.$/, ""))}</span></div></div></div>`).join("")}</div>
</div></section>

<section class="band-soft"><div class="wrap">
  <div class="sec-head reveal"><span class="eyebrow">Two portals, one engagement</span><h2>The same flow, seen from each side.</h2><p>Either can show the whole journey. Uploads, approvals and releases are recorded under the name of whoever did them.</p></div>
  <div class="two reveal">
    <div class="portal p"><span class="eyebrow">Primus workspace</span><h3>For the consultants</h3><ul><li>A portfolio dashboard across every client, worked out from the live records.</li><li>The Live Run: start each AI step, see what it read, approve or reject what it proposes.</li><li>Per-organisation regulation mapping: which Rules bind this client, and which sector rules sit beside them.</li><li>Review queues for evidence, findings and reports, with release rights for the sign-off gates.</li><li>An audit trail of every decision and what it was based on.</li></ul></div>
    <div class="portal"><span class="eyebrow">Organisation portal</span><h3>For the client's team</h3><ul><li>A live journey: download the template, send the file, see what Primus did with it.</li><li>"What applies to you": the DPDP provisions and sector rules for your organisation, with dates and penalty ceilings.</li><li>The data map, the discovery questionnaire and the evidence centre.</li><li>Findings, remediation actions, risks and reports once released.</li><li>Clarifications and tasks, so nothing is chased by email.</li></ul></div>
  </div>
</div></section>

<section><div class="wrap">
  <div class="sec-head reveal"><span class="eyebrow">The AI, on a lead</span><h2>It does the reading. People keep the decisions.</h2><p>The engine is the platform's own rules engine, so nothing leaves the server. Every decision shows the facts it relied on and the file cell or document it came from.</p></div>
  <div class="lv reveal">
    <div class="card"><span class="ref">Level 1</span><h3>Assist</h3><p>The AI prepares everything. Nothing is applied until a person approves it.</p></div>
    <div class="card"><span class="ref">Level 2</span><h3>Supervised</h3><p>The AI applies routine, low-stakes work it is very sure about. People decide the rest.</p></div>
    <div class="card"><span class="ref">Level 3</span><h3>Full autopilot</h3><p>The AI applies what it is reasonably sure about. People get the exceptions and the sign-off gates.</p></div>
  </div>
  <div class="grid reveal" style="margin-top:16px">
    <div class="card"><h3>Sign-off gates, always on</h3><p>Rejecting critical evidence, releasing critical findings, issuing the final report and sending breach notices stop for a named person, at every level.</p></div>
    <div class="card"><h3>Templates first</h3><p>Every file goes in a fixed template. The platform checks it before the AI reads a word, and tells the sender exactly which cell to fix.</p></div>
    <div class="card"><h3>Look, do not trust</h3><p>A read-only connector can scan the client's database for tables holding personal data and compare them with what the client wrote in the inventory. It keeps names and categories, never values.</p></div>
  </div>
</div></section>

<section class="band-dark"><div class="wrap cta">${ringsArt()}<h2>See it run on a real engagement.</h2><p>Sign in to the platform. Primus Partners will walk you through the live flow from either portal.</p><div class="hero-cta" style="justify-content:center"><a class="btn btn-copper" href="/login">Sign in</a><a class="btn btn-glass" href="/site/check.html">Check obligations first</a></div></div></section>`;
  return page("platform.html", "The platform | Primus Privacy", "Seven phases from first upload to final report, an AI that stops where a person must decide, and one view for Primus and one for the client.", body);
}

// ------------------------------------------------------------------ write
for (const f of readdirSync(OUT)) if (f.endsWith(".html") || f === "site.css" || f === "site.js" || f === "check.js" || f === "engine.js") rmSync(path.join(OUT, f));
writeFileSync(path.join(OUT, "index.html"), indexPage());
writeFileSync(path.join(OUT, "dpdp.html"), dpdpPage());
writeFileSync(path.join(OUT, "sectors.html"), sectorsPage());
writeFileSync(path.join(OUT, "check.html"), checkPage());
writeFileSync(path.join(OUT, "platform.html"), platformPage());
for (const f of ["site.css", "site.js", "check.js"]) writeFileSync(path.join(OUT, f), readFileSync(path.join(SRC, f), "utf8"));
buildSync({ entryPoints: [path.join(SRC, "engine-entry.ts")], bundle: true, minify: true, format: "iife", globalName: "PrimusRegulation", outfile: path.join(OUT, "engine.js"), target: "es2019", logLevel: "error" });
if (!existsSync(path.join(OUT, "engine.js"))) throw new Error("engine.js was not built");
console.log(`✓ Microsite built: 5 pages, ${sectors.length} sectors, ${instruments.length} instruments, ${DPDP_RULES.length} Rules, ${totalControls} controls.`);
