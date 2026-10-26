// Adds FICTIONAL demo data so every screen has something to show when you try
// the product locally: a Primus team and THREE client organisations, each at a
// different stage of the same DPDP readiness programme:
//
//   1. Meridian Finserve Ltd   (financial services)  - results delivered, remediation under way
//   2. Vitalis Care Network    (healthcare)          - client is mid-assessment, evidence outstanding
//   3. Bazaarly Commerce       (e-commerce)          - just started, discovery in progress
//
// Every name, number and finding below is invented for demonstration. Safe to run
// again (it does nothing if the demo firms already exist). Not for production:
// it is only ever run by `npm run local:setup`.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { demoAuthProblem } from "../lib/auth/demo-auth-rules";

const PRIMUS_TEAM = [
  { name: "Priya Nair", email: "priya.nair@primus.local", tenantRole: "Practice Partner" },
  { name: "Arjun Mehta", email: "arjun.mehta@primus.local" },
  { name: "Meera Iyer", email: "meera.iyer@primus.local" },
] as const;

type Rating = "implemented" | "partially_implemented" | "not_implemented" | "not_applicable" | "not_assessed";
const ago = (days: number, hours = 0) => new Date(Date.now() - days * 86400000 - hours * 3600000);
const inDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

interface Firm {
  key: "meridian" | "vitalis" | "bazaarly";
  name: string;
  industry: string;
  hq: string;
  domain: string;
  engagement: string;
  team: { name: string; email: string; org?: string; engagement?: string }[];
}

const FIRMS: Firm[] = [
  {
    key: "meridian", name: "Meridian Finserve Ltd", industry: "Financial services (NBFC)", hq: "Mumbai", domain: "meridianfinserve.example",
    engagement: "DPDP readiness FY2026-27",
    team: [
      { name: "Asha Verma", email: "asha.verma@meridianfinserve.example", org: "Client Administrator" },
      { name: "Rohan Gupta", email: "rohan.gupta@meridianfinserve.example", org: "Privacy Officer" },
      { name: "Kabir Shah", email: "kabir.shah@meridianfinserve.example", org: "CXO / Executive Viewer" },
      { name: "Neha Joshi", email: "neha.joshi@meridianfinserve.example", engagement: "Business Owner" },
    ],
  },
  {
    key: "vitalis", name: "Vitalis Care Network Pvt Ltd", industry: "Healthcare (hospital group)", hq: "Bengaluru", domain: "vitaliscare.example",
    engagement: "DPDP readiness FY2026-27",
    team: [
      { name: "Dr Ananya Rao", email: "ananya.rao@vitaliscare.example", org: "Client Administrator" },
      { name: "Vikram Sethi", email: "vikram.sethi@vitaliscare.example", org: "Privacy Officer" },
      { name: "Pooja Menon", email: "pooja.menon@vitaliscare.example", org: "CXO / Executive Viewer" },
    ],
  },
  {
    key: "bazaarly", name: "Bazaarly Commerce Pvt Ltd", industry: "Retail and e-commerce", hq: "Gurugram", domain: "bazaarly.example",
    engagement: "DPDP readiness FY2026-27",
    team: [
      { name: "Sameer Khanna", email: "sameer.khanna@bazaarly.example", org: "Client Administrator" },
      { name: "Ishita Bose", email: "ishita.bose@bazaarly.example", org: "Privacy Officer" },
    ],
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
    const tenant = (await c.query<{ id: string }>("SELECT id FROM tenants WHERE name = 'Primus Partners'")).rows[0];
    if (!tenant) throw new Error("The practice does not exist yet. Run: npm run local:setup");
    const tenantId = tenant.id;
    if ((await c.query("SELECT 1 FROM organisations WHERE tenant_id = $1 AND name = 'Meridian Finserve Ltd'", [tenantId])).rowCount) {
      console.log("✓ Demo data already present.");
      return;
    }
    if ((await c.query("SELECT 1 FROM organisations WHERE tenant_id = $1 AND name = 'Demo Client Pvt Ltd'", [tenantId])).rowCount) {
      throw new Error("An older demo set is in this database. Start fresh with:  docker compose -f docker-compose.local.yml down -v   then   npm run local:db   and   npm run local:setup");
    }
    await c.query("BEGIN");
    const role = async (name: string) => {
      const r = await c.query<{ id: string }>("SELECT id FROM roles WHERE name = $1", [name]);
      if (!r.rows[0]) throw new Error(`Role "${name}" is missing (run bootstrap first).`);
      return r.rows[0].id;
    };
    const user = async (name: string, email: string, clientOrgId?: string) => {
      const id = randomUUID();
      const meta: Record<string, string> = { tenant_id: tenantId };
      if (clientOrgId) meta.client_org_id = clientOrgId;
      await c.query("INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES ($1,$2,$3::jsonb,$4::jsonb)", [id, email, JSON.stringify(meta), JSON.stringify({ display_name: name })]);
      return id;
    };

    // the library: publish the starter so assessments can be built from it
    const lib = (await c.query<{ id: string }>("SELECT id FROM control_library_versions WHERE tenant_id = $1 AND version_label LIKE 'DPDP starter%' LIMIT 1", [tenantId])).rows[0];
    if (!lib) throw new Error("The starter control library is missing (bootstrap --starter-library).");
    await c.query("UPDATE control_library_versions SET status = 'published', version_label = 'DPDP starter (demo copy)' WHERE id = $1 AND status <> 'published'", [lib.id]);
    const controls = (await c.query<{ id: string; code: string; title: string }>("SELECT id, code, title FROM controls WHERE control_library_version_id = $1 ORDER BY code", [lib.id])).rows;
    const riskModel = (await c.query<{ id: string }>("SELECT id FROM risk_scoring_models WHERE tenant_id = $1 LIMIT 1", [tenantId])).rows[0]!.id;
    const band = (n: number) => (n >= 16 ? "critical" : n >= 10 ? "high" : n >= 5 ? "medium" : "low");

    // ---- the Primus team ----
    const admin = (await c.query<{ id: string }>("SELECT id FROM auth.users WHERE email = 'admin@primus.local'")).rows[0]!;
    const team: Record<string, string> = { admin: admin.id };
    for (const p of PRIMUS_TEAM) {
      const id = await user(p.name, p.email);
      team[p.name] = id;
      if ("tenantRole" in p) await c.query("INSERT INTO tenant_memberships (user_id, tenant_id, role_id) VALUES ($1,$2,$3)", [id, tenantId, await role(p.tenantRole)]);
    }
    const priya = team["Priya Nair"]!, arjun = team["Arjun Mehta"]!, meera = team["Meera Iyer"]!;

    const ids: Record<string, { org: string; eng: string; asm: string; people: Record<string, string> }> = {};

    for (const f of FIRMS) {
      const org = (await c.query<{ id: string }>("INSERT INTO organisations (tenant_id, name, industry, hq_location, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id", [tenantId, f.name, f.industry, f.hq, new Date(Date.now() - (FIRMS.length - FIRMS.indexOf(f)) * 60000)])).rows[0]!.id;
      const eng = (await c.query<{ id: string }>("INSERT INTO engagements (tenant_id, organisation_id, name, engagement_type, status, control_library_version_id, created_at) VALUES ($1,$2,$3,'readiness','active',$4,$5) RETURNING id", [tenantId, org, f.engagement, lib.id, ago(f.key === "meridian" ? 75 : f.key === "vitalis" ? 40 : 9)])).rows[0]!.id;
      const asm = (await c.query<{ id: string }>("INSERT INTO assessments (engagement_id, organisation_id, tenant_id, control_library_version_id, assessment_type, period_label) VALUES ($1,$2,$3,$4,'control_readiness','FY2026-27') RETURNING id", [eng, org, tenantId, lib.id])).rows[0]!.id;
      for (const ctl of controls) {
        await c.query("INSERT INTO assessment_controls (assessment_id, control_id, tenant_id, organisation_id, engagement_id, control_library_version_id) VALUES ($1,$2,$3,$4,$5,$6)", [asm, ctl.id, tenantId, org, eng, lib.id]);
      }
      // Primus staffing: the administrator works every engagement; Priya leads two; Arjun is on all; Meera audits the first
      const em = await role("Engagement Manager");
      await c.query("INSERT INTO engagement_memberships (user_id, engagement_id, role_id) VALUES ($1,$2,$3)", [admin.id, eng, em]);
      if (f.key !== "bazaarly") await c.query("INSERT INTO engagement_memberships (user_id, engagement_id, role_id) VALUES ($1,$2,$3)", [priya, eng, em]);
      await c.query("INSERT INTO engagement_memberships (user_id, engagement_id, role_id) VALUES ($1,$2,$3)", [arjun, eng, await role("Consultant")]);
      if (f.key === "meridian") await c.query("INSERT INTO engagement_memberships (user_id, engagement_id, role_id) VALUES ($1,$2,$3)", [meera, eng, await role("Auditor")]);
      // client people
      const people: Record<string, string> = {};
      for (const p of f.team) {
        const id = await user(p.name, p.email, org);
        people[p.name] = id;
        if (p.org) await c.query("INSERT INTO organisation_memberships (user_id, organisation_id, role_id) VALUES ($1,$2,$3)", [id, org, await role(p.org)]);
        else await c.query("INSERT INTO engagement_memberships (user_id, engagement_id, role_id) VALUES ($1,$2,$3)", [id, eng, await role(p.engagement!)]);
      }
      ids[f.key] = { org, eng, asm, people };
    }

    // Small helpers bound to one firm
    const T = tenantId;
    const activity = async (k: keyof typeof ids, actor: string, kind: string, summary: string, at: Date, clientVisible = true) => {
      const x = ids[k]!;
      await c.query("INSERT INTO engagement_activity (tenant_id, organisation_id, engagement_id, actor_user_id, kind, summary, client_visible, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [T, x.org, x.eng, actor, kind, summary, clientVisible, at]);
    };
    const notify = async (k: keyof typeof ids, userId: string, kind: string, title: string, body: string, link: string, at: Date, read: boolean) => {
      const x = ids[k]!;
      await c.query("INSERT INTO notifications (tenant_id, organisation_id, engagement_id, user_id, kind, title, body, link, created_at, read_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [T, x.org, x.eng, userId, kind, title, body, link, at, read ? at : null]);
    };
    const task = async (k: keyof typeof ids, o: { kind?: string; title: string; description?: string; side: "primus" | "client"; due?: string; done?: boolean; by: string; assignee?: string }) => {
      const x = ids[k]!;
      await c.query("INSERT INTO engagement_tasks (tenant_id, organisation_id, engagement_id, kind, title, description, assignee_side, assignee_user_id, due_date, status, completed_at, completed_by, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)",
        [T, x.org, x.eng, o.kind ?? "task", o.title, o.description ?? null, o.side, o.assignee ?? null, o.due ?? null, o.done ? "done" : "open", o.done ? ago(3) : null, o.done ? o.by : null, o.by]);
    };
    const discovery = async (k: keyof typeof ids, status: "in_progress" | "submitted" | "approved", by: string, sections: [string, Record<string, unknown>][]) => {
      const x = ids[k]!;
      await c.query("INSERT INTO engagement_discovery (tenant_id, organisation_id, engagement_id, status, submitted_at, submitted_by, approved_at, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [T, x.org, x.eng, status, status === "in_progress" ? null : ago(50), status === "in_progress" ? null : by, status === "approved" ? ago(46) : null, status === "approved" ? admin.id : null]);
      for (const [key, answers] of sections) {
        await c.query("INSERT INTO discovery_sections (tenant_id, organisation_id, engagement_id, section_key, answers, completed_at, updated_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)", [T, x.org, x.eng, key, JSON.stringify(answers), ago(55), by]);
      }
    };
    const answerControls = async (k: keyof typeof ids, count: number, by: string, ratings: Rating[], opts: { validated?: boolean; submitted?: boolean }) => {
      const x = ids[k]!;
      const acs = (await c.query<{ id: string; control_id: string }>("SELECT ac.id, ac.control_id FROM assessment_controls ac JOIN controls ct ON ct.id = ac.control_id WHERE ac.assessment_id = $1 ORDER BY ct.code", [x.asm])).rows;
      for (let i = 0; i < Math.min(count, acs.length); i++) {
        const at = ago(30 - Math.floor(i / 2));
        await c.query("INSERT INTO assessment_responses (assessment_control_id, tenant_id, organisation_id, engagement_id, effectiveness_rating, respondent_id, submitted_at, validated_at, validated_by, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$6,$6)",
          [acs[i]!.id, T, x.org, x.eng, ratings[i % ratings.length], by, opts.submitted ? ago(20) : null, opts.validated ? ago(14) : null, opts.validated ? admin.id : null]);
        void at;
      }
      if (opts.submitted) await c.query("UPDATE assessments SET submitted_at = $2, submitted_by = $3 WHERE id = $1", [x.asm, ago(20), by]);
    };
    const finding = async (k: keyof typeof ids, title: string, description: string, severity: string, released: boolean, status = "open") => {
      const x = ids[k]!;
      return (await c.query<{ id: string }>("INSERT INTO findings (engagement_id, organisation_id, tenant_id, title, description, severity, status, released_at, released_by, created_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9) RETURNING id",
        [x.eng, x.org, T, title, description, severity, status, released ? ago(12) : null, released ? admin.id : arjun, ago(16)])).rows[0]!.id;
    };
    const risk = async (k: keyof typeof ids, title: string, description: string, l: number, i: number, status: string, owner: string, residual?: [number, number]) => {
      const x = ids[k]!;
      await c.query("INSERT INTO risks (engagement_id, organisation_id, tenant_id, title, description, likelihood, impact, inherent_rating, residual_likelihood, residual_impact, residual_rating, risk_scoring_model_id, status, owner_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)",
        [x.eng, x.org, T, title, description, l, i, band(l * i), residual?.[0] ?? null, residual?.[1] ?? null, residual ? band(residual[0] * residual[1]) : null, riskModel, status, owner, arjun]);
    };
    const action = async (k: keyof typeof ids, findingId: string | null, title: string, description: string, priority: string, status: string, due: string, owner: string) => {
      const x = ids[k]!;
      const id = (await c.query<{ id: string }>("INSERT INTO remediation_actions (engagement_id, organisation_id, tenant_id, title, description, priority, status, due_date, owner_id, completed_at, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id",
        [x.eng, x.org, T, title, description, priority, status, due, owner, status === "closed" || status === "validated" ? ago(5) : null, arjun])).rows[0]!.id;
      if (findingId) await c.query("INSERT INTO remediation_findings (remediation_action_id, finding_id, tenant_id, organisation_id, engagement_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)", [id, findingId, T, x.org, x.eng, arjun]);
    };
    const clarification = async (k: keyof typeof ids, ref: string, subject: string, status: "open" | "answered" | "closed", raisedBy: string, side: "primus" | "client", msgs: [string, "primus" | "client", string, number][]) => {
      const x = ids[k]!;
      const id = (await c.query<{ id: string }>("INSERT INTO clarifications (tenant_id, organisation_id, engagement_id, reference, subject, status, raised_by, raised_by_side, raised_at, closed_at, closed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",
        [T, x.org, x.eng, ref, subject, status === "closed" ? "answered" : status, raisedBy, side, ago(msgs[0]![3]), null, null])).rows[0]!.id;
      for (const [author, s, body, d] of msgs) await c.query("INSERT INTO clarification_messages (tenant_id, organisation_id, engagement_id, clarification_id, author_id, author_side, body, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [T, x.org, x.eng, id, author, s, body, ago(d)]);
      if (status === "closed") await c.query("UPDATE clarifications SET status = 'closed', closed_at = $2, closed_by = $3 WHERE id = $1", [id, ago(4), admin.id]);
    };
    const evidenceRequest = async (k: keyof typeof ids, ref: string, title: string, description: string, due: string, by: string) => {
      const x = ids[k]!;
      await c.query("INSERT INTO evidence_requests (tenant_id, organisation_id, engagement_id, reference, title, description, status, requested_by, requested_at, due_at) VALUES ($1,$2,$3,$4,$5,$6,'requested',$7,$8,$9)", [T, x.org, x.eng, ref, title, description, by, ago(6), due]);
    };
    const rights = async (k: keyof typeof ids, n: number, title: string, type: string, channel: string, status: string, receivedDaysAgo: number, by: string) => {
      const x = ids[k]!;
      const received = ago(receivedDaysAgo);
      await c.query("INSERT INTO ops_cases (tenant_id, organisation_id, engagement_id, case_type, reference, title, status, received_at, due_at, details, closed_at, created_by, updated_by) VALUES ($1,$2,$3,'rights_request',$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$11)",
        [T, x.org, x.eng, `RR-${received.getUTCFullYear()}-${String(n).padStart(4, "0")}`, title, status, received, new Date(received.getTime() + 90 * 86400000), JSON.stringify({ requestType: type, channel, identityVerified: status !== "open", retentionObligation: false, notes: "" }), status === "closed" ? ago(receivedDaysAgo - 12) : null, by]);
    };

    // =====================================================================
    // 1. MERIDIAN FINSERVE: results delivered, remediation under way
    // =====================================================================
    {
      const m = ids.meridian!;
      const asha = m.people["Asha Verma"]!, rohan = m.people["Rohan Gupta"]!, kabir = m.people["Kabir Shah"]!, neha = m.people["Neha Joshi"]!;
      const meridianDiscovery: [string, Record<string, unknown>][] = [
        ["organisation_profile", { summary: "Meridian Finserve is a mid-sized NBFC offering personal loans, MSME working-capital loans and a co-lending programme with two partner banks. About 1.4 million active customers across 11 states, served through a mobile app and 180 branches.", sector: "financial_services", employees: "1000_5000", website: "meridianfinserve.example" }],
        ["business_units", { units: "Retail lending\nMSME lending\nCollections and recovery\nCo-lending partnerships\nTechnology and data\nHuman resources", owners: "Each unit head is the privacy owner for their unit; the Privacy Officer coordinates." }],
        ["processing_activities", { activities: "Loan origination and KYC\nCredit scoring and bureau checks\nCollections calling and field visits\nCustomer support and grievance handling\nMarketing and cross-sell campaigns\nEmployee onboarding and payroll", purposes: "Underwriting, regulatory KYC, servicing, collections, fraud prevention, marketing with consent.", automated_decisions: true }],
        ["data_categories", { data_types: ["identity", "contact", "financial", "location", "online", "employee"], principals: ["customers", "employees", "vendor_contacts", "visitors"], children_data: false, large_volume: true }],
        ["systems", { systems: "Loan management system (LMS)\nCustomer mobile app\nCRM\nCollections dialler\nData warehouse on cloud\nHRMS", cloud: true, integrations: "Credit bureaus, e-KYC provider, two co-lending banks, SMS and WhatsApp gateway." }],
      ];
      await discovery("meridian", "approved", asha, meridianDiscovery);
      // 25 controls: roughly 11 implemented, 8 partial, 5 not implemented, 1 not applicable
      const mix: Rating[] = ["implemented", "partially_implemented", "implemented", "not_implemented", "implemented", "partially_implemented", "implemented", "implemented", "not_implemented", "partially_implemented", "implemented", "partially_implemented", "not_applicable", "implemented", "not_implemented", "partially_implemented", "implemented", "implemented", "partially_implemented", "not_implemented", "implemented", "partially_implemented", "implemented", "not_implemented", "partially_implemented"];
      await answerControls("meridian", 25, rohan, mix, { submitted: true, validated: true });
      // Scope decisions are recorded before the assessment is finalized: applicable, except the one answered "not applicable".
      await c.query(
        `UPDATE assessment_controls ac SET applicability_decision = CASE WHEN r.effectiveness_rating = 'not_applicable' THEN 'not_applicable'::control_applicability_decision ELSE 'applicable'::control_applicability_decision END,
                applicability_rationale = CASE WHEN r.effectiveness_rating = 'not_applicable' THEN 'The organisation does not carry out this activity.' ELSE 'In scope for the DPDP readiness programme.' END,
                applicability_decided_by = $2, applicability_decided_at = $3
           FROM assessment_responses r WHERE r.assessment_control_id = ac.id AND ac.assessment_id = $1`,
        [m.asm, admin.id, ago(70)],
      );
      await c.query("UPDATE assessments SET status = 'finalized' WHERE id = $1", [m.asm]);

      const f1 = await finding("meridian", "No documented retention schedule", "Customer KYC records, call recordings and rejected applications are kept indefinitely. There is no schedule defining how long each type of personal data should be retained, or when it is erased.", "high", true);
      const f2 = await finding("meridian", "Consent notice does not name all purposes", "The mobile-app consent screen covers underwriting but not marketing cross-sell or sharing with co-lending partners as separate, clearly described purposes.", "high", true, "in_progress");
      const f3 = await finding("meridian", "Vendor contracts lack data protection clauses", "Of 14 reviewed processor contracts, 9 have no clause on breach notification, sub-processors or return and deletion of data.", "critical", true, "in_progress");
      const f4 = await finding("meridian", "Breach response plan never rehearsed", "A breach plan exists, but there has been no tabletop exercise and the 72-hour reporting path to the Board is not tested.", "medium", true);
      await finding("meridian", "Collections agents see full customer files (DRAFT)", "Draft for internal discussion before release: access in the collections dialler is not limited to the accounts an agent is working.", "medium", false);

      await risk("meridian", "Personal data kept longer than needed", "Indefinite retention increases breach impact and exposes the company to erasure complaints.", 4, 4, "mitigating", rohan, [2, 3]);
      await risk("meridian", "Invalid consent for marketing and partner sharing", "Purposes are bundled in a single consent, which may not be treated as specific and informed.", 4, 5, "open", asha);
      await risk("meridian", "Processor causes an unreported breach", "Contracts do not oblige vendors to report incidents within a defined time.", 3, 5, "mitigating", rohan, [2, 4]);
      await risk("meridian", "Delay in notifying the Board and regulator after a breach", "The response path has never been exercised end to end.", 3, 4, "open", rohan);
      await risk("meridian", "Over-broad internal access to customer files", "Collections and support teams have wider access than their work needs.", 3, 3, "accepted", kabir);

      await action("meridian", f1, "Approve and publish a data retention schedule", "Define retention periods per data category with Legal, then configure automated archival and erasure in the LMS and data warehouse.", "high", "in_progress", inDays(21), rohan);
      await action("meridian", f2, "Rework app consent screen into separate purposes", "Split consent into underwriting, marketing and partner sharing, each with plain-language text and a withdraw option.", "high", "open", inDays(35), asha);
      await action("meridian", f3, "Amend the 9 non-compliant processor contracts", "Add a standard data protection schedule: breach notice within 24 hours, sub-processor approval, deletion on exit.", "critical", "in_progress", inDays(14), rohan);
      await action("meridian", f3, "Create a vendor register with risk tiering", "One register of all processors with data types shared, owner and contract status.", "medium", "evidence_submitted", inDays(-3), neha);
      await action("meridian", f4, "Run a breach tabletop exercise with the Board", "Two-hour scenario exercise with Legal, IT, Communications and a Board member.", "medium", "closed", inDays(-12), asha);

      await evidenceRequest("meridian", "ER-001", "Latest vendor contract list with signature dates", "Export from the contract system, including renewal dates.", inDays(7), team.admin!);
      await evidenceRequest("meridian", "ER-002", "Screenshot of current app consent screen (Android and iOS)", "Needed to confirm the final wording after the redesign.", inDays(-2), team.admin!);

      await clarification("meridian", "CL-001", "Does co-lending data sharing need a separate consent?", "answered", rohan, "client", [
        [rohan, "client", "Our partner banks receive KYC and bureau data for co-lending. Do we need a separate consent for that sharing, or is it covered by the loan application consent?", 18],
        [priya, "primus", "It should be a separate, clearly described purpose. We have reflected this in finding 2. Please confirm the list of partner banks so we can name them in the notice.", 17],
      ]);
      await clarification("meridian", "CL-002", "Which CRM fields are in scope?", "closed", asha, "client", [
        [asha, "client", "Should free-text notes in the CRM be treated as personal data for the retention schedule?", 25],
        [arjun, "primus", "Yes. Notes often hold personal details, so they are in scope. Included in the schedule.", 24],
      ]);

      await task("meridian", { title: "Share list of partner banks for the consent notice", side: "client", due: inDays(5), by: team.admin!, assignee: rohan });
      await task("meridian", { title: "Nominate owners for each remediation action", side: "client", due: inDays(-4), by: team.admin!, assignee: asha });
      await task("meridian", { title: "Approve discovery scope", side: "client", due: inDays(-40), done: true, by: asha });
      await task("meridian", { title: "Review draft report with leadership", side: "client", due: inDays(10), by: team.admin!, assignee: kabir });
      await task("meridian", { kind: "milestone", title: "Discovery approved", side: "primus", due: inDays(-46), done: true, by: admin.id });
      await task("meridian", { kind: "milestone", title: "Assessment validated", side: "primus", due: inDays(-14), done: true, by: admin.id });
      await task("meridian", { kind: "milestone", title: "Report v1 released", side: "primus", due: inDays(-10), done: true, by: admin.id });
      await task("meridian", { kind: "milestone", title: "Remediation checkpoint", side: "primus", due: inDays(30), by: admin.id });
      await task("meridian", { kind: "milestone", title: "Re-assessment and closure", side: "primus", due: inDays(90), by: admin.id });

      await rights("meridian", 1, "Customer asks for a copy of all personal data held", "access", "Email to grievance cell", "in_progress", 18, rohan);
      await rights("meridian", 2, "Request to delete data after loan closure", "erasure", "Mobile app", "new", 4, rohan);
      await rights("meridian", 3, "Withdrawal of marketing consent", "withdraw_consent", "Call centre", "closed", 40, rohan);
      await rights("meridian", 4, "Correction of mobile number", "correction", "Branch", "closed", 55, rohan);

      await activity("meridian", admin.id, "engagement_opened", "Primus opened the engagement", ago(75));
      await activity("meridian", asha, "discovery_submitted", "Asha Verma submitted the discovery questionnaire", ago(50));
      await activity("meridian", admin.id, "discovery_approved", "Demo Administrator approved the discovery scope", ago(46));
      await activity("meridian", rohan, "assessment_submitted", "Rohan Gupta submitted the assessment for review", ago(20));
      await activity("meridian", admin.id, "assessment_validated", "Demo Administrator validated 24 answers", ago(14));
      await activity("meridian", admin.id, "findings_released", "Demo Administrator released 4 findings to the client", ago(12));
      await activity("meridian", arjun, "finding_drafted", "Arjun Mehta drafted a finding (not yet released)", ago(11), false);
      await activity("meridian", admin.id, "report_released", "Demo Administrator released report version 1", ago(10));
      await activity("meridian", asha, "remediation_closed", "Asha Verma closed the breach tabletop action", ago(5));
      for (const u of [asha, rohan, kabir]) {
        await notify("meridian", u, "findings_released", "4 new findings released", "No documented retention schedule; Consent notice does not name all purposes; Vendor contracts lack data protection clauses", "/portal/findings", ago(12), u === kabir);
        await notify("meridian", u, "report_released", "A new report is available", "DPDP readiness FY2026-27: engagement report", "/portal/reports", ago(10), u !== asha);
      }
      await notify("meridian", rohan, "clarification", "New reply on CL-001: Does co-lending data sharing need a separate consent?", "It should be a separate, clearly described purpose.", "/portal/clarifications", ago(17), false);
      await notify("meridian", asha, "evidence_requested", "Evidence requested: ER-002", "Screenshot of current app consent screen (Android and iOS)", "/portal/evidence", ago(6), false);
      for (const u of [admin.id, priya, arjun]) {
        await notify("meridian", u, "rights_request", "Data Principal request RR-" + new Date().getUTCFullYear() + "-0002 logged", "Request to delete data after loan closure", "/engagements", ago(4), false);
      }
    }

    // =====================================================================
    // 2. VITALIS CARE: client is mid-assessment, evidence outstanding
    // =====================================================================
    {
      const v = ids.vitalis!;
      const ananya = v.people["Dr Ananya Rao"]!, vikram = v.people["Vikram Sethi"]!, pooja = v.people["Pooja Menon"]!;
      await discovery("vitalis", "approved", ananya, [
        ["organisation_profile", { summary: "Vitalis Care Network runs 6 multi-speciality hospitals and 22 diagnostic centres in Karnataka and Tamil Nadu, with a patient app for appointments and reports. Around 2.1 million patient records.", sector: "healthcare", employees: "1000_5000", website: "vitaliscare.example" }],
        ["business_units", { units: "Hospitals\nDiagnostics and labs\nPharmacy\nPatient app and digital\nInsurance desk\nHR and medical staffing", owners: "The Medical Superintendent of each hospital; the Privacy Officer for the group." }],
        ["processing_activities", { activities: "Patient registration and admission\nElectronic medical records\nLab and imaging reports\nInsurance and TPA claims\nPatient app and teleconsultation\nStaff records", purposes: "Treatment, billing, insurance claims, quality audits, regulatory reporting.", automated_decisions: false }],
        ["data_categories", { data_types: ["identity", "contact", "health", "financial", "biometric", "employee"], principals: ["patients", "employees", "visitors", "children"], children_data: true, large_volume: true }],
        ["systems", { systems: "Hospital information system (HIS)\nPACS imaging\nLab information system\nPatient app\nPharmacy system\nHRMS", cloud: true, integrations: "Insurance TPAs, ABDM health records gateway, 3 diagnostic partners." }],
        ["lifecycle", { collection: "At registration desks, through the app and from referring doctors.", sharing: "Insurers and TPAs, diagnostic partners, government health programmes.", retention_schedule: "no", erasure_process: "not_sure" }],
      ]);
      const mix: Rating[] = ["implemented", "partially_implemented", "not_implemented", "implemented", "partially_implemented", "implemented", "not_implemented", "partially_implemented", "implemented", "partially_implemented", "not_implemented", "implemented", "partially_implemented", "implemented"];
      await answerControls("vitalis", 14, vikram, mix, {});

      await finding("vitalis", "Patient reports shared over WhatsApp by staff", "Front-desk staff send diagnostic reports to patients on personal WhatsApp numbers. There is no approved channel or logging.", "high", false);
      await finding("vitalis", "Children's data processed without parental consent flow (DRAFT)", "Paediatric registrations do not capture verifiable parental consent for non-treatment purposes such as reminders and research.", "critical", false);

      await risk("vitalis", "Health records exposed through informal sharing", "Reports sent by personal messaging apps cannot be controlled or recalled.", 4, 5, "open", vikram);
      await risk("vitalis", "Children's data without verifiable consent", "Paediatric records are processed beyond treatment with no parental consent mechanism.", 3, 5, "open", ananya);

      await task("vitalis", { title: "Complete the remaining 11 assessment questions", side: "client", due: inDays(8), by: team.admin!, assignee: vikram });
      await task("vitalis", { title: "Upload the data sharing agreement with the TPA", side: "client", due: inDays(-3), by: team.admin!, assignee: ananya });
      await task("vitalis", { title: "Approve discovery scope", side: "client", due: inDays(-30), done: true, by: ananya });
      await task("vitalis", { kind: "milestone", title: "Discovery approved", side: "primus", due: inDays(-28), done: true, by: admin.id });
      await task("vitalis", { kind: "milestone", title: "Assessment submitted by client", side: "primus", due: inDays(12), by: admin.id });
      await task("vitalis", { kind: "milestone", title: "Findings workshop", side: "primus", due: inDays(30), by: admin.id });

      await evidenceRequest("vitalis", "ER-001", "Patient registration consent form (current version)", "Include the paediatric and adult versions.", inDays(4), team.admin!);
      await evidenceRequest("vitalis", "ER-002", "Data sharing agreement with the main TPA", "Signed copy with annexures.", inDays(-3), team.admin!);
      await evidenceRequest("vitalis", "ER-003", "Access control list for the imaging system", "Who can view, download and delete scans.", inDays(9), team.admin!);

      await clarification("vitalis", "CL-001", "Are teleconsultation recordings in scope?", "open", vikram, "client", [
        [vikram, "client", "We record some teleconsultations for quality review. Are these recordings in scope for the retention schedule, and do patients need to be told?", 3],
      ]);

      await rights("vitalis", 1, "Patient asks for correction of date of birth in records", "correction", "Registration desk", "new", 6, vikram);

      await activity("vitalis", admin.id, "engagement_opened", "Primus opened the engagement", ago(40));
      await activity("vitalis", ananya, "discovery_submitted", "Dr Ananya Rao submitted the discovery questionnaire", ago(32));
      await activity("vitalis", admin.id, "discovery_approved", "Demo Administrator approved the discovery scope", ago(28));
      await activity("vitalis", vikram, "answers_saved", "Vikram Sethi answered 14 of 25 assessment questions", ago(2));
      await activity("vitalis", arjun, "finding_drafted", "Arjun Mehta drafted 2 findings (not yet released)", ago(1), false);
      await notify("vitalis", vikram, "evidence_requested", "Evidence requested: ER-003", "Access control list for the imaging system", "/portal/evidence", ago(1), false);
      await notify("vitalis", ananya, "task", "Task due soon: Upload the data sharing agreement with the TPA", "Due date has passed", "/portal/tasks", ago(2), false);
      for (const u of [admin.id, priya, arjun]) await notify("vitalis", u, "clarification", "New clarification CL-001: Are teleconsultation recordings in scope?", "We record some teleconsultations for quality review.", "/clarifications", ago(3), false);
    }

    // =====================================================================
    // 3. BAZAARLY COMMERCE: just started, discovery in progress
    // =====================================================================
    {
      const b = ids.bazaarly!;
      const sameer = b.people["Sameer Khanna"]!, ishita = b.people["Ishita Bose"]!;
      await discovery("bazaarly", "in_progress", sameer, [
        ["organisation_profile", { summary: "Bazaarly is a multi-seller online marketplace for home and lifestyle products, with about 3.2 million registered shoppers and 18,000 active sellers.", sector: "retail_ecommerce", employees: "250_1000", website: "bazaarly.example" }],
        ["business_units", { units: "Marketplace operations\nSeller onboarding\nLogistics\nCustomer support\nMarketing and growth\nTechnology", owners: "To be confirmed" }],
        ["processing_activities", { activities: "Shopper registration and orders\nSeller KYC and payouts\nDelivery tracking\nPersonalised recommendations\nPush and email marketing", purposes: "Order fulfilment, payments, personalisation and marketing.", automated_decisions: true }],
      ]);
      await task("bazaarly", { title: "Finish the discovery questionnaire (10 steps left)", side: "client", due: inDays(7), by: team.admin!, assignee: sameer });
      await task("bazaarly", { title: "Nominate a Privacy Officer and a backup", side: "client", due: inDays(3), by: team.admin!, assignee: sameer });
      await task("bazaarly", { title: "Share the list of third-party SDKs used in the app", side: "client", due: inDays(12), by: team.admin!, assignee: ishita });
      await task("bazaarly", { kind: "milestone", title: "Kick-off completed", side: "primus", due: inDays(-8), done: true, by: admin.id });
      await task("bazaarly", { kind: "milestone", title: "Discovery approved", side: "primus", due: inDays(14), by: admin.id });
      await task("bazaarly", { kind: "milestone", title: "Assessment issued", side: "primus", due: inDays(21), by: admin.id });
      await rights("bazaarly", 1, "Shopper asks to delete account and order history", "erasure", "Support email", "new", 2, ishita);
      await activity("bazaarly", admin.id, "engagement_opened", "Primus opened the engagement", ago(9));
      await activity("bazaarly", sameer, "discovery_saved", "Sameer Khanna completed 3 of 13 discovery steps", ago(2));
      await notify("bazaarly", sameer, "task", "Welcome to Primus Privacy", "Start with the discovery questionnaire. It saves as you go.", "/portal/discovery", ago(9), true);
      await notify("bazaarly", ishita, "task", "A task was assigned to you", "Share the list of third-party SDKs used in the app", "/portal/tasks", ago(5), false);
    }

    // ---- maturity scoring method (practice content) and per-engagement weights ----
    // Every control belongs to exactly one domain, so the maturity score uses every answer.
    {
      const methodology = {
        rating_scores: { implemented: 5, partially_implemented: 3, not_implemented: 1, not_applicable: null, not_assessed: null },
        levels: [
          { min: 1, max: 1.99, label: "Ad hoc" },
          { min: 2, max: 2.99, label: "Developing" },
          { min: 3, max: 3.99, label: "Defined" },
          { min: 4, max: 4.99, label: "Managed" },
          { min: 5, max: 5, label: "Optimised" },
        ],
      };
      await c.query("INSERT INTO maturity_scoring_methodologies (tenant_id, name, version, definition, is_active) VALUES ($1,'Primus DPDP maturity','v1 (demo)',$2::jsonb,true)", [tenantId, JSON.stringify(methodology)]);
      const DOMAINS: Array<{ code: string; name: string; weight: number; prefixes: string[]; description: string }> = [
        { code: "GOV", name: "Governance and accountability", weight: 20, prefixes: ["GOV", "INV", "LEG", "PUR"], description: "Who is accountable, what data is held and on what basis." },
        { code: "NOC", name: "Notice and consent", weight: 20, prefixes: ["NOT", "CON", "CHI"], description: "Telling people what happens to their data and asking properly, including for children." },
        { code: "RIG", name: "Data Principal rights", weight: 15, prefixes: ["RIG", "ACC"], description: "Handling requests, grievances and keeping data accurate." },
        { code: "SEB", name: "Security and breach response", weight: 20, prefixes: ["SEC", "BRE"], description: "Safeguards, access control and breach handling." },
        { code: "RTP", name: "Retention, vendors and transfers", weight: 15, prefixes: ["RET", "PRO", "XBR"], description: "Erasure, processors and cross-border transfers." },
        { code: "SDF", name: "Significant Data Fiduciary duties", weight: 10, prefixes: ["SDF"], description: "Extra duties for large or sensitive processors." },
      ];
      for (const d of DOMAINS) {
        const domId = (await c.query<{ id: string }>("INSERT INTO maturity_domains (tenant_id, name, code, description, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id", [tenantId, d.name, d.code, d.description])).rows[0]!.id;
        for (const ctl of controls.filter((x) => d.prefixes.some((p) => x.code.startsWith(`${p}-`)))) {
          await c.query("INSERT INTO maturity_domain_control_mappings (maturity_domain_id, control_id, tenant_id) VALUES ($1,$2,$3)", [domId, ctl.id, tenantId]);
        }
        for (const x of Object.values(ids)) {
          await c.query("INSERT INTO maturity_domain_weights (engagement_id, organisation_id, tenant_id, maturity_domain_id, weight, is_active) VALUES ($1,$2,$3,$4,$5,true)", [x.eng, x.org, tenantId, domId, d.weight]);
        }
      }
    }

    await c.query("COMMIT");
    console.log(`✓ Demo data added: 3 fictional organisations (Meridian Finserve, Vitalis Care Network, Bazaarly Commerce), ${controls.length} controls each, ${PRIMUS_TEAM.length + 1} Primus users, ${FIRMS.reduce((n, f) => n + f.team.length, 0)} client users.`);

    // The released report is built by the product itself, so the PDF is real.
    const { withRequestDb } = await import("../lib/db/request-client");
    const { releaseReport } = await import("../lib/workspace/reports");
    const m = ids.meridian!;
    const out = await withRequestDb(admin.id, (db) => releaseReport(db, admin.id, { organisationId: m.org, engagementId: m.eng, userEmail: "admin@primus.local" }));
    console.log(`✓ Report v${out.version} released for Meridian Finserve.`);
    // Maturity is computed by the product itself, once, because Meridian's assessment is finalized.
    const { computeAndFinalizeMaturityAssessment } = await import("../lib/domain/maturity");
    const mat = await withRequestDb(admin.id, (db) => computeAndFinalizeMaturityAssessment(db, admin.id, { assessmentId: m.asm }));
    console.log(`✓ Maturity computed for Meridian Finserve: ${mat.overallScore} (${mat.overallLevel ?? "no level"}).`);
    // Make the report's release time and its activity entries sit sensibly in the past
    await c.query("UPDATE report_releases SET released_at = $2 WHERE engagement_id = $1", [m.eng, ago(10)]);
    await c.query("DELETE FROM engagement_activity WHERE engagement_id = $1 AND kind = 'report_released' AND occurred_at > $2", [m.eng, ago(1)]);
    await c.query("DELETE FROM notifications WHERE engagement_id = $1 AND kind = 'report_released' AND created_at > $2", [m.eng, ago(1)]);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    (c as PoolClient).release();
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`✗ ${e.message ?? e}`);
  process.exit(1);
});
