// The five fixed templates, one per upload phase. A template is a data
// definition: the same definition builds the blank Excel file people download,
// checks what they upload, and tells the AI what each column means.
import { SECTIONS } from "@/lib/workspace/discovery-sections";

export type TemplateKey = "SCOPE-INTAKE" | "DATA-INVENTORY" | "CONTROL-TEST-LOG" | "EVIDENCE-INDEX" | "CLOSURE-PACK";
export type CellType = "text" | "number" | "date";

export interface TColumn {
  key: string;
  header: string;
  required?: boolean;
  options?: string[];
  type?: CellType;
  width?: number;
}

export interface TFormRow {
  ref: string;
  key: string;
  label: string;
  required?: boolean;
  options?: string[];
  type?: CellType;
  /** Which discovery step/field this answer fills, for the questionnaire pre-fill. */
  discovery?: { section: string; field: string };
}

export interface TSheetDef {
  name: string;
  kind: "table" | "form";
  note: string;
  /** table: the columns. form: the answer columns after "Ref" and the label column. */
  columns: TColumn[];
  /** form sheets only: the fixed questions. */
  rows?: TFormRow[];
  /** At least this many data rows must be filled (tables). */
  minRows?: number;
  /** form sheets: header of the label column. */
  labelHeader?: string;
}

export interface TemplateDef {
  key: TemplateKey;
  version: number;
  phase: 1 | 2 | 4 | 5 | 7;
  title: string;
  fileName: string;
  /** Who normally completes it. */
  completedBy: "client" | "primus";
  purpose: string;
  /** What the AI does with it. */
  aiTask: string;
  sheets: TSheetDef[];
}

export const YES_NO = ["Yes", "No"];
const YES_NO_NOT_SURE = ["Yes", "No", "Not sure"];

// -------------------------------------------------------------- phase 1
const T1: TemplateDef = {
  key: "SCOPE-INTAKE",
  version: 1,
  phase: 1,
  title: "Scope Intake Form",
  fileName: "01_Scope_Intake_Form.xlsx",
  completedBy: "client",
  purpose: "Who the organisation is, what it is registered as, its business units and its main systems. Filled in by the client's compliance lead before the engagement starts.",
  aiTask: "Reads the form, decides which sector rules apply (stock broking, banking and so on), and sets up the business units. Anything uncertain goes to a person.",
  sheets: [
    {
      name: "Organisation",
      kind: "form",
      labelHeader: "Field",
      note: "Fill in the yellow Answer cells. Do not change the Ref column or the order of rows.",
      columns: [{ key: "answer", header: "Answer", width: 44 }, { key: "notes", header: "Notes (optional)", width: 36 }],
      rows: [
        { ref: "O-01", key: "legal_name", label: "Legal name of the organisation", required: true },
        { ref: "O-02", key: "cin", label: "Corporate identity number (CIN)" },
        { ref: "O-03", key: "entity_type", label: "Type of entity", required: true, options: ["Private limited", "Public limited", "LLP", "Partnership", "Sole proprietor", "Other"] },
        { ref: "O-04", key: "year", label: "Year of incorporation", type: "number" },
        { ref: "O-05", key: "office", label: "Registered office (city)", required: true },
        { ref: "O-06", key: "website", label: "Website" },
        { ref: "O-07", key: "employees", label: "Number of employees", required: true, type: "number" },
        { ref: "O-08", key: "clients", label: "Number of customers or clients whose personal data you hold", required: true, type: "number" },
        { ref: "O-09", key: "turnover", label: "Annual turnover (₹ crore)", type: "number" },
        { ref: "O-10", key: "branches", label: "Number of branches or offices", type: "number" },
        { ref: "O-11", key: "partners", label: "Number of authorised persons, agents or franchisees", type: "number" },
        { ref: "O-12", key: "group_entities", label: "Group companies that share data with you (names and what they do)" },
        { ref: "O-13", key: "business_description", label: "What the organisation does, in a few lines", required: true },
        { ref: "O-14", key: "compliance_contact", label: "Compliance lead (name and email)", required: true },
        { ref: "O-15", key: "privacy_contact", label: "Person who answers privacy questions (name and email)" },
      ],
    },
    {
      name: "Registrations",
      kind: "table",
      note: "One row per licence, registration or membership that applies to the organisation.",
      minRows: 1,
      columns: [
        { key: "registration", header: "Registration or licence", required: true, width: 40 },
        { key: "regulator", header: "Regulator or body", required: true, width: 28 },
        { key: "number", header: "Registration number", width: 24 },
        { key: "status", header: "Status", required: true, options: ["Active", "Applied", "Lapsed"], width: 14 },
      ],
    },
    {
      name: "Business units",
      kind: "table",
      note: "One row per business unit or function that handles personal data.",
      minRows: 1,
      columns: [
        { key: "name", header: "Business unit", required: true, width: 30 },
        { key: "does", header: "What it does", required: true, width: 46 },
        { key: "head", header: "Head (name and role)", required: true, width: 30 },
        { key: "personal", header: "Handles personal data?", required: true, options: YES_NO, width: 16 },
        { key: "staff", header: "People", type: "number", width: 10 },
      ],
    },
    {
      name: "Systems",
      kind: "table",
      note: "The main applications. The detail (where data sits, who hosts it) comes in the next phase.",
      minRows: 1,
      columns: [
        { key: "system", header: "System", required: true, width: 30 },
        { key: "purpose", header: "What it is used for", required: true, width: 44 },
        { key: "hosting", header: "Vendor or hosting", width: 30 },
        { key: "client_data", header: "Holds client personal data?", required: true, options: YES_NO, width: 18 },
      ],
    },
  ],
};

// -------------------------------------------------------------- phase 2
// The questions on the "Practices" sheet are the discovery questionnaire's own
// questions, so an answer can be copied across with its source.
const PRACTICE_FIELDS: Array<[string, string]> = [
  ["governance", "owner"], ["governance", "dpo"], ["governance", "policy"], ["governance", "training"], ["governance", "oversight"],
  ["rights", "rights_process"], ["rights", "grievance"], ["rights", "nominee"], ["rights", "volume"],
  ["incidents", "breach_plan"], ["incidents", "incident_log"], ["incidents", "cert_in"], ["incidents", "past_breaches"],
  ["lifecycle", "collection"], ["lifecycle", "sharing"], ["lifecycle", "retention_schedule"], ["lifecycle", "erasure_process"],
  ["consent", "relies_on_consent"], ["consent", "consent_how"], ["consent", "withdrawal"], ["consent", "notice"], ["consent", "legitimate_uses"],
  ["vendors", "contracts"],
  ["data_categories", "children_data"], ["data_categories", "large_volume"],
  ["processing_activities", "automated_decisions"],
  ["systems", "cloud"], ["systems", "integrations"],
  ["sector", "sdf"], ["sector", "other_regulators"],
];

export function practiceRows(): TFormRow[] {
  return PRACTICE_FIELDS.map(([sectionKey, fieldKey], i) => {
    const section = SECTIONS.find((s) => s.key === sectionKey)!;
    const f = section.fields.find((x) => x.key === fieldKey)!;
    const options = f.type === "yesno" ? YES_NO : f.type === "choice" ? f.options!.map((o) => o.label) : undefined;
    return { ref: `P-${String(i + 1).padStart(2, "0")}`, key: `${sectionKey}.${fieldKey}`, label: `${section.title}: ${f.label}`, required: false, options, discovery: { section: sectionKey, field: fieldKey } };
  });
}

const T2: TemplateDef = {
  key: "DATA-INVENTORY",
  version: 1,
  phase: 2,
  title: "Data Inventory",
  fileName: "02_Data_Inventory.xlsx",
  completedBy: "client",
  purpose: "What personal data the organisation processes, where it sits, who handles it, and how the organisation runs privacy day to day. Filled in by the client with IT and the business units.",
  aiTask: "Loads the activities, systems and vendors into the data landscape, and drafts answers to the discovery questionnaire from the Practices sheet and the inventory, each with its source cell. A person confirms the questionnaire answers.",
  sheets: [
    {
      name: "Processing activities",
      kind: "table",
      note: "One row per processing activity. List several items in a cell separated by semicolons.",
      minRows: 1,
      columns: [
        { key: "activity", header: "Processing activity", required: true, width: 32 },
        { key: "unit", header: "Business unit", required: true, width: 22 },
        { key: "purpose", header: "Purpose", required: true, width: 36 },
        { key: "principals", header: "Whose data (separate with ;)", required: true, width: 26 },
        { key: "elements", header: "Data elements (separate with ;)", required: true, width: 40 },
        { key: "systems", header: "System(s) (separate with ;)", width: 28 },
        { key: "vendors", header: "Vendor(s) that handle it (separate with ;)", width: 28 },
        { key: "basis", header: "Lawful basis", required: true, options: ["Consent", "Legal obligation", "Voluntary provision", "Employment", "Other"], width: 18 },
        { key: "retention", header: "How long it is kept", required: true, width: 28 },
        { key: "abroad", header: "Sent or stored outside India?", options: YES_NO, width: 16 },
      ],
    },
    {
      name: "Systems and data stores",
      kind: "table",
      note: "One row per system and where its data sits.",
      minRows: 1,
      columns: [
        { key: "system", header: "System", required: true, width: 30 },
        { key: "store", header: "Data store or location", width: 34 },
        { key: "hosting", header: "Hosting", required: true, options: ["On-premise", "Cloud (India)", "Cloud (outside India)"], width: 22 },
        { key: "owner", header: "Owner", width: 24 },
      ],
    },
    {
      name: "Vendors",
      kind: "table",
      note: "Every vendor that handles personal data for you.",
      minRows: 1,
      columns: [
        { key: "vendor", header: "Vendor", required: true, width: 30 },
        { key: "service", header: "Service", required: true, width: 34 },
        { key: "data", header: "Data shared", required: true, width: 36 },
        { key: "contract", header: "Contract with data protection terms?", required: true, options: ["Yes", "Partly", "No"], width: 20 },
        { key: "country", header: "Country", width: 16 },
      ],
    },
    {
      name: "Practices",
      kind: "form",
      labelHeader: "Question",
      note: "Answer each question. Name the document where the answer is written down, if there is one. Leave a question blank if it does not apply.",
      columns: [{ key: "answer", header: "Answer", width: 34 }, { key: "document", header: "Where it is written down", width: 34 }],
      rows: practiceRows(),
    },
  ],
};

// -------------------------------------------------------------- phase 4
const T4: TemplateDef = {
  key: "CONTROL-TEST-LOG",
  version: 1,
  phase: 4,
  title: "Control Test Log",
  fileName: "04_Control_Test_Log.xlsx",
  completedBy: "primus",
  purpose: "The tests the Primus team performed on each control: what was checked, on what sample, and the result. Filled in by the consultant from fieldwork.",
  aiTask: "Records each test against its control. The AI then rates each control from the tests and the evidence, and states its reasoning.",
  sheets: [
    {
      name: "Tests",
      kind: "table",
      note: "One row per test. The control code must be one of this engagement's controls.",
      minRows: 1,
      columns: [
        { key: "control", header: "Control code", required: true, width: 14 },
        { key: "procedure", header: "What was tested", required: true, width: 50 },
        { key: "sample", header: "Sample or population", width: 30 },
        { key: "result", header: "Result", required: true, options: ["Pass", "Fail", "Exception"], width: 12 },
        { key: "date", header: "Tested on", required: true, type: "date", width: 14 },
        { key: "tester", header: "Tested by", required: true, width: 20 },
        { key: "notes", header: "Notes", width: 40 },
      ],
    },
  ],
};

// -------------------------------------------------------------- phase 5
const T5: TemplateDef = {
  key: "EVIDENCE-INDEX",
  version: 1,
  phase: 5,
  title: "Evidence Index",
  fileName: "05_Evidence_Index.xlsx",
  completedBy: "client",
  purpose: "A list of the evidence files being uploaded and which control each one supports. Upload it together with the files.",
  aiTask: "Links each file to its control, then reads each file and accepts or rejects it with a reason. Unreadable or irrelevant files go to a person.",
  sheets: [
    {
      name: "Evidence",
      kind: "table",
      note: "One row per file. The file name must match the uploaded file exactly.",
      minRows: 1,
      columns: [
        { key: "file", header: "File name", required: true, width: 40 },
        { key: "control", header: "Control code", required: true, width: 14 },
        { key: "doctype", header: "Type of document", required: true, options: ["Policy", "Procedure", "Report", "Screenshot", "Certificate", "Agreement", "Log", "Other"], width: 16 },
        { key: "title", header: "Document title", required: true, width: 40 },
        { key: "date", header: "Document date", type: "date", width: 14 },
        { key: "owner", header: "Owner (name and role)", required: true, width: 26 },
        { key: "description", header: "What it shows", width: 46 },
      ],
    },
  ],
};

// -------------------------------------------------------------- phase 7
const T7: TemplateDef = {
  key: "CLOSURE-PACK",
  version: 1,
  phase: 7,
  title: "Remediation Closure Log",
  fileName: "07_Remediation_Closure_Log.xlsx",
  completedBy: "client",
  purpose: "For each remediation action the client says is finished: what was done, when, by whom, and the proof file. Upload it together with the proof files.",
  aiTask: "Reads each proof file and checks it against the action it claims to close. It proposes to close the action, or says what is missing.",
  sheets: [
    {
      name: "Closures",
      kind: "table",
      note: "One row per action. The action must match the action title on the platform. The proof file name must match the uploaded file exactly.",
      minRows: 1,
      columns: [
        { key: "action", header: "Remediation action (title)", required: true, width: 46 },
        { key: "done", header: "What was done", required: true, width: 50 },
        { key: "date", header: "Completed on", required: true, type: "date", width: 14 },
        { key: "by", header: "Done by (name and role)", required: true, width: 26 },
        { key: "proof", header: "Proof file name", required: true, width: 40 },
      ],
    },
  ],
};

export const TEMPLATES: Record<TemplateKey, TemplateDef> = {
  "SCOPE-INTAKE": T1,
  "DATA-INVENTORY": T2,
  "CONTROL-TEST-LOG": T4,
  "EVIDENCE-INDEX": T5,
  "CLOSURE-PACK": T7,
};

export const TEMPLATE_LIST: TemplateDef[] = [T1, T2, T4, T5, T7];
export const templateForPhase = (phase: number): TemplateDef | undefined => TEMPLATE_LIST.find((t) => t.phase === phase);
export const isTemplateKey = (k: string): k is TemplateKey => k in TEMPLATES;
export { YES_NO_NOT_SURE };
