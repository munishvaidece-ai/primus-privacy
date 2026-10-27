// Who may have to be told when a personal data incident happens, for one organisation.
// Pure catalogue code: the DPDP duty plus the sector and cross-sector incident-reporting controls.
import { SECTORS } from "./index";
import { RULE_PHASES } from "./dpdp";
import type { SectorKey } from "./types";

export interface IncidentDuty {
  /** Who is told. */
  body: string;
  /** What the duty asks, in one sentence. */
  asks: string;
  /** Control code in the library that tests it, if any. */
  control: string | null;
  /** From when the duty can be enforced (ISO date), where known. */
  inForce: string | null;
  /** false = indicative: check the source before relying on it. */
  confirmed: boolean;
}

/** The DPDP duty (s.8(6) and Rule 7) that applies to every Data Fiduciary. */
export const DPDP_INCIDENT_DUTY: IncidentDuty = {
  body: "Data Protection Board of India, and each affected person",
  asks: "Tell the Board without delay and send a detailed report within 72 hours of becoming aware. Tell each affected person in plain language.",
  control: "BRE-02",
  inForce: RULE_PHASES["18m"].date,
  confirmed: true,
};

const REGULATOR = /\b(CERT-In|SEBI|RBI|IRDAI|DoT|TRAI|NABARD|IRDA|DGCA|BCAS)\b/;

/** Incident-reporting duties for the sectors an organisation is in, plus the cross-sector ones. */
export function incidentDuties(sectors: SectorKey[]): IncidentDuty[] {
  const keys = new Set<SectorKey>([...sectors, "all"]);
  const out: IncidentDuty[] = [DPDP_INCIDENT_DUTY];
  for (const s of SECTORS.filter((x) => keys.has(x.key))) {
    for (const c of s.controls) {
      if (!/incident/i.test(c.title) || /^BRE-/.test(c.code)) continue;
      const inst = s.instruments.find((i) => i.id === c.instrument);
      const body = c.title.match(REGULATOR)?.[0] ?? inst?.regulator ?? s.label;
      out.push({ body, asks: c.description, control: c.code, inForce: null, confirmed: inst?.confirmed ?? false });
    }
  }
  return out;
}
