// Phase 2: reads the filled Data Inventory and
//   (a) loads the data landscape (systems, stores, vendors, purposes, data elements,
//       data subject groups, processing activities and their links), and
//   (b) drafts answers for the discovery questionnaire, each with the cell it came from.
// Offline rules only. Everything points back to a sheet and row.
import { z } from "zod";
import type { TaskDef } from "../engine";
import type { Source, SuggestionDraft } from "../types";
import { inputHash } from "../text";
import { classifyName } from "@/lib/connectors/classify";
import { who, type Actor } from "../provenance";
import { SECTIONS } from "@/lib/workspace/discovery-sections";

interface Rw { _row: number }
export interface ActRow extends Rw { activity: string; unit: string; purpose: string; principals: string; elements: string; systems: string; vendors: string; basis: string; retention: string; abroad: string }
export interface StoreRow extends Rw { system: string; store: string; hosting: string; owner: string }
export interface VendorRow extends Rw { vendor: string; service: string; data: string; contract: string; country: string }
export interface RegRow extends Rw { registration: string; regulator: string; number: string; status: string }
export interface UnitRow extends Rw { name: string; does: string; head: string; personal: string; staff: string }
export interface FormAns { ref: string; key: string; label: string; row: number; answer: string; document: string }

/** One table found by a database connector scan (names, types and categories only, never values). */
export interface DiscoveredTable {
  connector: string;
  location: string;
  name: string;
  categories: string[];
  sensitivity: string;
  rows: number | null;
  columns: Array<{ name: string; type: string; categories: string[] }>;
}

export interface LandscapeInput {
  fileId: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: Actor;
  activities: ActRow[];
  stores: StoreRow[];
  vendors: VendorRow[];
  practices: FormAns[];
  /** Tables found by a connected database scan, when one has run. */
  discovered?: DiscoveredTable[];
  /** From the phase 1 form, when it was uploaded. */
  scope: { org: Record<string, { value: string; row: number }>; registrations: RegRow[]; units: UnitRow[]; fileName: string } | null;
}

const num = z.number();
export const landscapeOutput = z.object({
  systems: z.array(z.object({ name: z.string(), owner: z.string(), hosting: z.string(), row: num })),
  stores: z.array(z.object({ name: z.string(), location: z.string(), system: z.string(), row: num })),
  vendors: z.array(z.object({ name: z.string(), service: z.string(), dpa: z.string(), riskTier: z.string(), country: z.string(), row: num })),
  purposes: z.array(z.object({ name: z.string(), row: num })),
  elements: z.array(z.object({ name: z.string(), sensitivity: z.enum(["general", "sensitive", "critical"]), row: num })),
  principals: z.array(z.object({ name: z.string(), children: z.boolean(), row: num })),
  activities: z.array(
    z.object({
      name: z.string(), unit: z.string(), description: z.string(), purpose: z.string(), principals: z.array(z.string()), elements: z.array(z.string()),
      systems: z.array(z.string()), vendors: z.array(z.string()), basis: z.string(), retention: z.string(), abroad: z.boolean(), row: num,
    }),
  ),
  issues: z.array(z.object({ text: z.string(), at: z.string() })),
  brief: z.string(),
  confidence: z.number().min(0).max(1),
  prefill: z.array(
    z.object({
      section: z.string(),
      answers: z.record(z.union([z.string(), z.boolean(), z.array(z.string())])),
      from: z.record(z.string()),
    }),
  ),
});
export type LandscapeOutput = z.infer<typeof landscapeOutput>;

const split = (s: string) => s.split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
const uniq = <T>(a: T[]) => [...new Set(a)];
const cellRef = (sheet: string, row: number, extra = "") => `Sheet '${sheet}', row ${row}${extra}`;

function classify(name: string): "general" | "sensitive" | "critical" {
  if (/aadhaar|biometric|password|\botp\b|card number|cvv|account number|demat account|passport/i.test(name)) return "critical";
  if (/\bpan\b|income|kyc|health|bank|financial|trad(e|ing)|holding|signature|photo|date of birth|\bdob\b|address|nominee|salary|\bip address|device|location/i.test(name)) return "sensitive";
  return "general";
}

const DATA_TYPE_WORDS: Array<[string, RegExp]> = [
  ["identity", /name|aadhaar|\bpan\b|passport|date of birth|\bdob\b|photo|signature|identity|kyc/i],
  ["contact", /mobile|phone|email|address|contact/i],
  ["financial", /bank|income|trad|holding|demat|payment|card|account|salary|financial|ledger/i],
  ["health", /health|medical|disab/i],
  ["biometric", /biometric|fingerprint|face/i],
  ["location", /location|gps/i],
  ["online", /ip address|device|cookie|login|session|app usage|browser/i],
  ["employee", /employee|payroll|attendance|candidate|resume|\bcv\b/i],
];
const PRINCIPAL_WORDS: Array<[string, RegExp]> = [
  ["customers", /client|customer|investor|account holder|prospect|applicant|nominee/i],
  ["employees", /employee|staff|candidate|applicant.*job|payroll/i],
  ["vendor_contacts", /vendor|partner|authori[sz]ed person|agent|franchisee|supplier|contact/i],
  ["patients", /patient/i],
  ["visitors", /visitor|website|app user|lead/i],
  ["children", /minor|child|under 18/i],
];

function employeesBucket(n: number): string {
  return n < 50 ? "lt_50" : n <= 250 ? "50_250" : n <= 1000 ? "250_1000" : n <= 5000 ? "1000_5000" : "gt_5000";
}

function optionValue(sectionKey: string, fieldKey: string, label: string): string | boolean | null {
  const f = SECTIONS.find((s) => s.key === sectionKey)?.fields.find((x) => x.key === fieldKey);
  if (!f) return null;
  const t = label.trim().toLowerCase();
  if (f.type === "yesno") return t === "yes" ? true : t === "no" ? false : null;
  if (f.type === "choice") return f.options?.find((o) => o.label.toLowerCase() === t || o.value === t)?.value ?? null;
  return label.trim() || null;
}

export function offlineLandscape(i: LandscapeInput): LandscapeOutput {
  const issues: LandscapeOutput["issues"] = [];
  const S = (r: Rw) => r._row;

  const systems = i.stores.map((r) => ({ name: r.system, owner: r.owner ?? "", hosting: r.hosting ?? "", row: S(r) }));
  const sysSeen = new Set(systems.map((s) => s.name.toLowerCase()));
  // systems named only in an activity still need a record
  for (const a of i.activities) for (const n of split(a.systems ?? "")) if (!sysSeen.has(n.toLowerCase())) {
    sysSeen.add(n.toLowerCase());
    systems.push({ name: n, owner: "", hosting: "", row: S(a) });
    issues.push({ text: `System "${n}" is used by an activity but is not listed on the 'Systems and data stores' sheet. It was added without a hosting location.`, at: cellRef("Processing activities", S(a)) });
  }
  const stores = i.stores.filter((r) => r.store).map((r) => ({ name: r.store, location: r.hosting ?? "", system: r.system, row: S(r) }));

  const vendorNames = new Set(i.vendors.map((v) => v.vendor.toLowerCase()));
  const vendors = i.vendors.map((r) => ({
    name: r.vendor, service: r.service, dpa: r.contract, country: r.country || "India", row: S(r),
    riskTier: r.contract === "No" ? "high" : r.contract === "Partly" ? "medium" : /india/i.test(r.country || "India") ? "low" : "medium",
  }));
  for (const v of vendors) {
    if (v.dpa === "No") issues.push({ text: `${v.name} handles personal data without a contract with data protection terms. DPDP section 8(2) requires a valid contract with a processor.`, at: cellRef("Vendors", v.row) });
    else if (v.dpa === "Partly") issues.push({ text: `${v.name}'s contract only partly covers data protection. Ask for the missing terms.`, at: cellRef("Vendors", v.row) });
    if (!/india/i.test(v.country)) issues.push({ text: `${v.name} is in ${v.country}, so personal data goes outside India. Check it against the Government's restrictions under section 16.`, at: cellRef("Vendors", v.row) });
  }
  for (const a of i.activities) for (const n of split(a.vendors ?? "")) if (!vendorNames.has(n.toLowerCase())) {
    issues.push({ text: `Vendor "${n}" is named on an activity but not listed on the 'Vendors' sheet, so it was not loaded.`, at: cellRef("Processing activities", S(a)) });
  }

  const purposeSeen = new Map<string, number>();
  const elementSeen = new Map<string, number>();
  const principalSeen = new Map<string, number>();
  const activities: LandscapeOutput["activities"] = [];
  for (const a of i.activities) {
    const purpose = a.purpose.trim();
    if (purpose && !purposeSeen.has(purpose.toLowerCase())) purposeSeen.set(purpose.toLowerCase(), S(a));
    const els = split(a.elements);
    for (const e of els) if (!elementSeen.has(e.toLowerCase())) elementSeen.set(e.toLowerCase(), S(a));
    const pr = split(a.principals);
    for (const p of pr) if (!principalSeen.has(p.toLowerCase())) principalSeen.set(p.toLowerCase(), S(a));
    const abroad = a.abroad === "Yes";
    if (!a.retention.trim() || /indefinite|not defined|n\/a|none/i.test(a.retention)) issues.push({ text: `"${a.activity}" has no defined retention period. DPDP section 8(7) expects data to be erased once its purpose is served.`, at: cellRef("Processing activities", S(a)) });
    activities.push({ name: a.activity, unit: a.unit, description: `${a.activity} for ${pr.join(", ") || "data principals"}.`, purpose, principals: pr, elements: els, systems: split(a.systems ?? ""), vendors: split(a.vendors ?? "").filter((n) => vendorNames.has(n.toLowerCase())), basis: a.basis, retention: a.retention, abroad, row: S(a) });
  }
  const purposes = [...purposeSeen].map(([k, row]) => ({ name: i.activities.find((a) => a.purpose.trim().toLowerCase() === k)!.purpose.trim(), row }));
  const elements = [...elementSeen].map(([k, row]) => {
    const name = i.activities.flatMap((a) => split(a.elements)).find((e) => e.toLowerCase() === k)!;
    return { name, sensitivity: classify(name), row };
  });
  const principals = [...principalSeen].map(([k, row]) => {
    const name = i.activities.flatMap((a) => split(a.principals)).find((e) => e.toLowerCase() === k)!;
    return { name, children: /minor|child|under 18/i.test(name), row };
  });
  for (const p of principals) if (p.children) issues.push({ text: `"${p.name}" are children. Section 9 requires verifiable consent from a parent or guardian and bars tracking and targeted advertising.`, at: cellRef("Processing activities", p.row) });


  // ------------------------------------------------ compare with what a connected database scan found
  const found = i.discovered ?? [];
  if (found.length) {
    const GENERIC = new Set(["data", "list", "table", "register", "master", "export", "details", "document", "record", "file", "tmp", "temp", "reference", "archive", "legacy", "backup", "copy", "old", "dump", "code", "number"]);
    const stem = (w: string) => w.replace(/(ies)$/, "y").replace(/s$/, "");
    const words = (t: string) => t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2).map(stem);
    // what the client wrote down: activity names, purposes, data elements, systems and stores (not the lists of people)
    const written = new Set(words([...i.activities.flatMap((a) => [a.activity, a.purpose, a.elements, a.systems]), ...i.stores.flatMap((s) => [s.system, s.store])].join(" ")));
    const SHADOW = /export|archive|legacy|(^|[_.])tmp|temp|backup|copy|dump|(^|[_.])old([_.]|$)|\d{4}$/i;
    const withPii = found.filter((t) => t.categories.length > 0);
    const at = (t: DiscoveredTable) => `Connector scan: ${t.connector}, ${t.location}`;
    const cats = (t: DiscoveredTable) => t.categories.filter((c) => c !== "location").join(", ") || t.categories.join(", ");
    for (const t of withPii) {
      const rowsText = t.rows ? ` (about ${t.rows.toLocaleString("en-IN")} rows)` : "";
      const sig = words(t.location.replace(/\./g, " ").replace(/_/g, " ")).filter((w) => !GENERIC.has(w));
      const mentioned = sig.some((w) => written.has(w));
      if (SHADOW.test(t.location)) {
        issues.push({ text: `${t.location} looks like a copy, export or archive and holds personal data (${cats(t)})${rowsText}. It is not on the Data Inventory. Copies like this are usually kept longer than anyone intends and are not covered by access controls or the retention rule.`, at: at(t) });
      } else if (!mentioned) {
        issues.push({ text: `${t.location} holds personal data (${cats(t)})${rowsText}, but nothing on the Data Inventory describes it. Ask who uses it and why, then add it to the inventory or remove it.`, at: at(t) });
      }
      // personal data sitting inside free-text columns, where no one would look for it
      const hidden = t.columns.filter((c) => c.categories.length > 0 && /char|text|json/i.test(c.type) && classifyName(c.name).length === 0);
      for (const c of hidden) issues.push({ text: `Column ${t.location}.${c.name} is free text, but the scan found ${c.categories.join(", ")} written inside it${rowsText}. People type personal details into free-text fields, so this column needs the same protection and retention as the structured ones.`, at: at(t) });
    }
    // the inventory says one thing, the database holds another
    const maskedAadhaar = i.activities.find((a) => /aadhaar\s*\(masked\)/i.test(a.elements));
    const aadhaarTables = withPii.filter((t) => t.columns.some((c) => c.categories.includes("aadhaar") && /aadhaar/i.test(c.name)));
    const aadhaarTable = aadhaarTables[0];
    if (maskedAadhaar && aadhaarTable) {
      issues.push({ text: `The Data Inventory says Aadhaar is kept masked (${cellRef("Processing activities", S(maskedAadhaar))}), but ${aadhaarTables.map((t) => t.location).join(" and ")} ${aadhaarTables.length > 1 ? "have" : "has an"} Aadhaar number column${aadhaarTables.length > 1 ? "s" : ""} whose sampled values match the full 12-digit pattern. The Aadhaar rules allow only masked or tokenised storage for most users, so check whether full numbers are being stored.`, at: at(aadhaarTable) });
    }
  }

  // ------------------------------------------------ questionnaire answers
  const prefill: LandscapeOutput["prefill"] = [];
  const add = (section: string, field: string, value: string | boolean | string[] | null, from: string, bag: Map<string, LandscapeOutput["prefill"][number]>) => {
    if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return;
    const e = bag.get(section) ?? { section, answers: {}, from: {} };
    e.answers[field] = value;
    e.from[field] = from;
    bag.set(section, e);
  };
  const bag = new Map<string, LandscapeOutput["prefill"][number]>();
  const org = i.scope?.org;
  const fromScope = (k: string, rowOf = org?.[k]?.row) => `${i.scope?.fileName ?? "Scope Intake Form"}, ${cellRef("Organisation", rowOf ?? 0)}`;
  if (org) {
    if (org.business_description?.value) add("organisation_profile", "summary", `${org.legal_name?.value ?? ""}: ${org.business_description.value}`.trim(), fromScope("business_description"), bag);
    const emp = Number((org.employees?.value ?? "").replace(/,/g, ""));
    if (emp) add("organisation_profile", "employees", employeesBucket(emp), fromScope("employees"), bag);
    if (org.website?.value) add("organisation_profile", "website", org.website.value, fromScope("website"), bag);
  }
  const regs = i.scope?.registrations ?? [];
  const regRow = (re: RegExp): RegRow | undefined => regs.find((r) => r.status !== "Lapsed" && re.test(`${r.registration} ${r.regulator}`));
  if (regs.length) {
    const sebi = regRow(/sebi/i), rbi = regRow(/\brbi\b/i), irdai = regRow(/irdai/i);
    add("organisation_profile", "sector", sebi ? "broking" : rbi ? "banking" : irdai ? "insurance" : null, `${i.scope!.fileName}, ${cellRef("Registrations", (sebi ?? rbi ?? irdai)?._row ?? 0)}`, bag);
    add("sector", "sebi", !!sebi, `${i.scope!.fileName}, ${sebi ? cellRef("Registrations", sebi._row) : "Sheet 'Registrations' (no SEBI registration listed)"}`, bag);
    add("sector", "rbi", !!rbi, `${i.scope!.fileName}, ${rbi ? cellRef("Registrations", rbi._row) : "Sheet 'Registrations' (no RBI registration listed)"}`, bag);
    add("sector", "irdai", !!irdai, `${i.scope!.fileName}, ${irdai ? cellRef("Registrations", irdai._row) : "Sheet 'Registrations' (no IRDAI registration listed)"}`, bag);
  }
  if (i.scope?.units.length) {
    const u = i.scope.units.filter((x) => x.personal !== "No");
    add("business_units", "units", u.map((x) => `${x.name}: ${x.does}`).join("\n"), `${i.scope.fileName}, Sheet 'Business units', rows ${u.map((x) => x._row).join(", ")}`, bag);
    add("business_units", "owners", u.map((x) => `${x.name}: ${x.head}`).join("\n"), `${i.scope.fileName}, Sheet 'Business units', column 'Head'`, bag);
  }
  add("processing_activities", "activities", activities.map((a) => a.name).join("\n"), `${i.fileName}, Sheet 'Processing activities', rows ${activities.map((a) => a.row).join(", ")}`, bag);
  add("processing_activities", "purposes", purposes.map((p) => p.name).join("\n"), `${i.fileName}, Sheet 'Processing activities', column 'Purpose'`, bag);
  const types = DATA_TYPE_WORDS.filter(([, re]) => elements.some((e) => re.test(e.name))).map(([k]) => k);
  add("data_categories", "data_types", types, `${i.fileName}, Sheet 'Processing activities', column 'Data elements' (${elements.length} distinct items read)`, bag);
  const pt = PRINCIPAL_WORDS.filter(([, re]) => principals.some((p) => re.test(p.name))).map(([k]) => k);
  add("data_categories", "principals", pt, `${i.fileName}, Sheet 'Processing activities', column 'Whose data'`, bag);
  if (principals.some((p) => p.children)) add("data_categories", "children_data", true, `${i.fileName}, ${cellRef("Processing activities", principals.find((p) => p.children)!.row)} (data principals include minors)`, bag);
  add("systems", "systems", systems.map((s) => `${s.name}${s.hosting ? ` (${s.hosting})` : ""}`).join("\n"), `${i.fileName}, Sheet 'Systems and data stores', rows ${systems.map((s) => s.row).join(", ")}`, bag);
  const cloudRow = i.stores.find((s) => /cloud/i.test(s.hosting ?? ""));
  add("systems", "cloud", !!cloudRow, `${i.fileName}, ${cloudRow ? cellRef("Systems and data stores", cloudRow._row) : "Sheet 'Systems and data stores' (no cloud hosting listed)"}`, bag);
  add("vendors", "uses_processors", vendors.length > 0, `${i.fileName}, Sheet 'Vendors' (${vendors.length} vendors listed)`, bag);
  add("vendors", "vendor_list", vendors.map((v) => `${v.name}: ${v.service}`).join("\n"), `${i.fileName}, Sheet 'Vendors', rows ${vendors.map((v) => v.row).join(", ")}`, bag);
  if (vendors.length) {
    const all = vendors.every((v) => v.dpa === "Yes");
    const none = vendors.every((v) => v.dpa === "No");
    add("vendors", "contracts", all ? "all" : none ? "none" : "some", `${i.fileName}, Sheet 'Vendors', column 'Contract with data protection terms?' (${vendors.filter((v) => v.dpa === "Yes").length} of ${vendors.length} fully covered)`, bag);
  }
  const outside = vendors.filter((v) => !/india/i.test(v.country));
  const abroadRow = i.activities.find((a) => a.abroad === "Yes");
  const outsideStore = i.stores.find((s) => /outside india/i.test(s.hosting ?? ""));
  const xb = outside.length > 0 || !!abroadRow || !!outsideStore;
  add("vendors", "cross_border", xb, `${i.fileName}, ${outside[0] ? cellRef("Vendors", outside[0].row) : abroadRow ? cellRef("Processing activities", abroadRow._row) : outsideStore ? cellRef("Systems and data stores", outsideStore._row) : "all sheets (nothing listed outside India)"}`, bag);
  if (outside.length) add("vendors", "countries", uniq(outside.map((v) => v.country)).join(", "), `${i.fileName}, Sheet 'Vendors', column 'Country'`, bag);

  // the Practices sheet carries the organisation's own answers
  for (const p of i.practices) {
    if (!p.answer.trim()) continue;
    const [sec, field] = p.key.split(".");
    const v = optionValue(sec!, field!, p.answer);
    const f = SECTIONS.find((s) => s.key === sec)?.fields.find((x) => x.key === field);
    if (v === null) continue;
    const text = f?.type === "text" || f?.type === "line" ? (p.document ? `${p.answer} (see ${p.document})` : p.answer) : v;
    add(sec!, field!, text as string | boolean, `${i.fileName}, ${cellRef("Practices", p.row, ` (${p.ref})`)}${p.document ? `, written down in: ${p.document}` : ""}`, bag);
  }
  prefill.push(...bag.values());

  for (const p of i.practices) {
    if (!p.answer.trim()) continue;
    if (/^(no|not sure)$/i.test(p.answer.trim()) && /(policy|breach_plan|retention_schedule|grievance|rights_process|erasure_process)$/.test(p.key)) {
      issues.push({ text: `Answered "${p.answer}" to: ${p.label}. This is a likely gap for the assessment.`, at: cellRef("Practices", p.row, ` (${p.ref})`) });
    }
  }

  const answered = prefill.reduce((n, p) => n + Object.keys(p.answers).length, 0);
  const scanNote = found.length ? ` Compared with the database scan (${found.length} tables, ${found.filter((t) => t.categories.length).length} holding personal data).` : "";
  const brief = `Read ${activities.length} processing activities, ${systems.length} systems, ${vendors.length} vendors and ${i.practices.filter((p) => p.answer.trim()).length} practice answers.${scanNote} Ready to load: ${purposes.length} purposes, ${elements.length} data elements, ${principals.length} groups of people. Drafted ${answered} questionnaire answers across ${prefill.length} steps. ${issues.length} point${issues.length === 1 ? "" : "s"} to raise.`;
  const confidence = Math.max(0.6, 0.95 - issues.filter((x) => /not listed|not loaded/.test(x.text)).length * 0.05);
  return { systems, stores, vendors, purposes, elements, principals, activities, issues, brief, confidence, prefill };
}

export const landscapeTask: TaskDef<LandscapeInput, LandscapeOutput> = {
  kind: "landscape_intake",
  outputSchema: landscapeOutput,
  offline: offlineLandscape,
  system:
    "You read a client's filled Data Inventory for a DPDP (India) engagement and return structured records for the data landscape plus draft answers to the discovery questionnaire, each citing the sheet and row it came from. Do not invent facts that are not in the file.",
  prompt: (i) => JSON.stringify({ activities: i.activities, stores: i.stores, vendors: i.vendors, practices: i.practices }).slice(0, 12000),
};

// ------------------------------------------------------------------ drafts
const upload = (i: LandscapeInput) => ({
  origin: `Uploaded by ${who(i.uploadedBy)} on ${i.uploadedAt.slice(0, 10)}`,
  providedBy: { name: i.uploadedBy.name, side: (i.uploadedBy.side === "system" ? "primus" : i.uploadedBy.side) as "primus" | "client" },
  channel: "Live Run, phase 2 (Discovery): Data Inventory upload",
  at: i.uploadedAt,
  ref: i.fileId,
});

export function landscapeLoadDraft(i: LandscapeInput, engagementId: string, o: LandscapeOutput): SuggestionDraft {
  const n = { a: o.activities.length, s: o.systems.length, v: o.vendors.length, p: o.purposes.length, e: o.elements.length, d: o.principals.length };
  const preview = [
    ...o.activities.slice(0, 20).map((a) => `Activity: ${a.name} (${a.unit}) · ${a.elements.length} data items · ${a.vendors.length} vendors`),
    ...o.vendors.map((v) => `Vendor: ${v.name} · contract ${v.dpa.toLowerCase()} · ${v.country}`),
  ];
  return {
    kind: "landscape_load",
    subjectType: "engagement",
    subjectId: engagementId,
    title: `Load the data landscape: ${n.a} activities, ${n.s} systems, ${n.v} vendors`,
    summary: o.brief,
    proposed: { counts: n, preview, issues: o.issues.map((x) => `${x.text} (${x.at})`), _plan: { ...o, prefill: undefined } },
    rationale: `${o.brief} Nothing is deleted; names that already exist on the platform are reused.`,
    citations: [],
    sources: [
      {
        type: "document",
        label: `Data Inventory (${i.fileName})`,
        ...upload(i),
        why: "The client's own list of what personal data it handles, where, and with whom.",
        detail: `Processing activities: ${n.a} rows · Systems and data stores: ${i.stores.length} rows · Vendors: ${n.v} rows`,
        link: "/live",
      },
      ...(i.discovered?.length
        ? [{
            type: "record" as const,
            label: `Database scan (${[...new Set(i.discovered.map((t) => t.connector))].join(", ")})`,
            origin: "Read directly from the client's database by the PostgreSQL connector, read-only",
            providedBy: { name: null, side: "system" as const },
            channel: "Live Run, phase 2 (Discovery): Connect a system",
            why: "Shows what the database really holds, to compare with what the Data Inventory says.",
            detail: `${i.discovered.length} tables read · ${i.discovered.filter((t) => t.categories.length).length} hold personal data · only names, types and categories kept, no values`,
            link: "/live",
          }]
        : []),
    ],
    confidence: o.confidence,
    tier: "low",
    inputHash: inputHash({ k: "landscape_load", f: i.fileId }),
  };
}

export function discoveryPrefillDraft(i: LandscapeInput, engagementId: string, o: LandscapeOutput): SuggestionDraft | null {
  if (o.prefill.length === 0) return null;
  const title = (k: string) => SECTIONS.find((s) => s.key === k)?.title ?? k;
  const label = (s: string, f: string) => SECTIONS.find((x) => x.key === s)?.fields.find((x) => x.key === f)?.label ?? f;
  const fmt = (v: string | boolean | string[]) => (typeof v === "boolean" ? (v ? "Yes" : "No") : Array.isArray(v) ? v.join(", ") : v.replace(/\n/g, " / "));
  const preview = o.prefill.flatMap((p) => Object.entries(p.answers).map(([f, v]) => `${title(p.section)} — ${label(p.section, f)}: ${fmt(v).slice(0, 160)}  [${p.from[f]}]`));
  const total = preview.length;
  const sections = Object.fromEntries(o.prefill.map((p) => [p.section, { answers: p.answers, from: p.from }]));
  return {
    kind: "discovery_prefill",
    subjectType: "engagement",
    subjectId: engagementId,
    title: `Pre-fill ${total} questionnaire answers across ${o.prefill.length} steps`,
    summary: `Drafted from the Data Inventory${i.scope ? " and the Scope Intake Form" : ""}. Each answer names the cell it came from. The client still reviews, completes and submits the questionnaire.`,
    proposed: { answers: total, steps: o.prefill.length, preview, _sections: sections },
    rationale: "Answers are copied or derived from what the client wrote. Nothing here is a judgement about compliance. A person approves before they are saved, because the questionnaire is the client's own statement.",
    citations: [],
    sources: [
      { type: "document", label: `Data Inventory (${i.fileName})`, ...upload(i), why: "The sheets and the Practices answers are the source of every draft answer.", detail: `${total} answers drafted`, link: "/live" },
      ...(i.scope ? [{ type: "document" as const, label: `Scope Intake Form (${i.scope.fileName})`, origin: "Uploaded earlier in the run (phase 1)", why: "The organisation profile, business units and registrations come from phase 1.", detail: `${Object.keys(i.scope.org).length} form answers, ${i.scope.units.length} units, ${i.scope.registrations.length} registrations` }] : []),
      { type: "questionnaire", label: "Discovery questionnaire (13 steps)", origin: "The platform's own questionnaire", why: "These are the questions being answered.", link: "/discovery" },
    ],
    confidence: 0.9,
    tier: "low",
    needsHuman: "Questionnaire answers are the client's own statement, so a person confirms them before they are saved.",
    inputHash: inputHash({ k: "discovery_prefill", f: i.fileId }),
  };
}
