// Assembles the Orchid Hill demo pack: filled templates and documents, in folders named by phase.
import { buildTemplateWorkbook, type Filled } from "@/lib/templates/build";
import { TEMPLATES } from "@/lib/templates/definitions";
import { EVIDENCE, INVENTORY_SUPPORT, SCOPE_SUPPORT } from "./evidence";
import { INVENTORY_FILLED, SCOPE_FILLED, TESTS_FILLED } from "./content";
import { CLOSURES_FILLED, PROOFS } from "./closure";

export function evidenceIndexFilled(): Filled {
  const rows = EVIDENCE.filter((d) => d.role !== "not_indexed").flatMap((d) =>
    d.controls.map((c) => ({ file: d.file, control: c, doctype: d.doctype, title: d.title, date: d.date, owner: d.owner, description: d.description })),
  );
  return { tables: { Evidence: rows } };
}

export const scopeFile = () => buildTemplateWorkbook("SCOPE-INTAKE", SCOPE_FILLED);
export const inventoryFile = () => buildTemplateWorkbook("DATA-INVENTORY", INVENTORY_FILLED);
export const testsFile = () => buildTemplateWorkbook("CONTROL-TEST-LOG", TESTS_FILLED);
export const indexFile = () => buildTemplateWorkbook("EVIDENCE-INDEX", evidenceIndexFilled());
export const closureFile = () => buildTemplateWorkbook("CLOSURE-PACK", CLOSURES_FILLED);

export const PHASE_FOLDERS = {
  1: "Phase 1 - Engagement set up",
  2: "Phase 2 - Discovery",
  3: "Phase 3 - Applicability",
  4: "Phase 4 - Assessment",
  5: "Phase 5 - Evidence validation",
  6: "Phase 6 - Findings released",
  7: "Phase 7 - Remediation and final report",
} as const;
export { TEMPLATES, EVIDENCE, SCOPE_SUPPORT, INVENTORY_SUPPORT, PROOFS };
