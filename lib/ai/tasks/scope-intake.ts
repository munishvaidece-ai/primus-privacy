// Phase 1: reads the filled Scope Intake Form (and any supporting documents) and
// proposes which sector rules apply and which business units to set up.
// Rules engine only: it looks for named regulators and registrations, and says
// exactly which cell each conclusion came from. Anything it cannot be sure of
// goes to a person.
import { z } from "zod";
import type { TaskDef } from "../engine";
import type { Source, SuggestionDraft } from "../types";
import { inputHash } from "../text";
import { SELECTABLE_SECTORS, sectorByKey, type SectorKey } from "../../regulation";
import type { Actor } from "../provenance";
import { who } from "../provenance";

export interface ScopeIntakeInput {
  fileId: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: Actor;
  /** Form answers keyed by field key, with the sheet row each came from. */
  org: Record<string, { value: string; row: number }>;
  registrations: Array<{ row: number; registration: string; regulator: string; number: string; status: string }>;
  units: Array<{ row: number; name: string; does: string; head: string; personal: string; staff: string }>;
  systems: Array<{ row: number; system: string; purpose: string; hosting: string; client_data: string }>;
  supporting: Array<{ filename: string; text: string }>;
  existingUnits: string[];
  existingSectors: SectorKey[];
}

const sectorKey = z.enum(SELECTABLE_SECTORS.map((s) => s.key) as [SectorKey, ...SectorKey[]]);

export const scopeIntakeOutput = z.object({
  sectors: z.array(
    z.object({
      key: sectorKey,
      confidence: z.number().min(0).max(1),
      reasons: z.array(z.object({ text: z.string(), at: z.string() })).min(1),
      needsHuman: z.string().optional(),
    }),
  ),
  units: z.array(z.object({ name: z.string(), does: z.string(), head: z.string(), row: z.number() })),
  skippedUnits: z.array(z.object({ name: z.string(), why: z.string() })),
  flags: z.array(z.object({ text: z.string(), at: z.string() })),
  brief: z.string(),
  unitsConfidence: z.number().min(0).max(1),
});
export type ScopeIntakeOutput = z.infer<typeof scopeIntakeOutput>;

interface Rule {
  key: SectorKey;
  /** Words that, in a registration or its regulator, are strong proof. */
  registered: RegExp;
  /** Words that, anywhere else in the form, only suggest it. */
  mentioned: RegExp;
}

const RULES: Rule[] = [
  { key: "broking", registered: /\bsebi\b.*(broker|depository|research analyst|investment adviser|portfolio manager)|(stock ?broker|depository participant|trading member|clearing member)/i, mentioned: /stock ?brok|depository|demat|\bnse\b|\bbse\b|trading platform|capital market/i },
  { key: "banking", registered: /\brbi\b|\bnbfc\b|payment aggregator|prepaid payment|non-banking financial/i, mentioned: /\bnbfc\b|non-banking|lending|loan|margin trading fund|payment gateway|bank\b/i },
  { key: "insurance", registered: /\birdai\b|corporate agent|insurance (broker|web aggregator)|\bposp\b/i, mentioned: /insurance|policyholder|premium/i },
  { key: "healthcare", registered: /clinical establishment|\bnmc\b|\babdm\b|nabh|nabl|pharmacy licen|drug licen/i, mentioned: /hospital|clinic|patient|diagnostic|telemedicine|pharmacy/i },
  { key: "telecom", registered: /\bdot\b|telecom licen|\btrai\b|internet service provider|\bisp\b|unified licen/i, mentioned: /telecom|subscriber|broadband|messaging platform/i },
  { key: "ecommerce", registered: /e-?commerce (entity|licen)|marketplace registration/i, mentioned: /e-?commerce|online marketplace|online store|marketplace|consumer app/i },
  { key: "ott", registered: /\bmib\b|ott (registration|platform)/i, mentioned: /\bott\b|streaming|online gaming|social media platform|publisher of news/i },
  { key: "aviation", registered: /\bdgca\b|\bbcas\b|air operator|airport operator/i, mentioned: /airline|airport|aviation|passenger|travel agen/i },
  { key: "ai", registered: /ai (registration|governance)/i, mentioned: /artificial intelligence|machine learning|model training|\bllm\b|ai platform|ai product/i },
  { key: "education", registered: /\bugc\b|\baicte\b|\bcbse\b|school board|university grants|ministry of education/i, mentioned: /school|college|university|students|edtech|learning platform|coaching|tuition/i },
  { key: "msme", registered: /\budyam\b|\bmsme\b registration/i, mentioned: /\bmsme\b|micro enterprise|small enterprise|startup recognition|dpiit/i },
  { key: "pharma", registered: /\bcdsco\b|\bdcgi\b|drug (manufacturing )?licen|clinical trial (approval|registration)|\bctri\b|\bpvpi\b|wholesale drug/i, mentioned: /pharma|drug maker|clinical trial|\bcro\b|pharmacovigilance|formulation|api manufactur|life sciences/i },
  { key: "psu", registered: /\bcpse\b|central public sector|state public sector|\bpsu\b|navratna|maharatna|miniratna|\bdpe\b/i, mentioned: /public sector (undertaking|enterprise)|government company|owned by the government|\bpsu\b|\bcpse\b/i },
  { key: "energy", registered: /\bcea\b|electricity regulatory|\bpngrb\b|generation licen|distribution licen|city gas|transmission licen|\bmnre\b|\bcerc\b|\bserc\b/i, mentioned: /power (plant|generation|distribution)|discom|electricity|\bsolar\b|wind farm|oil and gas|city gas|\bcng\b|\bpng\b|pipeline|refiner/i },
  { key: "manufacturing", registered: /factory licen|factories act|\bbis\b licen|\bboiler\b|manufacturing unit/i, mentioned: /manufactur|factory|plant operations|assembly line|automotive|oem|contract labour/i },
  { key: "realestate", registered: /\brera\b|real estate regulatory/i, mentioned: /real estate|developer|housing project|realty|construction company|property management|co-living/i },
  { key: "logistics", registered: /aggregator licen|transport licen|permit.*vehicle|\bcourier licen|\be-?way\b/i, mentioned: /logistics|courier|freight|warehous|fleet|delivery partner|ride[- ]hailing|last[- ]mile|supply chain/i },
  { key: "itbpo", registered: /\bstpi\b|\bsez\b unit|software technology park|export oriented unit/i, mentioned: /it services|software services|\bbpo\b|\bkpo\b|global capability cent|\bgcc\b|offshore delivery|outsourc(ing|ed) services|managed services/i },
  { key: "government", registered: /government of india|state government|ministry of|statutory body/i, mentioned: /government department|public authority|municipal|statutory/i },
];

const pct = (n: number) => Math.round(n * 100);

export function offlineScopeIntake(i: ScopeIntakeInput): ScopeIntakeOutput {
  const sectors: ScopeIntakeOutput["sectors"] = [];
  const orgText = (k: string) => i.org[k]?.value ?? "";
  const group = orgText("group_entities");
  const desc = orgText("business_description");
  const sheetOrg = (k: string) => `Sheet 'Organisation', row ${i.org[k]?.row ?? "?"}`;
  const support = i.supporting.map((s) => ({ name: s.filename, text: s.text }));

  for (const rule of RULES) {
    const reasons: Array<{ text: string; at: string }> = [];
    let strong = false;
    for (const r of i.registrations) {
      if (r.status === "Lapsed") continue;
      const hay = `${r.registration} ${r.regulator}`;
      if (rule.registered.test(hay)) {
        strong = true;
        reasons.push({ text: `Registered as "${r.registration}" with ${r.regulator}${r.number ? ` (${r.number})` : ""}, status ${r.status.toLowerCase()}.`, at: `Sheet 'Registrations', row ${r.row}` });
      }
    }
    const weak: Array<{ text: string; at: string }> = [];
    if (rule.mentioned.test(desc)) weak.push({ text: "The description of the business mentions it.", at: sheetOrg("business_description") });
    if (rule.mentioned.test(group)) weak.push({ text: "A group company is described in terms of this sector.", at: sheetOrg("group_entities") });
    for (const u of i.units) if (rule.mentioned.test(`${u.name} ${u.does}`)) weak.push({ text: `Business unit "${u.name}" does related work.`, at: `Sheet 'Business units', row ${u.row}` });
    for (const sp of support) if (rule.mentioned.test(sp.text)) weak.push({ text: `The supporting document "${sp.name}" mentions it.`, at: `Supporting document ${sp.name}` });
    if (strong) {
      const corroboration = Math.min(weak.length, 3) * 0.01;
      sectors.push({ key: rule.key, confidence: Math.min(0.99, 0.95 + corroboration), reasons: [...reasons, ...weak.slice(0, 2)] });
    } else if (weak.length >= 2) {
      // Only described, never registered. Often a group company or a side activity, so a person decides.
      const inGroupOnly = rule.mentioned.test(group) && !rule.mentioned.test(desc);
      sectors.push({
        key: rule.key,
        confidence: inGroupOnly ? 0.58 : 0.66,
        reasons: weak.slice(0, 3),
        needsHuman: inGroupOnly
          ? "this is only mentioned for a group company, and no registration for it is listed. Confirm whether this engagement also covers that entity."
          : "it is described but no registration is listed. Confirm that the organisation does this activity itself.",
      });
    }
  }
  sectors.sort((a, b) => b.confidence - a.confidence);

  const existing = new Set(i.existingUnits.map((u) => u.toLowerCase()));
  const units: ScopeIntakeOutput["units"] = [];
  const skippedUnits: ScopeIntakeOutput["skippedUnits"] = [];
  const seen = new Set<string>();
  for (const u of i.units) {
    const k = u.name.toLowerCase();
    if (u.personal.toLowerCase() === "no") skippedUnits.push({ name: u.name, why: "marked as not handling personal data" });
    else if (existing.has(k)) skippedUnits.push({ name: u.name, why: "already set up on the platform" });
    else if (seen.has(k)) skippedUnits.push({ name: u.name, why: "listed twice" });
    else {
      seen.add(k);
      units.push({ name: u.name, does: u.does, head: u.head, row: u.row });
    }
  }

  const flags: ScopeIntakeOutput["flags"] = [];
  const clients = Number((orgText("clients") || "0").replace(/,/g, ""));
  if (clients >= 1_000_000) flags.push({ text: `${clients.toLocaleString("en-IN")} clients' personal data is held. A Significant Data Fiduciary is chosen by Government notification, so only a person can confirm it, but the volume is high enough to ask.`, at: sheetOrg("clients") });
  const hay = `${desc} ${group} ${i.units.map((u) => `${u.name} ${u.does}`).join(" ")} ${support.map((s) => s.text).join(" ")}`;
  if (/minor|child|under 18|guardian/i.test(hay)) flags.push({ text: "The firm serves minors or children (for example minor accounts operated by a guardian), so the children's data duties (section 9) are likely to apply.", at: "Business description, business units or supporting documents" });
  if (group.trim()) flags.push({ text: "Data is shared with group companies. Each needs a check on whether it is a separate Data Fiduciary or a processor.", at: sheetOrg("group_entities") });
  if (Number(orgText("partners") || "0") > 0) flags.push({ text: `${orgText("partners")} authorised persons or agents see client data. Their access and contracts need checking.`, at: sheetOrg("partners") });
  if (!orgText("privacy_contact").trim()) flags.push({ text: "No person is named to answer privacy questions. DPDP expects one contact point.", at: sheetOrg("privacy_contact") });
  for (const s of i.systems) if (/outside india|abroad|overseas/i.test(`${s.hosting} ${s.purpose}`)) flags.push({ text: `System "${s.system}" appears to be hosted or used outside India (cross-border transfer).`, at: `Sheet 'Systems', row ${s.row}` });

  const named = sectors.filter((s) => !s.needsHuman).map((s) => sectorByKey(s.key)?.label ?? s.key);
  const brief = `${orgText("legal_name") || "The organisation"} (${orgText("entity_type") || "entity type not stated"}, ${orgText("employees") || "?"} employees, ${orgText("clients") || "?"} clients). ${named.length ? `Sector rules found from its registrations: ${named.join("; ")}.` : "No sector could be confirmed from its registrations."} ${units.length} business unit${units.length === 1 ? "" : "s"} to set up. ${flags.length} point${flags.length === 1 ? "" : "s"} to raise with the client.`;

  const total = i.units.length || 1;
  const bad = i.units.filter((u) => !u.name || !u.does || !u.head).length;
  return { sectors, units, skippedUnits, flags, brief, unitsConfidence: bad ? Math.max(0.5, 0.95 - bad / total) : 0.97 };
}

export const scopeIntakeTask: TaskDef<ScopeIntakeInput, ScopeIntakeOutput> = {
  kind: "scope_intake",
  outputSchema: scopeIntakeOutput,
  offline: offlineScopeIntake,
  system:
    "You read a client's filled Scope Intake Form for a DPDP (India) engagement. Decide which sector rule sets apply, citing the sheet and row each conclusion comes from. " +
    `Sector keys: ${SELECTABLE_SECTORS.map((s) => s.key).join(", ")}. A sector backed by a registration is strong; one only described in text is weak and needs a person.`,
  prompt(i) {
    return `FORM:\n${JSON.stringify({ org: i.org, registrations: i.registrations, units: i.units, systems: i.systems }, null, 1).slice(0, 6000)}\n\nSUPPORTING:\n${i.supporting.map((s) => `${s.filename}: ${s.text.slice(0, 1200)}`).join("\n")}`;
  },
};

// ------------------------------------------------------------------ drafts
const upload = (i: ScopeIntakeInput): Pick<Source, "origin" | "providedBy" | "channel" | "at" | "ref"> => ({
  origin: `Uploaded by ${who(i.uploadedBy)} on ${i.uploadedAt.slice(0, 10)}`,
  providedBy: { name: i.uploadedBy.name, side: i.uploadedBy.side === "system" ? "primus" : i.uploadedBy.side },
  channel: "Live Run, phase 1 (Engagement set up): Scope Intake Form upload",
  at: i.uploadedAt,
  ref: i.fileId,
});

export function scopeSectorDraft(i: ScopeIntakeInput, engagementId: string, s: ScopeIntakeOutput["sectors"][number]): SuggestionDraft {
  const label = sectorByKey(s.key)?.label ?? s.key;
  const sources: Source[] = [
    {
      type: "document",
      label: `Scope Intake Form (${i.fileName})`,
      ...upload(i),
      why: `The form lists the organisation's registrations and activities, which decide which sector rules apply.`,
      detail: s.reasons.map((r) => `${r.at}: ${r.text}`).join(" · "),
      link: "/live",
    },
  ];
  const rationale = `${label} rules apply because: ${s.reasons.map((r) => `${r.text} (${r.at})`).join(" ")}`;
  return {
    kind: "scope_sector",
    subjectType: "engagement",
    subjectId: engagementId,
    title: `Add sector: ${label}`,
    summary: rationale,
    proposed: { sector: s.key, sectorLabel: label, reasons: s.reasons.map((r) => `${r.text} (${r.at})`) },
    rationale,
    citations: [],
    sources,
    confidence: s.confidence,
    tier: "medium",
    needsHuman: s.needsHuman,
    inputHash: inputHash({ k: "scope_sector", f: i.fileId, s: s.key }),
  };
}

export function scopeUnitsDraft(i: ScopeIntakeInput, engagementId: string, o: ScopeIntakeOutput): SuggestionDraft {
  const rationale = `${o.units.length} business unit${o.units.length === 1 ? "" : "s"} listed on the form handle personal data and are not yet on the platform. ${o.skippedUnits.length ? `Left out: ${o.skippedUnits.map((u) => `${u.name} (${u.why})`).join("; ")}.` : ""}`;
  return {
    kind: "scope_units",
    subjectType: "engagement",
    subjectId: engagementId,
    title: `Set up ${o.units.length} business unit${o.units.length === 1 ? "" : "s"}`,
    summary: rationale,
    proposed: { units: o.units.map((u) => ({ name: u.name, does: u.does, head: u.head })), skipped: o.skippedUnits.map((u) => `${u.name}: ${u.why}`) },
    rationale,
    citations: [],
    sources: [
      {
        type: "document",
        label: `Scope Intake Form, sheet 'Business units' (${i.fileName})`,
        ...upload(i),
        why: "Business units are listed here by the client, with what each does and who heads it.",
        detail: o.units.map((u) => `row ${u.row}: ${u.name}`).join(" · "),
      },
    ],
    confidence: o.unitsConfidence,
    tier: "low",
    inputHash: inputHash({ k: "scope_units", f: i.fileId }),
  };
}
