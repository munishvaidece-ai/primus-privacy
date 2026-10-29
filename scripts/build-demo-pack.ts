// Builds the Orchid Hill demo pack: one folder per phase, with the blank template, the filled-in file
// and the supporting documents, plus a ZIP of everything for the Live Run screen to offer for download.
//
//   npx tsx scripts/build-demo-pack.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { zipSync } from "fflate";
import { buildTemplateWorkbook } from "../lib/templates/build";
import { buildXlsx } from "../lib/templates/xlsx";
import { TEMPLATES, type TemplateKey } from "../lib/templates/definitions";
import { SCOPE_FILLED } from "../lib/demo/orchid/content";
import { EVIDENCE, INVENTORY_SUPPORT, PHASE_FOLDERS, PROOFS, SCOPE_SUPPORT, closureFile, indexFile, inventoryFile, scopeFile, testsFile } from "../lib/demo/orchid/pack";
import { docBytes } from "../lib/demo/orchid/files";
import type { DocSpec } from "../lib/demo/orchid/evidence";

const ROOT = "demo-data/orchid-hill";
const files = new Map<string, Uint8Array>();
const put = (path: string, data: Uint8Array | string) => files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
const blank = (key: TemplateKey) => buildTemplateWorkbook(key);

const P = PHASE_FOLDERS;
const FROM_CLIENT = "From the client";
const FROM_PRIMUS = "From the Primus team";

const README = `ORCHID HILL SECURITIES LIMITED: DEMO PACK
==========================================
Orchid Hill is an invented stock broker and depository participant in Mumbai. Every name, number and
document here is fictional. Nothing in this pack is real client data.

HOW THE DEMO WORKS
Open the engagement "Orchid Hill: FY2026-27 privacy assessment" and go to Live Run. It has seven steps, one per
phase. For each step you do the same three things:
  1. Download the blank template (or open the filled one from this pack).
  2. Upload the filled template and the supporting files.
  3. Press "Run AI". The AI reads what was uploaded, does its job, and shows what it did and why.
Each step hands its result to the next. Where a decision needs a person, the AI stops and waits for one.

WHERE EACH FILE COMES FROM
${Object.entries(P).map(([n, f]) => `  ${f}`).join("\n")}

  Folders named "${FROM_CLIENT}" hold what the client sends. "${FROM_PRIMUS}" holds what our own team
  prepares. Each file is in the fixed template for its phase. The platform checks the template before the AI
  reads it, and it names the sheet, row and column of anything wrong.

PHASE BY PHASE: WHAT TO UPLOAD AND WHAT YOU WILL SEE
  Phase 1  Upload 01_Scope_Intake_Form.xlsx and the two support documents. The AI reads the registrations, picks the
           sector (Broking and Depository, applied by the AI) and proposes a second one (Banking and Lending, for the
           group NBFC) which it leaves for a person because the evidence is only a mention. It creates the business
           units. Flags: more than 10 lakh clients, minors' accounts, group data sharing, authorised persons.
  Phase 2  Upload 02_Data_Inventory.xlsx and the vendor list. The AI loads systems, data stores, vendors, purposes,
           data elements and 12 processing activities, and pre-fills the discovery questionnaire with the source cell
           beside every answer. A person reviews and approves the questionnaire.
  Phase 3  Nothing to upload. A person creates the scope; the AI decides, control by control, which of the 132 controls
           apply (25 DPDP controls, 66 sector controls) and says why. Controls for other sectors are marked not applicable.
  Phase 4  Upload 04_Control_Test_Log.xlsx (the Primus consultant's tests). The AI rates every control it has a test for.
  Phase 5  Upload 05_Evidence_Index.xlsx and the evidence files. The AI reads every file, decides whether it supports
           the control it is listed against, and re-rates the controls. Four files are deliberately bad: a draft policy,
           a scanned image, an irrelevant canteen menu, and a report that is listed but not uploaded.
  Phase 6  Nothing to upload. The AI drafts findings for weak controls. Critical ones wait for a person to release them.
  Phase 7  Upload 07_Remediation_Closure_Log.xlsx and the proof files. The AI turns each finding into a remediation
           action, then checks each proof against its action: close, send back, or reject. A person issues the final
           report.

BAD UPLOADS TO TRY (folder: "Try these bad uploads")
  - wrong_template_evidence_index_in_phase1.xlsx   Refused: the platform says which template this is.
  - renamed_heading_scope_intake.xlsx              Refused: a column heading was changed.
  - empty_required_cells_scope_intake.xlsx         Refused with sheet, row and column of each empty cell.
  - not_a_spreadsheet.txt                          Refused: not an Excel file.

YOUR RESULTS WILL NOT BE IDENTICAL EVERY TIME
Choices you make (who approves what, what you hold back) change what the later phases show. That is the point.

NO EXTERNAL AI IS USED
The AI here is the platform's own rules engine. It runs on this computer, sends nothing out, and shows the evidence
behind each decision. An external language model can be switched on later per engagement, with the client's consent.
`;

async function main() {
  rmSync(ROOT, { recursive: true, force: true });
  put("00_READ_ME_FIRST.txt", README);

  const doc = async (folder: string, d: DocSpec) => put(`${folder}/${d.file}`, await docBytes(d));

  // phase 1
  put(`${P[1]}/${FROM_CLIENT}/${TEMPLATES["SCOPE-INTAKE"].fileName}`, scopeFile());
  for (const d of SCOPE_SUPPORT) await doc(`${P[1]}/${FROM_CLIENT}`, d);
  put(`${P[1]}/Blank template/${TEMPLATES["SCOPE-INTAKE"].fileName.replace(".xlsx", "_BLANK.xlsx")}`, blank("SCOPE-INTAKE"));

  // phase 2
  put(`${P[2]}/${FROM_CLIENT}/${TEMPLATES["DATA-INVENTORY"].fileName}`, inventoryFile());
  for (const d of INVENTORY_SUPPORT) await doc(`${P[2]}/${FROM_CLIENT}`, d);
  put(`${P[2]}/Blank template/${TEMPLATES["DATA-INVENTORY"].fileName.replace(".xlsx", "_BLANK.xlsx")}`, blank("DATA-INVENTORY"));

  // phase 3 and 6: nothing to upload
  put(`${P[3]}/NOTHING_TO_UPLOAD.txt`, "No file is uploaded in this phase. A person creates the engagement scope on the platform and the AI decides, for each of the 132 controls, whether it applies. It uses the sectors and units from Phase 1 and the processing activities from Phase 2.\n");
  put(`${P[6]}/NOTHING_TO_UPLOAD.txt`, "No file is uploaded in this phase. The AI drafts findings from the weak ratings. Critical findings wait for an engagement manager to release them to the client.\n");

  // phase 4
  put(`${P[4]}/${FROM_PRIMUS}/${TEMPLATES["CONTROL-TEST-LOG"].fileName}`, testsFile());
  put(`${P[4]}/Blank template/${TEMPLATES["CONTROL-TEST-LOG"].fileName.replace(".xlsx", "_BLANK.xlsx")}`, blank("CONTROL-TEST-LOG"));

  // phase 5
  put(`${P[5]}/${FROM_CLIENT}/${TEMPLATES["EVIDENCE-INDEX"].fileName}`, indexFile());
  for (const d of EVIDENCE) if (d.role !== "not_uploaded") await doc(`${P[5]}/${FROM_CLIENT}/Evidence files`, d);
  put(`${P[5]}/Blank template/${TEMPLATES["EVIDENCE-INDEX"].fileName.replace(".xlsx", "_BLANK.xlsx")}`, blank("EVIDENCE-INDEX"));

  // phase 7
  put(`${P[7]}/${FROM_CLIENT}/${TEMPLATES["CLOSURE-PACK"].fileName}`, closureFile());
  for (const d of PROOFS) await doc(`${P[7]}/${FROM_CLIENT}/Proof files`, d);
  put(`${P[7]}/Blank template/${TEMPLATES["CLOSURE-PACK"].fileName.replace(".xlsx", "_BLANK.xlsx")}`, blank("CLOSURE-PACK"));

  // bad uploads
  const bad = "Try these bad uploads";
  put(`${bad}/wrong_template_evidence_index_in_phase1.xlsx`, indexFile());
  const scopeDef = TEMPLATES["SCOPE-INTAKE"];
  put(`${bad}/renamed_heading_scope_intake.xlsx`, buildXlsx([
    { name: "Registrations", note: "x", columns: scopeDef.sheets.find((s) => s.name === "Registrations")!.columns.map((c, i) => ({ header: i === 1 ? "Regulator (changed)" : c.header })), rows: [["Stock Broker", "SEBI", "INZ000DEMO01", "Active"]] },
    { name: "_template", hidden: true, columns: [{ header: "marker" }, { header: "key" }, { header: "version" }], rows: [["PRIMUS-TEMPLATE", "SCOPE-INTAKE", 1]] },
  ]));
  put(`${bad}/empty_required_cells_scope_intake.xlsx`, buildTemplateWorkbook("SCOPE-INTAKE", {
    ...SCOPE_FILLED,
    forms: { Organisation: { ...SCOPE_FILLED.forms!.Organisation!, "O-01": { answer: "" }, "O-07": { answer: "" } } },
    tables: { ...SCOPE_FILLED.tables!, Registrations: [{ registration: "", regulator: "SEBI", number: "INZ000DEMO01", status: "Active" }, { registration: "Depository Participant", regulator: "", number: "", status: "Maybe" }] },
  }));
  put(`${bad}/not_a_spreadsheet.txt`, "This is not an Excel file. Upload it in any phase and the platform will refuse it.\n");

  // write folders and the ZIP
  for (const [path, data] of files) {
    const full = join(ROOT, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  const tree: Record<string, Uint8Array> = {};
  for (const [path, data] of files) tree[`Orchid_Hill_Demo_Pack/${path}`] = data;
  mkdirSync("public/demo", { recursive: true });
  writeFileSync("public/demo/Orchid_Hill_Demo_Pack.zip", zipSync(tree, { level: 6 }));
  console.log(`✓ ${files.size} files written to ${ROOT}/ and public/demo/Orchid_Hill_Demo_Pack.zip`);
}
main().catch((e) => { console.error(e); process.exit(1); });
