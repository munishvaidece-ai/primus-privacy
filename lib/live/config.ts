// What each of the seven phases is, where its documents come from, and what the AI does with them.
// Plain data, shared by the Live Run screen and the demo pack, so the screen and the pack never disagree.
import type { TemplateKey } from "@/lib/templates/definitions";
import type { IntakeRole } from "@/lib/intake/store";

export interface PhaseConfig {
  n: number;
  name: string;
  /** One line a leader can read aloud. */
  headline: string;
  /** Where the documents for this phase come from, and who normally sends them. */
  from: { who: string; side: "client" | "primus" | "none"; how: string };
  template?: TemplateKey;
  /** Extra files that go with the template. */
  support?: { role: Exclude<IntakeRole, "template">; label: string; hint: string };
  /** The suggestion kinds this phase produces, so the screen can show what is waiting for a person. */
  kinds: string[];
  /** What the AI reads, does, and hands on. */
  reads: string;
  does: string[];
  handsOn: string;
}

export const PHASES: PhaseConfig[] = [
  {
    n: 1,
    name: "Engagement set up",
    headline: "The client says who they are. The AI works out which laws apply.",
    from: { who: "Client (Chief Compliance Officer)", side: "client", how: "Fills in the Scope Intake Form and sends the registration certificates and organisation chart." },
    template: "SCOPE-INTAKE",
    support: { role: "support", label: "Registration certificates, organisation chart", hint: "PDF or Word. The AI reads them for registrations it can confirm." },
    kinds: ["scope_sector", "scope_units"],
    reads: "The Scope Intake Form (organisation facts, registrations, business units, systems) and the supporting documents.",
    does: [
      "Matches each registration (for example Stock Broker, Depository Participant) to a sector's rules and applies the sectors it is sure of.",
      "Leaves a sector for a person where the evidence is only a mention (for example a group company).",
      "Creates the business units and flags risks: very large client base, minors, group data sharing, authorised persons.",
    ],
    handsOn: "Sectors and business units, which decide which controls apply in Phase 3.",
  },
  {
    n: 2,
    name: "Discovery",
    headline: "The client describes their data. The AI builds the data map and pre-fills the questionnaire.",
    from: { who: "Client (Privacy Officer, IT)", side: "client", how: "Fills in the Data Inventory and sends the vendor list. Or a connector reads the client's database directly, to check what they wrote against what is really there." },
    template: "DATA-INVENTORY",
    support: { role: "support", label: "Vendor master list, other inventories", hint: "Excel or PDF." },
    kinds: ["landscape_load", "discovery_prefill"],
    reads: "The Data Inventory (processing activities, systems, data stores, vendors, data elements, practices), the vendor list, and, if a database is connected, which tables hold personal data.",
    does: [
      "Loads systems, data stores, vendors, purposes, personal data elements and processing activities, skipping what already exists.",
      "Marks sensitive data elements and children's data.",
      "Compares the inventory with the database scan: copies and exports holding personal data, tables nobody listed, personal data typed into free-text fields, and claims like \"Aadhaar masked\" that the data does not bear out.",
      "Pre-fills the discovery questionnaire. Every answer shows the cell it came from. A person approves it.",
    ],
    handsOn: "The data map and the approved questionnaire, which Phase 3 uses to decide applicability.",
  },
  {
    n: 3,
    name: "Applicability",
    headline: "The AI decides, control by control, what applies, and says why.",
    from: { who: "Primus team", side: "none", how: "Nothing is uploaded. This phase uses what Phases 1 and 2 produced." },
    kinds: ["applicability"],
    reads: "The sectors, business units, data map and questionnaire answers from Phases 1 and 2, and the control library.",
    does: [
      "Decides for each of the 139 controls whether it applies: DPDP controls plus the controls of the sectors chosen.",
      "Gives the reason and the facts it relied on for every decision. Controls for other sectors are marked not applicable.",
    ],
    handsOn: "A locked scope: the controls that will be assessed.",
  },
  {
    n: 4,
    name: "Assessment",
    headline: "The consultant's tests go in. The AI rates each control from them.",
    from: { who: "Primus consultant", side: "primus", how: "Records each control test in the Control Test Log." },
    template: "CONTROL-TEST-LOG",
    kinds: ["rating"],
    reads: "The Control Test Log: what was tested, the sample, the result and the tester.",
    does: [
      "Loads each test against its control. Controls not in scope, or unknown, are reported rather than guessed.",
      "Rates every control that has a test: a failed test is not implemented, a passed test with no evidence yet is partly implemented.",
    ],
    handsOn: "A first rating per control, to be firmed up by the evidence in Phase 5.",
  },
  {
    n: 5,
    name: "Evidence validation",
    headline: "The client sends proof. The AI reads every file and says whether it supports the control.",
    from: { who: "Client (control owners)", side: "client", how: "Fills in the Evidence Index and uploads the files. Could instead be pulled from a document system by a connector." },
    template: "EVIDENCE-INDEX",
    support: { role: "evidence_file", label: "Evidence files (policies, registers, reports, certificates, screenshots)", hint: "PDF, Word, Excel, text or image." },
    kinds: ["evidence_review", "rating"],
    reads: "Every evidence file, in full, against the control it is listed for.",
    does: [
      "Reads each file and checks: is it about this control, is it approved and dated, does it have an owner and a scope.",
      "Accepts what supports the control. Sends a person the drafts, the unreadable scans and the irrelevant files.",
      "Reports files that are listed but missing, and files uploaded but not listed.",
      "Re-rates each control using the accepted evidence.",
    ],
    handsOn: "Final ratings per control.",
  },
  {
    n: 6,
    name: "Findings released",
    headline: "The AI drafts findings for weak controls. People release them to the client.",
    from: { who: "Primus team", side: "none", how: "Nothing is uploaded. The findings come from the ratings." },
    kinds: ["finding_create"],
    reads: "The ratings, the evidence reviews and the control descriptions.",
    does: [
      "Writes a finding for every control that is not fully in place, with a severity, the reason and a recommended action.",
      "Holds critical findings for a named person to release (a sign-off gate).",
    ],
    handsOn: "Released findings the client can see.",
  },
  {
    n: 7,
    name: "Remediation and final report",
    headline: "Findings become actions. The client proves each fix. The AI checks the proof.",
    from: { who: "Client (control owners)", side: "client", how: "Fills in the Closure Log and uploads a proof file for each action it says is done." },
    template: "CLOSURE-PACK",
    support: { role: "proof_file", label: "Proof files", hint: "The file named in each row of the Closure Log." },
    kinds: ["remediation_plan", "closure_check", "report_issue"],
    reads: "The released findings, then the Closure Log and each proof file.",
    does: [
      "Turns each released finding into a remediation action with a priority and due date (critical 30 days, high 60, medium 90, low 180).",
      "Reads each proof and decides: close the action, ask for more, or reject a document that has nothing to do with it.",
      "Drafts the final report once the assessment is finalised. A person issues it.",
    ],
    handsOn: "A closed-out engagement and an issued report.",
  },
];

export const phaseOf = (n: number): PhaseConfig => PHASES.find((p) => p.n === n)!;
