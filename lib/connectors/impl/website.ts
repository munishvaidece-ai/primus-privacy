import dns from "node:dns/promises";
import net from "node:net";
import { z } from "zod";
import { classifyName, sensitivityOf, unique } from "../classify";
import type { ConnectorContext, ConnectorImpl, DiscoveredAsset, ScanResult, TestResult } from "../types";

const cfg = z.object({
  url: z.string().url(),
  maxPages: z.coerce.number().int().min(1).max(25).default(5),
});

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10000;

// ------------------------------------------------------------ network guard
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || x.startsWith("::ffff:127.") || x.startsWith("::ffff:10.") || x.startsWith("::ffff:192.168.");
}

async function assertAllowedHost(url: URL, env: NodeJS.ProcessEnv): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https addresses can be scanned.");
  if (env.CONNECTOR_ALLOW_PRIVATE_HOSTS === "true") return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (addrs.length === 0 || addrs.some(isPrivateIp)) {
    throw new Error("That address points to a private / internal network, which website scans refuse by default. (A devops admin can allow it with CONNECTOR_ALLOW_PRIVATE_HOSTS=true.)");
  }
}

interface Fetched { url: string; status: number; headers: Headers; setCookies: string[]; body: string }

async function get(raw: string, env: NodeJS.ProcessEnv): Promise<Fetched> {
  let current = new URL(raw);
  for (let hop = 0; hop < 5; hop++) {
    await assertAllowedHost(current, env);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(current, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": "PrimusPrivacyScanner/1.0 (+compliance review)", accept: "text/html,*/*;q=0.5" } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current);
        continue;
      }
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (size < MAX_BYTES) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          chunks.push(value); size += value.length;
        }
        await reader.cancel().catch(() => undefined);
      }
      const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      return { url: current.toString(), status: res.status, headers: res.headers, setCookies, body: Buffer.concat(chunks).toString("utf8") };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects.");
}

// ----------------------------------------------------------------- analysis
const TRACKERS: Array<[string, RegExp]> = [
  ["Google Analytics / Tag Manager", /(google-analytics\.com|googletagmanager\.com|gtag\(|ga\('create')/i],
  ["Meta (Facebook) Pixel", /(connect\.facebook\.net|fbq\(|facebook\.com\/tr)/i],
  ["Hotjar", /hotjar\.com/i],
  ["Microsoft Clarity", /clarity\.ms/i],
  ["LinkedIn Insight", /(snap\.licdn\.com|px\.ads\.linkedin\.com)/i],
  ["Google Ads / DoubleClick", /(doubleclick\.net|googleadservices\.com|googlesyndication\.com)/i],
  ["Mixpanel", /mixpanel\.com/i],
  ["Segment", /segment\.(com|io)\/analytics/i],
  ["Twitter / X Pixel", /(static\.ads-twitter\.com|analytics\.twitter\.com)/i],
  ["Clevertap / MoEngage / WebEngage", /(clevertap|moengage|webengage)/i],
];
const CMPS: Array<[string, RegExp]> = [
  ["Cookiebot", /cookiebot/i], ["OneTrust", /onetrust/i], ["Osano", /osano/i], ["CookieYes", /cookieyes/i],
  ["Cookie Consent (library)", /cookieconsent/i], ["Termly", /termly/i], ["Usercentrics", /usercentrics/i],
];
const BANNER_WORDS = /(accept (all )?cookies|cookie (settings|preferences|policy|consent)|we use cookies|this (web)?site uses cookies|manage cookies)/i;

function textOf(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function links(html: string, base: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try { out.push({ href: new URL(m[1]!, base).toString(), text: textOf(m[2]!).slice(0, 120) }); } catch { /* ignore */ }
  }
  return out;
}

interface FormInfo { action: string; method: string; fields: Array<{ name: string; type: string }>; categories: string[]; consentCheckbox: boolean; consentPreTicked: boolean; hasPassword: boolean }

function forms(html: string, base: string): FormInfo[] {
  const out: FormInfo[] = [];
  const re = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1]!, inner = m[2]!;
    const action = /action\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
    const method = (/method\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "get").toLowerCase();
    const fields: Array<{ name: string; type: string }> = [];
    const cats = new Set<string>();
    let consent = false, pre = false, hasPassword = false;
    const ire = /<(input|textarea|select)\b([^>]*)>/gi;
    let im: RegExpExecArray | null;
    while ((im = ire.exec(inner))) {
      const a = im[2]!;
      const type = (/type\s*=\s*["']?([a-z]+)/i.exec(a)?.[1] ?? (im[1] === "input" ? "text" : im[1]!)).toLowerCase();
      const name = /name\s*=\s*["']([^"']*)["']/i.exec(a)?.[1] ?? /id\s*=\s*["']([^"']*)["']/i.exec(a)?.[1] ?? "";
      const hint = `${name} ${/placeholder\s*=\s*["']([^"']*)["']/i.exec(a)?.[1] ?? ""} ${/autocomplete\s*=\s*["']([^"']*)["']/i.exec(a)?.[1] ?? ""}`;
      if (type === "hidden" || type === "submit" || type === "button") continue;
      fields.push({ name, type });
      if (type === "email") cats.add("email");
      if (type === "tel") cats.add("phone");
      if (type === "password") { hasPassword = true; cats.add("credentials"); }
      if (type === "date" && /birth|dob/i.test(hint)) cats.add("dob");
      for (const c of classifyName(hint)) if (c !== "location" && c !== "ip") cats.add(c);
      if (type === "checkbox" && /consent|agree|accept|terms|privacy|policy/i.test(`${name} ${inner.slice(Math.max(0, im.index - 200), im.index + 300)}`)) {
        consent = true;
        if (/\bchecked\b/i.test(a)) pre = true;
      }
    }
    if (fields.length) {
      let resolved = action;
      try { resolved = new URL(action || base, base).toString(); } catch { /* keep raw */ }
      out.push({ action: resolved, method, fields, categories: unique([...cats]), consentCheckbox: consent, consentPreTicked: pre, hasPassword });
    }
  }
  return out;
}

function parseCookie(sc: string) {
  const parts = sc.split(";").map((s) => s.trim());
  const name = parts[0]!.split("=")[0]!;
  const flags = parts.slice(1).map((p) => p.toLowerCase());
  return { name, secure: flags.includes("secure"), httpOnly: flags.includes("httponly"), sameSite: flags.find((f) => f.startsWith("samesite="))?.split("=")[1] ?? null };
}

export interface Observation { severity: "low" | "medium" | "high"; message: string }

export const websiteConnector: ConnectorImpl = {
  async test(ctx: ConnectorContext): Promise<TestResult> {
    try {
      const c = cfg.parse(ctx.config);
      const r = await get(c.url, ctx.env);
      return r.status < 400
        ? { ok: true, message: `Reached ${r.url} (HTTP ${r.status}).` }
        : { ok: false, message: `The site answered HTTP ${r.status}.` };
    } catch (e) {
      return { ok: false, message: `Could not reach the site: ${(e as Error).message}`.slice(0, 300) };
    }
  },

  async scan(ctx: ConnectorContext): Promise<ScanResult> {
    const c = cfg.parse(ctx.config);
    const home = await get(c.url, ctx.env);
    if (home.status >= 400) throw new Error(`The start page answered HTTP ${home.status}.`);
    const origin = new URL(home.url).origin;
    const assets: DiscoveredAsset[] = [];
    const obs: Observation[] = [];
    const seenPages = new Map<string, Fetched>([[home.url, home]]);

    // Pages worth reading: privacy, contact, sign-up, careers — same site only.
    const interesting = links(home.body, home.url).filter((l) => l.href.startsWith(origin) && /(privacy|data[- ]?protection|grievance|contact|sign[- ]?up|register|career|subscribe|newsletter|login|cookie)/i.test(`${l.href} ${l.text}`));
    for (const l of interesting) {
      if (seenPages.size >= c.maxPages) break;
      if (seenPages.has(l.href)) continue;
      try { const p = await get(l.href, ctx.env); if (p.status < 400) seenPages.set(p.url, p); } catch { /* skip page */ }
    }

    const allHtml = [...seenPages.values()].map((p) => p.body).join("\n");
    const homeLinks = links(home.body, home.url);

    // ---- privacy notice
    const privacyLink = homeLinks.find((l) => /privacy|data[- ]?protection/i.test(`${l.href} ${l.text}`));
    let privacyPage: Fetched | undefined;
    if (privacyLink) privacyPage = seenPages.get(privacyLink.href) ?? undefined;
    if (privacyLink && !privacyPage && seenPages.size < c.maxPages + 1) {
      try { const p = await get(privacyLink.href, ctx.env); if (p.status < 400) { privacyPage = p; seenPages.set(p.url, p); } } catch { /* unreachable */ }
    }
    if (!privacyLink) obs.push({ severity: "high", message: "No link to a privacy notice was found on the start page." });
    else if (!privacyPage) obs.push({ severity: "medium", message: `A privacy link was found (${privacyLink.href}) but the page could not be read.` });
    else {
      const t = textOf(privacyPage.body).toLowerCase();
      const missing = [
        ["purpose of processing", /(purpose|why we (collect|use))/],
        ["how to withdraw consent", /withdraw/],
        ["how to exercise rights", /(your rights|right to (access|erasure|correct)|access, correct)/],
        ["grievance / contact details", /(grievance|data protection officer|dpo)/],
        ["complaint to the Data Protection Board", /data protection board/],
        ["retention", /(retain|retention|how long)/],
      ].filter(([, re]) => !(re as RegExp).test(t)).map(([n]) => n as string);
      if (t.length < 400) obs.push({ severity: "medium", message: "The privacy notice page has very little text." });
      if (missing.length) obs.push({ severity: "medium", message: `The privacy notice does not appear to mention: ${missing.join("; ")}. (Keyword check — a person should read the notice.)` });
    }

    // ---- cookies, consent banner, trackers
    const cmp = CMPS.find(([, re]) => re.test(allHtml))?.[0] ?? null;
    const banner = !!cmp || BANNER_WORDS.test(textOf(allHtml));
    const trackers = TRACKERS.filter(([, re]) => re.test(allHtml)).map(([n]) => n);
    const cookies = [...seenPages.values()].flatMap((p) => p.setCookies).map(parseCookie);
    const uniqueCookies = [...new Map(cookies.map((k) => [k.name, k])).values()];
    if (!banner) obs.push({ severity: trackers.length || uniqueCookies.length ? "high" : "low", message: trackers.length || uniqueCookies.length ? "No cookie consent banner or consent tool was detected, while cookies or trackers are present." : "No cookie consent banner was detected (no cookies or trackers were seen either)." });
    if (trackers.length && !cmp) obs.push({ severity: "high", message: `Trackers found (${trackers.join(", ")}) and no recognised consent-management tool. Check that they only load after consent.` });
    else if (trackers.length) obs.push({ severity: "medium", message: `Trackers found (${trackers.join(", ")}). Check that they only load after consent is given.` });
    if (uniqueCookies.some((k) => !k.secure) && home.url.startsWith("https:")) obs.push({ severity: "medium", message: `Cookies set without the Secure flag: ${uniqueCookies.filter((k) => !k.secure).map((k) => k.name).join(", ")}.` });
    if (uniqueCookies.some((k) => !k.httpOnly)) obs.push({ severity: "low", message: `Cookies readable by page scripts (no HttpOnly): ${uniqueCookies.filter((k) => !k.httpOnly).map((k) => k.name).join(", ")}.` });
    if (uniqueCookies.length) obs.push({ severity: "low", message: `${uniqueCookies.length} cookie(s) are set on first load, before any consent choice could be made.` });

    // ---- forms
    const allForms = [...seenPages.entries()].flatMap(([url, p]) => forms(p.body, url).map((f) => ({ ...f, page: url })));
    for (const f of allForms) {
      if (f.categories.length && !f.consentCheckbox && !f.hasPassword) obs.push({ severity: "medium", message: `The form on ${f.page} collects ${f.categories.join(", ")} with no visible consent or notice checkbox. (It may rely on a notice shown elsewhere on the page.)` });
      if (f.consentPreTicked) obs.push({ severity: "high", message: `The consent box on the form at ${f.page} is pre-ticked. Consent must be a clear, affirmative action.` });
      if (f.action.startsWith("http:") && f.categories.length) obs.push({ severity: "high", message: `A form that collects ${f.categories.join(", ")} submits over an unencrypted address (${f.action}).` });
    }

    // ---- transport and headers
    if (home.url.startsWith("http:")) obs.push({ severity: "high", message: "The site is served over plain http (no encryption)." });
    else {
      if (!home.headers.get("strict-transport-security")) obs.push({ severity: "low", message: "No HSTS header (Strict-Transport-Security)." });
    }
    if (!home.headers.get("content-security-policy")) obs.push({ severity: "low", message: "No Content-Security-Policy header." });
    if (!home.headers.get("x-content-type-options")) obs.push({ severity: "low", message: "No X-Content-Type-Options header." });
    if (!home.headers.get("referrer-policy")) obs.push({ severity: "low", message: "No Referrer-Policy header." });

    // ---- assets (metadata only)
    for (const [url, p] of seenPages) {
      assets.push({ assetType: "web_page", name: new URL(url).pathname || "/", location: url, attributes: { status: p.status, bytes: p.body.length }, piiCategories: [], sensitivity: "none" });
    }
    for (const f of allForms) {
      assets.push({ assetType: "web_form", name: `Form (${f.method.toUpperCase()}) on ${new URL(f.page).pathname}`, location: `${f.page}#form:${f.action}`, attributes: { fields: f.fields, consentCheckbox: f.consentCheckbox, consentPreTicked: f.consentPreTicked }, piiCategories: f.categories, sensitivity: sensitivityOf(f.categories) });
    }
    for (const k of uniqueCookies) assets.push({ assetType: "web_cookie", name: k.name, location: `${origin}#cookie:${k.name}`, attributes: { secure: k.secure, httpOnly: k.httpOnly, sameSite: k.sameSite }, piiCategories: [], sensitivity: "none" });
    for (const t of trackers) assets.push({ assetType: "web_tracker", name: t, location: `${origin}#tracker:${t}`, attributes: {}, piiCategories: [], sensitivity: "none" });
    obs.forEach((o, i) => assets.push({ assetType: "observation", name: o.message.slice(0, 120), location: `${origin}#obs:${i}:${o.message.slice(0, 40)}`, attributes: { severity: o.severity, message: o.message }, piiCategories: [], sensitivity: "none" }));

    return {
      assets,
      stats: { pagesRead: seenPages.size, forms: allForms.length, cookies: uniqueCookies.length, trackers: trackers.length, observations: obs.length, consentTool: cmp ?? (banner ? "banner text only" : "none detected") },
    };
  },
};
