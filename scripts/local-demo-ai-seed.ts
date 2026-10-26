// Adds FICTIONAL uploaded documents to the Vitalis demo firm and then lets the
// platform's own AI process them under Full autopilot, so the "What the AI did"
// and "Data it reads" screens have real entries to show. Nothing here is faked:
// the suggestions are produced by the same job queue and rules engine the app uses.
//
// Safe to run again (does nothing if the AI has already worked on Vitalis).
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { demoAuthProblem } from "../lib/auth/demo-auth-rules";

const ago = (days: number, hours = 0) => new Date(Date.now() - days * 86400000 - hours * 3600000);

interface Doc {
  file: string;
  title: string;
  docType: "policy" | "report" | "contract";
  evType: "policy_document" | "other" | "signed_agreement";
  by: "vikram" | "ananya" | "arjun" | "priya";
  visibility: "client_visible" | "consultant_internal";
  daysAgo: number;
  control: string; // the control code whose answer this document is attached to
  request?: string; // evidence request reference this fulfils
  text: string;
}

const DOCS: Doc[] = [
  {
    file: "Vitalis_Breach_Response_Plan_v3.1.pdf", title: "Personal data breach response plan (v3.1)", docType: "policy", evType: "policy_document",
    by: "vikram", visibility: "client_visible", daysAgo: 9, control: "BRE-01",
    text: `Vitalis Care Network: Personal Data Breach Detection and Response Plan
Version 3.1. Effective from 1 April 2026. Approved by the Group Chief Executive and signed by the Privacy Officer.
Scope: this plan applies to all six hospitals, all diagnostic centres, the patient app and every processor that handles patient personal data.
Owner: the Privacy Officer is accountable for this plan and reviews it every six months. Next review date: 1 October 2026.
Detection: security monitoring alerts, staff reports and processor notifications are logged in the incident register. Any suspected personal data breach must be reported to the Privacy Officer within two hours.
Response roles: the Incident Commander (Chief Information Security Officer), the Privacy Officer, the Legal Counsel, and the Hospital Medical Superintendent for the affected site form the breach response team. The escalation path runs from the duty manager to the Incident Commander and then to the Group Chief Executive.
Containment and investigation: the team isolates affected systems, preserves logs, investigates the cause and records the number of patients affected and the categories of personal data involved.
Testing: the plan is tested through a tabletop exercise twice a year. The last exercise was held on 14 February 2026 and the outcome was recorded in the incident register.`,
  },
  {
    file: "Vitalis_Patient_Privacy_Notice_English_Kannada.pdf", title: "Patient privacy notice (English and Kannada)", docType: "policy", evType: "policy_document",
    by: "ananya", visibility: "client_visible", daysAgo: 7, control: "NOT-01", request: "ER-001",
    text: `Vitalis Care Network: Privacy Notice for Patients
Version 2.0. Effective date 1 May 2026. Approved by the Privacy Officer.
This notice applies to patients of all Vitalis hospitals and diagnostic centres and is given at the registration desk and in the patient app when we ask for your personal data.
What personal data we collect: your name, contact details, date of birth, health records, test results and insurance details.
Why we use it: to treat you, to bill you and your insurer, to meet legal duties and to improve the quality of care. We do not use your personal data for any other purpose without asking you first.
Your rights: you can ask to see, correct or erase your personal data, withdraw your consent and name another person to exercise your rights. Write to the Privacy Officer at the contact point displayed in this notice.
How to complain: if you are not satisfied with our reply, you may complain to the Data Protection Board of India. The notice is available in English and Kannada.`,
  },
  {
    file: "Vitalis_Consent_Form_Patient_Registration.pdf", title: "Patient registration consent form", docType: "policy", evType: "policy_document",
    by: "vikram", visibility: "client_visible", daysAgo: 6, control: "CON-01",
    text: `Vitalis Care Network: Patient registration consent form
Version 1.4. Dated 12 January 2026.
By signing below you agree that Vitalis may collect and use your personal data. You give consent for treatment, billing and hospital administration.
Please tick the box to confirm. Signed by patient or guardian.
Note: reminders, health campaigns and research use are included in the general consent given above.`,
  },
  {
    file: "Training_attendance_extract_Q1.xlsx", title: "Staff privacy training attendance extract, Q1", docType: "report", evType: "other",
    by: "arjun", visibility: "consultant_internal", daysAgo: 5, control: "GOV-03",
    text: `Primus working copy, prepared by the engagement team from the HR learning system export supplied by Vitalis.
Staff privacy awareness training: induction and refresher attendance, first quarter. Version 1. Dated 3 April 2026.
Induction training: 412 of 440 new staff completed privacy induction training, attendance recorded by the HR learning system.
Refresher training: 3,180 of 3,900 staff who handle personal data completed the periodic refresher training; the remaining staff are scheduled for the next session.
Owner: the HR Head and the Privacy Officer are responsible for training records and review them every quarter.
Scope: applies to all employees, doctors, nurses and front-desk staff who handle patient personal data.`,
  },
  {
    file: "Hospital_Newsletter_March.pdf", title: "Hospital newsletter, March edition", docType: "report", evType: "other",
    by: "vikram", visibility: "client_visible", daysAgo: 4, control: "INV-01",
    text: `Vitalis Care Network newsletter, March edition. Welcome to a new season at our hospitals. This month we celebrate the opening of the new paediatric wing at our Whitefield hospital, a free health camp for senior citizens, and the cafeteria's new menu with millet-based dishes. Our nursing team won the regional award for patient care. Doctors' day celebrations will be held on 1 July with a cultural programme and a blood donation drive. Please see the notice boards for parking arrangements during the construction work. Staff are invited to the annual sports day. Thank you for making Vitalis a place where people feel cared for.`,
  },
  {
    file: "scan_0042.pdf", title: "Scanned data sharing agreement (TPA)", docType: "contract", evType: "signed_agreement",
    by: "ananya", visibility: "client_visible", daysAgo: 3, control: "BRE-02", request: "ER-002",
    text: `[scanned image: text could not be read]`,
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const problem = demoAuthProblem({ ...process.env, NODE_ENV: "development" });
  if (problem) throw new Error(`Refusing to add demo data: ${problem}`);
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    const org = (await c.query<{ id: string; tenant_id: string }>("SELECT id, tenant_id FROM organisations WHERE name = 'Vitalis Care Network Pvt Ltd'")).rows[0];
    if (!org) {
      console.log("• AI demo data skipped (the Vitalis demo firm is not present).");
      return;
    }
    const eng = (await c.query<{ id: string }>("SELECT id FROM engagements WHERE organisation_id = $1 LIMIT 1", [org.id])).rows[0]!;
    if ((await c.query("SELECT 1 FROM ai_suggestions WHERE engagement_id = $1 LIMIT 1", [eng.id])).rowCount) {
      console.log("✓ AI demo data already present.");
      return;
    }
    const T = org.tenant_id;
    const who = async (email: string) => (await c.query<{ id: string }>("SELECT id FROM auth.users WHERE email = $1", [email])).rows[0]!.id;
    const people = {
      vikram: await who("vikram.sethi@vitaliscare.example"),
      ananya: await who("ananya.rao@vitaliscare.example"),
      arjun: await who("arjun.mehta@primus.local"),
      priya: await who("priya.nair@primus.local"),
      admin: await who("admin@primus.local"),
    };

    await c.query("BEGIN");
    for (const d of DOCS) {
      const at = ago(d.daysAgo);
      const doc = (await c.query<{ id: string }>(
        "INSERT INTO documents (tenant_id, organisation_id, engagement_id, title, document_type, owner_user_id, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$6,$7) RETURNING id",
        [T, org.id, eng.id, d.title, d.docType, people[d.by], at],
      )).rows[0]!.id;
      const ver = (await c.query<{ id: string }>(
        "INSERT INTO document_versions (document_id, tenant_id, organisation_id, engagement_id, storage_path, original_filename, mime_type, file_size_bytes, checksum_sha256, scan_status, uploaded_by, uploaded_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'clean',$10,$11,$11) RETURNING id",
        [doc, T, org.id, eng.id, `demo/${randomUUID()}/${d.file}`, d.file, d.file.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf", 40000 + d.text.length * 7, createHash("sha256").update(d.text).digest("hex"), people[d.by], at],
      )).rows[0]!.id;
      await c.query(
        "INSERT INTO ai_document_extracts (tenant_id, organisation_id, engagement_id, document_version_id, text_content, char_count, truncated, method, extracted_at) VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8)",
        [T, org.id, eng.id, ver, d.text, d.text.length, d.text.startsWith("[scanned") ? "image_no_text" : "pdf_text", at],
      );
      const ev = (await c.query<{ id: string }>(
        "INSERT INTO evidence (tenant_id, organisation_id, engagement_id, document_version_id, title, evidence_type, visibility, collected_at, review_status, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending_review',$9,$8) RETURNING id",
        [T, org.id, eng.id, ver, d.title, d.evType, d.visibility, at, people[d.by]],
      )).rows[0]!.id;
      const resp = (await c.query<{ id: string }>(
        "SELECT ar.id FROM assessment_responses ar JOIN assessment_controls ac ON ac.id = ar.assessment_control_id JOIN controls ct ON ct.id = ac.control_id WHERE ar.engagement_id = $1 AND ct.code = $2",
        [eng.id, d.control],
      )).rows[0];
      if (!resp) throw new Error(`No answer exists for ${d.control}; cannot attach ${d.file}.`);
      await c.query(
        "INSERT INTO evidence_links (evidence_id, tenant_id, organisation_id, engagement_id, subject_type, assessment_response_id, created_by) VALUES ($1,$2,$3,$4,'assessment_response',$5,$6)",
        [ev, T, org.id, eng.id, resp.id, people[d.by]],
      );
      if (d.request) {
        await c.query("UPDATE evidence_requests SET status = 'fulfilled', fulfilled_evidence_id = $1, fulfilled_at = $2, fulfilled_by = $3 WHERE engagement_id = $4 AND reference = $5", [ev, at, people[d.by], eng.id, d.request]);
      }
    }
    // A control test the Primus team ran, which the AI weighs when rating
    const bre02 = (await c.query<{ id: string }>("SELECT id FROM controls WHERE tenant_id = $1 AND code = 'BRE-02' ORDER BY created_at DESC LIMIT 1", [T])).rows[0]!.id;
    const asm = (await c.query<{ id: string }>("SELECT id FROM assessments WHERE engagement_id = $1", [eng.id])).rows[0]!.id;
    await c.query(
      "INSERT INTO control_tests (control_id, tenant_id, assessment_id, organisation_id, engagement_id, methodology, sample_description, result, tester_id, tested_at, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'fail',$8,$9,$8,$8)",
      [bre02, T, asm, org.id, eng.id, "Walkthrough of a simulated breach with the Privacy Officer", "One tabletop scenario: lost laptop with 1,200 patient records", people.arjun, ago(4)],
    );
    await c.query("COMMIT");
    console.log(`✓ Added ${DOCS.length} fictional uploaded documents and 1 control test to Vitalis.`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
    await pool.end();
  }

  // ---- now let the platform's own AI work on it, exactly as it would in use ----
  const { withRequestDb } = await import("../lib/db/request-client");
  const { saveAiSettings } = await import("../lib/ai/settings");
  const { runNow } = await import("../lib/ai/control");
  const { runOnce } = await import("../lib/ai/worker");
  const p2 = new Pool({ connectionString: url });
  const ids = (await p2.query<{ org: string; eng: string; admin: string }>(
    "SELECT o.id AS org, e.id AS eng, (SELECT id FROM auth.users WHERE email = 'admin@primus.local') AS admin FROM organisations o JOIN engagements e ON e.organisation_id = o.id WHERE o.name = 'Vitalis Care Network Pvt Ltd'",
  )).rows[0]!;
  await p2.end();
  await withRequestDb(ids.admin, async (db) => {
    await saveAiSettings(db, ids.admin, {
      engagementId: ids.eng, organisationId: ids.org, enabled: true, level: 3, thresholdSupervised: 0.9, thresholdFull: 0.75,
      gates: { rejectCriticalEvidence: true, releaseCriticalFindings: true, issueFinalReport: true, sendBreachNotices: true }, allowExternalAi: false,
    });
    await runNow(db, ids.admin, { engagementId: ids.eng, organisationId: ids.org });
  });
  let n = 0;
  while (n < 400 && (await runOnce("demo-seed", () => undefined))) n++;
  console.log(`✓ The AI ran ${n} jobs on Vitalis under Full autopilot.`);
  const { closeQueuePool } = await import("../lib/ai/queue");
  await closeQueuePool();
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message ?? e}`);
  process.exit(1);
});
