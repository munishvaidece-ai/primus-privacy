// The regulation catalogue: DPDP (Part A) plus sector rules (Part B).
// All content is indicative and not legal advice. Instruments marked
// confirmed=false must be checked before client use.
import type { Sector, SectorControl, SectorKey } from "./types";
import { ALL } from "./sectors/all";
import { BROKING } from "./sectors/broking";
import { BANKING } from "./sectors/banking";
import { INSURANCE } from "./sectors/insurance";
import { HEALTHCARE } from "./sectors/healthcare";
import { TELECOM } from "./sectors/telecom";
import { ECOMMERCE } from "./sectors/ecommerce";
import { OTT } from "./sectors/ott";
import { AVIATION } from "./sectors/aviation";
import { AI } from "./sectors/ai";
import { EDUCATION } from "./sectors/education";
import { MSME } from "./sectors/msme";
import { GOVERNMENT } from "./sectors/government";
import { PHARMA } from "./sectors/pharma";
import { PSU } from "./sectors/psu";
import { ENERGY } from "./sectors/energy";
import { MANUFACTURING } from "./sectors/manufacturing";
import { REALESTATE } from "./sectors/realestate";
import { LOGISTICS } from "./sectors/logistics";
import { ITBPO } from "./sectors/itbpo";

export * from "./types";
export * from "./dpdp";
export { incidentDuties, DPDP_INCIDENT_DUTY, type IncidentDuty } from "./incident";

export const SECTORS: Sector[] = [BROKING, BANKING, INSURANCE, HEALTHCARE, PHARMA, TELECOM, ECOMMERCE, OTT, AVIATION, LOGISTICS, ENERGY, MANUFACTURING, REALESTATE, ITBPO, AI, EDUCATION, MSME, GOVERNMENT, PSU, ALL];

/** Sectors a user can pick (the cross-sector set applies to every selection). */
export const SELECTABLE_SECTORS: Sector[] = SECTORS.filter((s) => s.key !== "all");

export function sectorByKey(key: string): Sector | undefined {
  return SECTORS.find((s) => s.key === key);
}

export function isSectorKey(key: string): key is SectorKey {
  return SECTORS.some((s) => s.key === key);
}

export interface FlatSectorControl extends SectorControl {
  sector: SectorKey;
  sectorLabel: string;
  instrumentName: string;
  instrumentConfirmed: boolean;
}

export function allSectorControls(): FlatSectorControl[] {
  return SECTORS.flatMap((s) =>
    s.controls.map((c) => {
      const inst = s.instruments.find((i) => i.id === c.instrument);
      return { ...c, sector: s.key, sectorLabel: s.label, instrumentName: inst?.name ?? c.instrument, instrumentConfirmed: inst?.confirmed ?? false };
    }),
  );
}

/** Sector key for a control code, or null for a DPDP control. */
export function sectorOfControl(code: string): SectorKey | null {
  const prefix = code.split("-")[0];
  const s = SECTORS.find((x) => x.prefix === prefix);
  return s ? s.key : null;
}

/** Controls that apply to a set of selected sectors (cross-sector controls always included). */
export function controlsForSectors(selected: SectorKey[]): FlatSectorControl[] {
  const keys = new Set<SectorKey>(["all", ...selected]);
  return allSectorControls().filter((c) => keys.has(c.sector));
}

export * from "./applicability";
