import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PenaltyTable } from "@/components/regulation/parts";
import { OverlapList } from "@/components/regulation/overlap-list";
import { overlapsForSector, DPDP_RULES, DPDP_SECTIONS, DPDP_VERIFIED_ON, RULE_PHASES, SELECTABLE_SECTORS, type Sector, type SectorKey } from "@/lib/regulation";
import { questionsFor } from "@/lib/workspace/question-bank";

const CARD = "rounded-xl border border-slate-200 bg-white p-4 shadow-card";
const H2 = "font-display text-xl font-semibold text-slate-900";

/** Home pages of regulators, so a reader can find the original text. Only ones we are sure of; others are named without a link. */
const REGULATOR_SITES: Record<string, string> = {
  RBI: "rbi.org.in",
  SEBI: "sebi.gov.in",
  IRDAI: "irdai.gov.in",
  MeitY: "meity.gov.in",
  "CERT-In": "cert-in.org.in",
  TRAI: "trai.gov.in",
  DoT: "dot.gov.in",
  DGCA: "dgca.gov.in",
  CDSCO: "cdsco.gov.in",
  NPCI: "npci.org.in",
  "FIU-IND": "fiuindia.gov.in",
  CEA: "cea.nic.in",
  PNGRB: "pngrb.gov.in",
  UGC: "ugc.gov.in",
  NMC: "nmc.org.in",
  ICMR: "icmr.gov.in",
  DPE: "dpe.gov.in",
  CVC: "cvc.gov.in",
  CAG: "cag.gov.in",
  NIC: "nic.in",
};

function phaseStatus(date: string): { label: string; tone: "positive" | "warning" } {
  return date <= new Date().toISOString().slice(0, 10) ? { label: "In force", tone: "positive" } : { label: "Not yet in force", tone: "warning" };
}

export interface ResourcesProps {
  /** Page path, for the sector links and anchors, e.g. "/portal/resources". */
  basePath: string;
  /** Extra query to keep, e.g. "e=<engagement id>". */
  keep?: string;
  sector: Sector;
  /** Sectors that belong to the reader, shown as "yours" in the picker. */
  own?: SectorKey[];
  audience: "client" | "primus";
  /** Where the sector's question set lives for this reader. */
  questionsHref?: string;
}

/** The reading list: the DPDP Act, the Rules, the penalties, and one sector's laws and guidelines. */
export function ResourcesView({ basePath, keep, sector, own = [], audience, questionsHref }: ResourcesProps) {
  const you = audience === "client";
  const href = (key: string, hash = "") => `${basePath}?${keep ? `${keep}&` : ""}sector=${key}${hash}`;
  const byPhase = (["immediate", "12m", "18m"] as const).map((k) => ({ k, rules: DPDP_RULES.filter((r) => r.phase === k) }));
  const nQ = questionsFor(sector.key as SectorKey).length;
  return (
    <div className="space-y-12">
      <section aria-labelledby="pick" className="space-y-3">
        <h2 id="pick" className={H2}>{you ? "Choose your sector" : "Choose a sector"}</h2>
        <p className="max-w-3xl text-sm text-slate-600">{you ? "The DPDP Act and Rules are the same for everyone. Below them you will find the laws and guidelines for the sector you pick." : "The DPDP Act and Rules are the same for every client. The sector part below changes with your choice."}</p>
        <nav aria-label="Sectors" className="flex flex-wrap gap-2">
          {SELECTABLE_SECTORS.map((s) => (
            <Link key={s.key} href={href(s.key, "#sector")} aria-current={s.key === sector.key ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm ring-1 ring-inset ${s.key === sector.key ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}>
              {s.label}{own.includes(s.key) ? " · yours" : ""}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-slate-500">Jump to: <a href="#act" className="underline">DPDP Act</a> · <a href="#rules" className="underline">DPDP Rules</a> · <a href="#penalties" className="underline">Penalties</a> · <a href="#sector" className="underline">{sector.label}</a> · <a href="#sources" className="underline">Where to read the original</a></p>
        <p className="max-w-3xl rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">This is a reading aid, not legal advice. Last checked {DPDP_VERIFIED_ON}. Items marked &ldquo;check before use&rdquo; have not yet been confirmed against a published source, so confirm them with your legal counsel before you rely on them.</p>
      </section>

      <section id="act" aria-labelledby="act-h" className="scroll-mt-24 space-y-3">
        <h2 id="act-h" className={H2}>The Digital Personal Data Protection Act, 2023</h2>
        <p className="max-w-3xl text-sm text-slate-600">{you ? "These are the parts of the Act you will hear about most in your assessment." : "The parts of the Act the assessment controls point to."}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {DPDP_SECTIONS.map((s) => (
            <div key={s.ref} className={CARD}>
              <p className="font-medium text-slate-900">{s.ref} · {s.title}</p>
              <p className="mt-1 text-sm text-slate-600">{s.summary}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="rules" aria-labelledby="rules-h" className="scroll-mt-24 space-y-3">
        <h2 id="rules-h" className={H2}>The DPDP Rules, 2025, and when each part starts</h2>
        <div className="grid gap-3 lg:grid-cols-3">
          {byPhase.map(({ k, rules }) => {
            const st = phaseStatus(RULE_PHASES[k].date);
            return (
              <div key={k} className={CARD}>
                <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-slate-900">{RULE_PHASES[k].label}</p><Badge tone={st.tone}>{st.label}</Badge></div>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">{rules.map((r) => <li key={r.number}><span className="text-slate-500">Rule {r.number}.</span> {r.title}</li>)}</ul>
              </div>
            );
          })}
        </div>
      </section>

      <section id="penalties" aria-labelledby="pen-h" className="scroll-mt-24 space-y-3">
        <h2 id="pen-h" className={H2}>What a breach of the law can cost</h2>
        <p className="max-w-3xl text-sm text-slate-600">These are ceilings from the Schedule to the Act. The Data Protection Board decides the actual amount after looking at the facts, so they are not a prediction.</p>
        <PenaltyTable />
      </section>

      <section id="sector" aria-labelledby="sec-h" className="scroll-mt-24 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="sec-h" className={H2}>{sector.label}</h2>
          {own.includes(sector.key) ? <Badge tone="positive">{you ? "Your sector" : "Set for this client"}</Badge> : null}
        </div>
        <p className="max-w-3xl text-sm text-slate-600">{sector.blurb}</p>
        <p className="text-xs text-slate-500">Regulators: {sector.regulators.join(", ")}</p>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Laws, circulars and guidelines ({sector.instruments.length})</h3>
          <div className="mt-2 space-y-3">
            {sector.instruments.map((i) => (
              <div key={i.id} className={CARD}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">{i.name}</p>
                  <Badge tone={i.confirmed ? "positive" : "warning"}>{i.confirmed ? "Checked against a source" : "Check before use"}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{i.regulator} · {i.kind}</p>
                <p className="mt-1 text-sm text-slate-700">{i.summary}</p>
                {i.source ? <a href={i.source} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">Read the source</a> : null}
              </div>
            ))}
          </div>
        </div>

        <div className={CARD}>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">How this sits with the DPDP Act</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{sector.dpdpInterplay.map((t, k) => <li key={k}>{t}</li>)}</ul>
        </div>

        <OverlapList overlaps={overlapsForSector(sector.key)} you={you} />

        <div className={CARD}>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{you ? "Documents you should have ready" : "Documents to ask for"}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{sector.typicalEvidence.map((t, k) => <li key={k}>{t}</li>)}</ul>
        </div>

        {questionsHref && nQ > 0 ? <p className="text-sm text-slate-700">{you ? `There are ${nQ} questions written for this sector. ` : `The bank has ${nQ} questions for this sector. `}<Link href={questionsHref} className="font-medium text-brand-700 hover:underline">{you ? "Go to your question sets →" : "Open them in the question bank →"}</Link></p> : null}
      </section>

      <section id="sources" aria-labelledby="src-h" className="scroll-mt-24 space-y-3">
        <h2 id="src-h" className={H2}>Where to read the original</h2>
        <p className="max-w-3xl text-sm text-slate-600">Always read the official text. The Act is published in the Gazette of India and on India Code; the Rules and notices are published by the Ministry of Electronics and Information Technology. For the sector, the regulators below publish their own circulars.</p>
        <ul className="flex flex-wrap gap-2 text-sm">
          {[{ n: "India Code (the Act)", d: "indiacode.nic.in" }, { n: "MeitY", d: REGULATOR_SITES.MeitY! }, ...sector.regulators.filter((r) => r !== "MeitY" && REGULATOR_SITES[r]).map((r) => ({ n: r, d: REGULATOR_SITES[r]! }))].map((x) => (
            <li key={x.d}><a href={`https://${x.d}`} target="_blank" rel="noreferrer" className="inline-flex rounded-full bg-white px-3 py-1 text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">{x.n} · {x.d}</a></li>
          ))}
        </ul>
        {sector.regulators.some((r) => !REGULATOR_SITES[r]) ? <p className="text-xs text-slate-500">Also: {sector.regulators.filter((r) => !REGULATOR_SITES[r]).join(", ")}. Search for their official site.</p> : null}
      </section>
    </div>
  );
}
