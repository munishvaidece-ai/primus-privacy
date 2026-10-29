// A plain sentence or two on the regulation behind a control, for findings and reports.
import { allSectorControls } from "./index";
import { mappingFor, penaltyFor } from "./dpdp";
import { overlapsForControl, type Overlap } from "./overlaps";

export interface RegulationNote {
  lines: string[];
  /** Penalty ceiling text, labelled so nobody reads it as a prediction. */
  ceiling: string | null;
  /** Where sector law overlaps this control, for flagging. */
  overlaps: Overlap[];
}

export function regulationNote(controlCode: string): RegulationNote | null {
  const m = mappingFor(controlCode);
  if (m) {
    const pen = penaltyFor(m.penalty);
    return {
      lines: [`DPDP Act ${m.sections.join(", ")}${m.rules.length ? `; DPDP Rules ${m.rules.map((r) => `r.${r}`).join(", ")}` : ""}`],
      ceiling: `The Act's penalty ceiling for this kind of failure is ${pen.maxText}. This is a maximum set by the Schedule, not a prediction; the Data Protection Board decides the amount.`,
      overlaps: overlapsForControl(controlCode),
    };
  }
  const s = allSectorControls().find((c) => c.code === controlCode);
  if (s) {
    return {
      lines: [`${s.sectorLabel}: ${s.instrumentName}${s.instrumentConfirmed ? "" : " (check before use)"}`],
      ceiling: null,
      overlaps: overlapsForControl(controlCode),
    };
  }
  return null;
}
