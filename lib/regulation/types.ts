// Regulation catalogue types. Plain data, no database or server code, so the
// seed scripts, the AI layer and the screens can all read the same catalogue.

export type SectorKey =
  | "all"
  | "broking"
  | "banking"
  | "insurance"
  | "healthcare"
  | "telecom"
  | "ecommerce"
  | "ott"
  | "aviation"
  | "ai"
  | "education"
  | "msme"
  | "government";

export interface Instrument {
  id: string;
  name: string;
  regulator: string;
  kind: "law" | "rules" | "regulation" | "directions" | "circular" | "guidelines" | "policy";
  /** What it asks of an organisation, in the privacy and data-protection sense. */
  summary: string;
  /** Primary source we checked, where we have one. */
  source?: string;
  /** true = name and date confirmed against a published source on the verified date; false = indicative, check before client use. */
  confirmed: boolean;
}

export interface SectorControl {
  code: string;
  title: string;
  type: "preventive" | "detective" | "corrective";
  description: string;
  /** Instrument id (within the same sector) this control comes from. */
  instrument: string;
  /** DPDP control codes this one works alongside (shown together). */
  related?: string[];
}

export interface Sector {
  key: SectorKey;
  label: string;
  /** Control code prefix used for this sector's controls, for example "BRK". */
  prefix: string;
  blurb: string;
  regulators: string[];
  instruments: Instrument[];
  controls: SectorControl[];
  /** How the DPDP Act and Rules interact with this sector. */
  dpdpInterplay: string[];
  /** Documents the AI would expect to see as evidence, in plain words. */
  typicalEvidence: string[];
}

export type PenaltyKey = "security" | "breach" | "children" | "sdf" | "duties" | "other";

export interface PenaltyRow {
  key: PenaltyKey;
  breach: string;
  section: string;
  maxCrore: number | null;
  maxText: string;
}

export interface DpdpRule {
  number: number;
  title: string;
  phase: "immediate" | "12m" | "18m";
}

export interface ControlMapping {
  sections: string[];
  rules: number[];
  penalty: PenaltyKey;
}
