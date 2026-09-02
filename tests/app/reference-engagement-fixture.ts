// PRIMUS PRIVACY — Reference/Demo Engagement Dataset.
//
// Builds ONE coherent, entirely fictional consulting engagement —
// "ABC Fintech Private Limited" / "DPDP Compliance Assessment — FY
// 2026–27" — end to end, through the SAME real application code every
// other test in this repository exercises (no shortcuts, no synthetic
// "pretend this worked" stand-ins for anything the application layer
// actually implements).
//
// Why this lives here, not as a standalone `tsx` script: every
// `lib/domain/*` module begins with `import "server-only"`, and the
// real `server-only` npm package unconditionally throws when imported
// outside a Next.js/webpack bundle — a plain `tsx` script cannot import
// any domain function at all. The ONLY place in this repository real
// domain functions are ever exercised outside the Next.js server itself
// is Vitest, via `tests/shims/server-only.ts`'s alias
// (vitest.config.ts). Rather than inventing a second mechanism for
// this fixture (explicitly out of scope — "do not create a giant new
// abstraction merely to support the fixture"), this reuses that exact,
// pre-existing mechanism: this module is imported by
// `reference-engagement.test.ts`, which is how it runs, is re-run
// (every `test:app`/`test:db` invocation, after `reset-test-db.ts`),
// and is used in automated tests, all at once — satisfying the "run
// repeatedly / reset cleanly / used in automated tests" requirement
// with the repository's own existing tooling.
//
// Two layers of construction, deliberately kept distinct:
//   1. RAW SQL (via `asFixtureSetup`, a superuser connection) — used
//      ONLY for the identity/bootstrap layer no application code can
//      create at all (Tenant, Users, Memberships — this product has no
//      sign-up/invitation flow, exactly like every other test file's
//      own `beforeAll`) and for the two areas this inspection found
//      have real database schema but NO application layer whatsoever
//      (the DPDP Control Library/regulatory content, and Data
//      Landscape/ROPA) — see PROGRESS.md's "Reference Engagement
//      Dataset" section and REFERENCE_ENGAGEMENT.md for the full
//      finding. This is a clearly-isolated fixture representation, not
//      a pretence that an application layer exists for these two areas.
//   2. REAL DOMAIN FUNCTIONS (via `withRequestDb`) — used for
//      EVERYTHING this repository's application layer actually
//      implements: Organisation, Engagement, Engagement Membership,
//      Assessment, Assessment Response, Control Test, Evidence, Risk,
//      Finding, Remediation, Validation, and the Engagement Report.
//      Nothing here is faked or bypassed — every one of these rows is
//      created by calling the exact function a real Server Action
//      would call, with the exact authorization checks a real user
//      would go through.
//
// All content is clearly fictional (PHASE R2 instructions §2/§14):
// "ABC Fintech Private Limited" is an invented company; the Tenant name
// itself carries a "(Synthetic Data)" marker; the Control Library is
// labeled SAMPLE/DEMO in its own version label and never claims to be
// an official or verified DPDP framework; every synthetic evidence
// document's own file content states plainly that it is not a real
// document. No real company, regulator text, or person's data appears
// anywhere in this fixture.
import type { PoolClient } from "pg";
// Imported from "./helpers" (Slice A1's own test-harness module), not
// "../rls/helpers" directly — "./helpers" is what points
// `lib/db/request-client.ts`'s `DATABASE_URL` at the test database
// (`TEST_DATABASE_SUPERUSER_URL`) as a side effect of being imported,
// exactly as every other `tests/app/*.test.ts` file already relies on.
// Importing the raw-fixture builders directly from their own
// sub-directory helper files (bypassing "./helpers") would skip that
// side effect and leave `withRequestDb` pointed at the wrong database.
import {
  pool,
  asFixtureSetup,
  createTenant,
  createUser,
  grantTenantMembership,
  createRiskScoringModel,
} from "./helpers";
import {
  createRegulatoryReference,
  createRequirement,
  linkControlRequirement,
  linkRequirementRegulatoryReference,
  createControlLibraryVersion,
  publishControlLibraryVersion,
  createControl,
} from "../control-library/helpers";
import {
  createBusinessUnit,
  createSystem,
  insertSystemVersion,
  createDataStore,
  insertDataStoreVersion,
  createProcessor,
  insertProcessorVersion,
  createPurpose,
  insertPurposeVersion,
  createPersonalDataElement,
  insertPersonalDataElementVersion,
  createDataPrincipalCategory,
  insertDataPrincipalCategoryVersion,
} from "../master-data/helpers";
import {
  createProcessingActivity,
  linkSystem,
  linkDataStore,
  linkProcessor,
  linkPurpose,
  linkPersonalDataElement,
  linkDataPrincipalCategory,
} from "../processing-activity/helpers";

import { withRequestDb } from "@/lib/db/request-client";
import { createOrganisation } from "@/lib/domain/organisations";
import { createEngagement } from "@/lib/domain/engagements";
import { addEngagementMember, listEngagementRoles } from "@/lib/domain/engagement-memberships";
import {
  createAssessment,
  getAssessmentDetail,
  updateAssessmentResponse,
  createControlTest,
  type AssessmentDetail,
} from "@/lib/domain/assessments";
import { uploadEvidence } from "@/lib/domain/evidence";
import { createRisk, updateRiskStatus } from "@/lib/domain/risks";
import { createFinding, updateFinding } from "@/lib/domain/findings";
import { createRemediationAction, updateRemediationAction } from "@/lib/domain/remediation";
import { createValidationRecord } from "@/lib/domain/validation";

export { pool, asFixtureSetup };

function syntheticFile(label: string, extra = "") {
  return {
    buffer: Buffer.from(
      `SYNTHETIC / DEMO DOCUMENT — NOT A REAL CLIENT DOCUMENT.\n` +
        `Generated for the PRIMUS PRIVACY reference/demo engagement dataset.\n` +
        `Document: ${label}\n${extra}`,
      "utf8",
    ),
    filename: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-SAMPLE.txt`,
    mimeType: "text/plain",
  };
}

// --- Demo DPDP Control Library (§4): 12 categories, 25 controls -----------
// Concise, original control statements — never a quotation of statutory
// text, never attributed to a specific DPDP Act/Rules section number.
const CATEGORIES: Array<{
  key: string;
  requirementTitle: string;
  controls: Array<{ code: string; title: string; type: "preventive" | "detective" | "corrective"; description: string }>;
}> = [
  {
    key: "GOV",
    requirementTitle: "Establish and maintain data protection governance",
    controls: [
      { code: "GOV-01", title: "Data protection governance structure defined", type: "preventive", description: "A designated individual or function is accountable for personal data protection oversight, with a documented reporting line to senior management." },
      { code: "GOV-02", title: "DPDP compliance policy approved and communicated", type: "preventive", description: "A leadership-approved data protection policy exists and has been communicated to relevant personnel." },
    ],
  },
  {
    key: "NOT",
    requirementTitle: "Provide clear notice to data principals at or before collection",
    controls: [
      { code: "NOT-01", title: "Privacy notice provided at or before data collection", type: "preventive", description: "A privacy notice is presented to data principals at or before personal data is collected, across the organisation's primary collection channels." },
      { code: "NOT-02", title: "Privacy notice covers required disclosures", type: "preventive", description: "The privacy notice describes what personal data is collected, the purpose of processing, and how to exercise data principal rights." },
    ],
  },
  {
    key: "CON",
    requirementTitle: "Obtain and manage valid consent as a lawful basis for processing",
    controls: [
      { code: "CON-01", title: "Consent capture mechanism meets DPDP principles", type: "preventive", description: "Consent is captured through a clear, specific, and informed mechanism, separate from other terms, before processing begins." },
      { code: "CON-02", title: "Consent withdrawal mechanism available and honoured", type: "corrective", description: "Data principals can withdraw consent as easily as it was given, and withdrawal is acted on within a reasonable period." },
    ],
  },
  {
    key: "DPR",
    requirementTitle: "Support data principal rights requests",
    controls: [
      { code: "DPR-01", title: "Process exists to receive and log data principal requests", type: "detective", description: "A defined channel and log exist for receiving and tracking data principal rights requests (access, correction, erasure, grievance)." },
      { code: "DPR-02", title: "Data principal requests actioned within defined timelines", type: "corrective", description: "Data principal requests are resolved within the organisation's own documented turnaround time." },
    ],
  },
  {
    key: "SEC",
    requirementTitle: "Implement reasonable security safeguards for personal data",
    controls: [
      { code: "SEC-01", title: "Access controls restrict personal data to authorised personnel", type: "preventive", description: "Role-based access controls limit personal data access to personnel with a documented business need." },
      { code: "SEC-02", title: "Encryption applied to personal data at rest and in transit", type: "preventive", description: "Personal data held in production systems is encrypted at rest and in transit using current, supported algorithms." },
      { code: "SEC-03", title: "Security testing and vulnerability management programme in place", type: "detective", description: "Systems holding personal data are subject to periodic vulnerability scanning and remediation tracking." },
    ],
  },
  {
    key: "RET",
    requirementTitle: "Manage retention and deletion of personal data",
    controls: [
      { code: "RET-01", title: "Data retention schedule defined and documented", type: "preventive", description: "A documented retention schedule specifies how long each category of personal data is kept and the basis for that period." },
      { code: "RET-02", title: "Deletion or erasure verified upon retention expiry", type: "detective", description: "Personal data is deleted or anonymised once its retention period expires, with evidence of the deletion action." },
    ],
  },
  {
    key: "BRE",
    requirementTitle: "Detect, respond to, and report personal data breaches",
    controls: [
      { code: "BRE-01", title: "Data breach detection and response procedure defined", type: "preventive", description: "A documented procedure describes how a personal data breach is detected, triaged, and escalated internally." },
      { code: "BRE-02", title: "Breach notification process meets regulatory timelines", type: "corrective", description: "The breach response procedure includes defined timelines and responsibilities for notifying the regulator and affected data principals." },
    ],
  },
  {
    key: "VEN",
    requirementTitle: "Govern processor and vendor relationships handling personal data",
    controls: [
      { code: "VEN-01", title: "Data Processing Agreements executed with processors", type: "preventive", description: "A written agreement covering data protection obligations is in place with every third party that processes personal data on the organisation's behalf." },
      { code: "VEN-02", title: "Processor compliance monitored periodically", type: "detective", description: "Processor compliance with agreed data protection terms is reviewed on a periodic basis." },
    ],
  },
  {
    key: "CHI",
    requirementTitle: "Apply additional safeguards to processing of children's personal data",
    controls: [
      { code: "CHI-01", title: "Verifiable parental consent for children's data", type: "preventive", description: "Where personal data of a child is processed, verifiable parental or guardian consent is obtained before processing begins." },
      { code: "CHI-02", title: "Processing restrictions for children's data enforced", type: "preventive", description: "Tracking, behavioural monitoring, and targeted advertising directed at children are not performed, consistent with the organisation's stated restrictions." },
    ],
  },
  {
    key: "GRI",
    requirementTitle: "Provide an accessible grievance redressal mechanism",
    controls: [
      { code: "GRI-01", title: "Grievance redressal mechanism published and accessible", type: "preventive", description: "A grievance officer or channel is identified and published so data principals can raise concerns about processing of their personal data." },
      { code: "GRI-02", title: "Grievances resolved within defined timelines", type: "corrective", description: "Grievances are acknowledged and resolved within the organisation's own documented service levels." },
    ],
  },
  {
    key: "TRA",
    requirementTitle: "Govern cross-border transfer and third-party disclosure of personal data",
    controls: [
      { code: "TRA-01", title: "Cross-border transfer restrictions assessed", type: "preventive", description: "Transfers of personal data outside India are assessed against the organisation's own cross-border transfer policy before they occur." },
      { code: "TRA-02", title: "Third-party disclosure governed by agreement", type: "preventive", description: "Disclosure of personal data to a third party outside a processor relationship is governed by a documented agreement or legal basis." },
    ],
  },
  {
    key: "ACC",
    requirementTitle: "Maintain accountability documentation and conduct compliance review",
    controls: [
      { code: "ACC-01", title: "Records of processing activities maintained", type: "detective", description: "A current record of the organisation's processing activities (purpose, data categories, systems, recipients) is maintained." },
      { code: "ACC-02", title: "Periodic internal compliance review conducted", type: "detective", description: "An internal review of DPDP compliance is performed on a periodic basis and findings are tracked to closure." },
    ],
  },
];

// --- Assessment responses: a realistic mixture, and a deliberate gap ------
// (7 of 25 controls are left with NO response at all — not_assessed by
// omission — matching the honest "not everything gets assessed in one
// pass" reality instructions §5 wants exercised.)
const RESPONSES: Record<string, { rating: "not_applicable" | "not_implemented" | "partially_implemented" | "implemented"; rationale: string }> = {
  "GOV-01": { rating: "implemented", rationale: "A Data Protection Officer function has been designated with a direct reporting line to the CEO; charter reviewed and confirmed." },
  "GOV-02": { rating: "partially_implemented", rationale: "A draft data protection policy exists but has not yet received board approval; interim guidance has been communicated to staff." },
  "NOT-01": { rating: "implemented", rationale: "Privacy notice is displayed on the onboarding app and website at the point of data collection." },
  "NOT-02": { rating: "partially_implemented", rationale: "Privacy notice covers data categories and purpose but does not yet describe the grievance redressal process in detail." },
  "CON-01": { rating: "implemented", rationale: "Consent is captured via a dedicated, unticked checkbox separate from the terms of service, at account opening." },
  "CON-02": { rating: "not_implemented", rationale: "No self-service consent withdrawal option exists yet; withdrawal currently requires contacting support manually." },
  "DPR-01": { rating: "implemented", rationale: "A dedicated data-principal-request mailbox and tracking sheet is in place and monitored by the DPO function." },
  "SEC-01": { rating: "implemented", rationale: "Role-based access control is enforced in the core banking system and customer data warehouse via directory-service groups." },
  "SEC-02": { rating: "partially_implemented", rationale: "Encryption at rest is enabled for the customer data warehouse; encryption in transit is enforced for external APIs but not yet for one internal batch feed." },
  "RET-01": { rating: "partially_implemented", rationale: "A retention schedule exists for core customer records but does not yet cover marketing or HR data categories." },
  "BRE-01": { rating: "implemented", rationale: "An incident response procedure defines detection, triage, and internal escalation steps for suspected personal data breaches." },
  "BRE-02": { rating: "not_implemented", rationale: "The incident response procedure does not yet specify regulatory notification timelines or a named notification owner." },
  "VEN-01": { rating: "not_implemented", rationale: "Data Processing Agreements have not been executed with two of the organisation's four active processors." },
  "VEN-02": { rating: "partially_implemented", rationale: "Processor compliance is reviewed informally at contract renewal but not on a fixed periodic schedule." },
  "CHI-01": { rating: "not_applicable", rationale: "The organisation's products are restricted to adults (18+) at onboarding; no children's data is knowingly processed." },
  "GRI-01": { rating: "implemented", rationale: "A grievance officer is named and their contact details are published on the organisation's website." },
  "TRA-01": { rating: "partially_implemented", rationale: "Cross-border transfer is assessed for the cloud hosting provider but not yet for the marketing automation vendor." },
  "ACC-01": { rating: "implemented", rationale: "A processing activity record is maintained for this engagement, covering the ten activities in scope." },
};

const CONTROL_TESTS: Array<{
  code: string;
  methodology: string;
  sampleDescription: string;
  result: "pass" | "fail" | "exception_noted";
  testedAt: string;
  actor: "lead" | "second";
}> = [
  { code: "SEC-01", methodology: "Configuration review", sampleDescription: "Reviewed directory-service group membership for the customer data warehouse (sample of 3 groups).", result: "pass", testedAt: "2026-08-12", actor: "second" },
  { code: "SEC-02", methodology: "Configuration review", sampleDescription: "Reviewed TLS configuration for the internal batch feed.", result: "fail", testedAt: "2026-08-13", actor: "second" },
  { code: "CON-01", methodology: "Policy review", sampleDescription: "Reviewed the onboarding consent flow screens and consent-capture policy.", result: "pass", testedAt: "2026-08-14", actor: "lead" },
  { code: "VEN-01", methodology: "Evidence review", sampleDescription: "Requested signed DPAs for all four active processors.", result: "fail", testedAt: "2026-08-15", actor: "lead" },
  { code: "GOV-01", methodology: "Interview", sampleDescription: "Interviewed the designated DPO function lead on governance responsibilities.", result: "pass", testedAt: "2026-08-11", actor: "lead" },
  { code: "RET-01", methodology: "Sample testing", sampleDescription: "Sampled 5 customer records nearing retention expiry to check for scheduled deletion.", result: "exception_noted", testedAt: "2026-08-18", actor: "lead" },
];

export interface ReferenceEngagementFixture {
  tenantId: string;
  organisationId: string;
  organisationName: string;
  engagementId: string;
  engagementName: string;
  controlLibraryVersionId: string;
  assessmentId: string;
  leadUserId: string;
  secondUserId: string;
  controlIdByCode: Record<string, string>;
  processingActivityIds: Record<string, string>;
  riskIds: Record<string, string>;
  findingIds: Record<string, string>;
  remediationIds: Record<string, string>;
  validationIds: Record<string, string>;
  evidenceIds: Record<string, string>;
  respondedControlCodes: string[];
  unrespondedControlCodes: string[];
  controlTestCodes: string[];
}

export async function buildReferenceEngagement(): Promise<ReferenceEngagementFixture> {
  const controlIdByCode: Record<string, string> = {};

  // === Layer 1: raw bootstrap (Tenant, Users, Control Library) — no
  // application layer exists for regulatory content/control-library
  // authoring, and this product has no self-service sign-up flow for
  // Tenant/User provisioning either. ==========================================
  const { tenantId, leadUserId, secondUserId, controlLibraryVersionId } = await asFixtureSetup(async (client: PoolClient) => {
      const tenantId = await createTenant(client, "PRIMUS Reference Demo Practice (Synthetic Data)");

      const leadUserId = await createUser(client, { tenantId, email: "ananya.krishnan.demo@primusprivacy.example" });
      await grantTenantMembership(client, leadUserId, tenantId, "Practice Partner");
      const secondUserId = await createUser(client, { tenantId, email: "rohan.verma.demo@primusprivacy.example" });

      await createRiskScoringModel(client, { tenantId, name: "Reference Engagement Risk Matrix", version: "v1.0" });

      // --- Demo DPDP Control Library (§4) ---------------------------------
      const regulatoryReferenceId = await createRegulatoryReference(client, {
        tenantId,
        frameworkName: "Digital Personal Data Protection Act, 2023 (illustrative reference — DEMO content, not verified statutory text)",
        citation: "General reference (demo)",
        title: "DPDP Act, 2023 — general reference used by this DEMO control library",
        version: "2023 (demo)",
      });

      const controlLibraryVersionId = await createControlLibraryVersion(client, {
        tenantId,
        versionLabel: "DPDP Demo Control Library v1.0 (SAMPLE — for demonstration only, not an official or verified regulatory framework)",
      });

      for (const category of CATEGORIES) {
        const requirementId = await createRequirement(client, {
          tenantId,
          primaryRegulatoryReferenceId: regulatoryReferenceId,
          title: category.requirementTitle,
          description: "Illustrative DEMO requirement grouping — not a verified statutory citation.",
        });
        await linkRequirementRegulatoryReference(client, { tenantId, requirementId, regulatoryReferenceId });

        for (const control of category.controls) {
          const controlId = await createControl(client, {
            tenantId,
            controlLibraryVersionId,
            code: control.code,
            title: control.title,
            controlType: control.type,
            description: control.description,
          });
          controlIdByCode[control.code] = controlId;
          await linkControlRequirement(client, { tenantId, controlId, requirementId });
        }
      }
      await publishControlLibraryVersion(client, controlLibraryVersionId);

      return { tenantId, leadUserId, secondUserId, controlLibraryVersionId };
    });

  // === Layer 2: real application code from here on ==========================

  // Organisation (real domain function — Slice B1/B2).
  const organisationName = "ABC Fintech Private Limited";
  const { id: organisationId } = await withRequestDb(leadUserId, (db) => createOrganisation(db, leadUserId, { name: organisationName }));

  // Data Landscape / ROPA master data (raw SQL — organisation now
  // exists). See the module-level comment: no domain module exists for
  // any of this, so it is built the same way every processing-activity
  // test fixture in this repository already builds it.
  const md = await asFixtureSetup(async (client: PoolClient) => {
    const businessUnitRetail = await createBusinessUnit(client, organisationId, "Retail Banking Operations");
    const businessUnitDigital = await createBusinessUnit(client, organisationId, "Digital Products & Technology");
    const businessUnitHR = await createBusinessUnit(client, organisationId, "Human Resources");

    const sys = async (name: string, owner: string, hosting: string) => {
      const id = await createSystem(client, organisationId);
      const versionId = await insertSystemVersion(client, { systemId: id, organisationId, name, owner, hostingEnvironment: hosting });
      return { id, versionId };
    };
    const coreBanking = await sys("Core Banking System", "IT/CISO", "on_premise (demo)");
    const onboardingPortal = await sys("Customer Onboarding Portal", "Digital Products & Technology", "cloud (demo)");
    const hrSystem = await sys("HR Information System", "Human Resources", "cloud (demo)");
    const marketingPlatform = await sys("Marketing Automation Platform", "Digital Products & Technology", "cloud (demo, third-party SaaS)");

    const store = async (name: string, systemVersionId?: string) => {
      const id = await createDataStore(client, organisationId);
      const versionId = await insertDataStoreVersion(client, { dataStoreId: id, organisationId, name, systemVersionId });
      return { id, versionId };
    };
    const customerWarehouse = await store("Customer Data Warehouse", coreBanking.versionId);
    const documentStore = await store("Document Management Store", onboardingPortal.versionId);
    const employeeStore = await store("Employee Records Store", hrSystem.versionId);

    const proc = async (name: string, dpaLabel: string | undefined) => {
      const id = await createProcessor(client, organisationId);
      const versionId = await insertProcessorVersion(client, { processorId: id, organisationId, name, dpaVersionLabel: dpaLabel });
      return { id, versionId };
    };
    const cloudHosting = await proc("Cloud Hosting Provider (IaaS) (demo)", "DPA v2.1 (signed, demo)");
    const paymentGateway = await proc("Payment Gateway Processor (demo)", "DPA v1.3 (signed, demo)");
    const marketingVendor = await proc("Email/SMS Marketing Vendor (demo)", undefined); // deliberately no DPA yet — matches VEN-01's gap

    const purpose = async (name: string) => {
      const id = await createPurpose(client, organisationId);
      const versionId = await insertPurposeVersion(client, { purposeId: id, organisationId, name });
      return { id, versionId };
    };
    const purposes = {
      onboarding: await purpose("Customer Onboarding"),
      kyc: await purpose("KYC Verification"),
      accountMgmt: await purpose("Customer Account Management"),
      transactions: await purpose("Transaction Processing"),
      support: await purpose("Customer Support"),
      marketing: await purpose("Marketing Communications"),
      hrAdmin: await purpose("Employee HR Administration"),
      recruitment: await purpose("Recruitment"),
      vendorMgmt: await purpose("Vendor Management"),
      grievance: await purpose("Grievance Handling"),
    };

    const element = async (name: string, sensitivity: "general" | "sensitive" | "critical") => {
      const id = await createPersonalDataElement(client, organisationId);
      const versionId = await insertPersonalDataElementVersion(client, { personalDataElementId: id, organisationId, name, sensitivityCategory: sensitivity });
      return { id, versionId };
    };
    const elements = {
      name: await element("Full Name", "general"),
      pan: await element("PAN", "sensitive"),
      email: await element("Email Address", "general"),
      mobile: await element("Mobile Number", "general"),
      account: await element("Bank Account Number", "critical"),
      transactionHistory: await element("Transaction History", "critical"),
      employment: await element("Employment Details", "sensitive"),
      salary: await element("Salary Information", "sensitive"),
    };

    const category = async (name: string) => {
      const id = await createDataPrincipalCategory(client, organisationId);
      const versionId = await insertDataPrincipalCategoryVersion(client, { dataPrincipalCategoryId: id, organisationId, name });
      return { id, versionId };
    };
    const categories = {
      customers: await category("Customers"),
      employees: await category("Employees"),
      applicants: await category("Job Applicants"),
      vendorContacts: await category("Vendor Contacts"),
    };

    return {
      businessUnitRetail,
      businessUnitDigital,
      businessUnitHR,
      systems: { coreBanking, onboardingPortal, hrSystem, marketingPlatform },
      stores: { customerWarehouse, documentStore, employeeStore },
      processors: { cloudHosting, paymentGateway, marketingVendor },
      purposes,
      elements,
      categories,
    };
  });

  // Engagement (real domain function — Slice B2), pinning the
  // now-published demo Control Library.
  const engagementName = "DPDP Compliance Assessment — FY 2026–27";
  const { id: engagementId } = await withRequestDb(leadUserId, (db) =>
    createEngagement(db, leadUserId, {
      organisationId,
      name: engagementName,
      engagementType: "annual_assessment",
      periodStart: "2026-04-01",
      periodEnd: "2027-03-31",
      controlLibraryVersionId,
    }),
  );

  // Processing Activities / ROPA (raw SQL — engagement now exists),
  // the ten activities the brief itself names, linked to a realistic
  // subset of the master data above.
  const processingActivityIds: Record<string, string> = await asFixtureSetup(async (client: PoolClient) => {
    const pa = async (name: string, businessUnitId: string, lawfulBasis: string) => {
      const id = await createProcessingActivity(client, { engagementId, organisationId, tenantId, name, businessUnitId });
      await client.query(`UPDATE processing_activities SET lifecycle_status = 'active', lawful_basis = $2 WHERE id = $1`, [id, lawfulBasis]);
      return id;
    };

    const ids: Record<string, string> = {};

    ids.onboarding = await pa("Customer onboarding", md.businessUnitDigital, "Consent");
    await linkPurpose(client, { processingActivityId: ids.onboarding, engagementId, organisationId, purposeId: md.purposes.onboarding.id, purposeVersionId: md.purposes.onboarding.versionId });
    await linkSystem(client, { processingActivityId: ids.onboarding, engagementId, organisationId, systemId: md.systems.onboardingPortal.id, systemVersionId: md.systems.onboardingPortal.versionId });
    await linkPersonalDataElement(client, { processingActivityId: ids.onboarding, engagementId, organisationId, personalDataElementId: md.elements.name.id, personalDataElementVersionId: md.elements.name.versionId });
    await linkDataPrincipalCategory(client, { processingActivityId: ids.onboarding, engagementId, organisationId, dataPrincipalCategoryId: md.categories.customers.id, dataPrincipalCategoryVersionId: md.categories.customers.versionId });

    ids.kyc = await pa("KYC verification", md.businessUnitRetail, "Legal obligation");
    await linkPurpose(client, { processingActivityId: ids.kyc, engagementId, organisationId, purposeId: md.purposes.kyc.id, purposeVersionId: md.purposes.kyc.versionId });
    await linkPersonalDataElement(client, { processingActivityId: ids.kyc, engagementId, organisationId, personalDataElementId: md.elements.pan.id, personalDataElementVersionId: md.elements.pan.versionId });
    await linkDataStore(client, { processingActivityId: ids.kyc, engagementId, organisationId, dataStoreId: md.stores.customerWarehouse.id, dataStoreVersionId: md.stores.customerWarehouse.versionId });

    ids.accountMgmt = await pa("Customer account management", md.businessUnitRetail, "Contract performance");
    await linkPurpose(client, { processingActivityId: ids.accountMgmt, engagementId, organisationId, purposeId: md.purposes.accountMgmt.id, purposeVersionId: md.purposes.accountMgmt.versionId });
    await linkPersonalDataElement(client, { processingActivityId: ids.accountMgmt, engagementId, organisationId, personalDataElementId: md.elements.account.id, personalDataElementVersionId: md.elements.account.versionId });
    await linkSystem(client, { processingActivityId: ids.accountMgmt, engagementId, organisationId, systemId: md.systems.coreBanking.id, systemVersionId: md.systems.coreBanking.versionId });

    ids.transactions = await pa("Transaction processing", md.businessUnitRetail, "Contract performance");
    await linkPurpose(client, { processingActivityId: ids.transactions, engagementId, organisationId, purposeId: md.purposes.transactions.id, purposeVersionId: md.purposes.transactions.versionId });
    await linkPersonalDataElement(client, { processingActivityId: ids.transactions, engagementId, organisationId, personalDataElementId: md.elements.transactionHistory.id, personalDataElementVersionId: md.elements.transactionHistory.versionId });
    await linkProcessor(client, { processingActivityId: ids.transactions, engagementId, organisationId, processorId: md.processors.paymentGateway.id, processorVersionId: md.processors.paymentGateway.versionId });

    ids.support = await pa("Customer support", md.businessUnitRetail, "Legitimate use");
    await linkPurpose(client, { processingActivityId: ids.support, engagementId, organisationId, purposeId: md.purposes.support.id, purposeVersionId: md.purposes.support.versionId });
    await linkPersonalDataElement(client, { processingActivityId: ids.support, engagementId, organisationId, personalDataElementId: md.elements.mobile.id, personalDataElementVersionId: md.elements.mobile.versionId });

    ids.marketing = await pa("Marketing communications", md.businessUnitDigital, "Consent");
    await linkPurpose(client, { processingActivityId: ids.marketing, engagementId, organisationId, purposeId: md.purposes.marketing.id, purposeVersionId: md.purposes.marketing.versionId });
    await linkPersonalDataElement(client, { processingActivityId: ids.marketing, engagementId, organisationId, personalDataElementId: md.elements.email.id, personalDataElementVersionId: md.elements.email.versionId });
    await linkProcessor(client, { processingActivityId: ids.marketing, engagementId, organisationId, processorId: md.processors.marketingVendor.id, processorVersionId: md.processors.marketingVendor.versionId });

    ids.hrAdmin = await pa("Employee HR administration", md.businessUnitHR, "Contract performance");
    await linkPurpose(client, { processingActivityId: ids.hrAdmin, engagementId, organisationId, purposeId: md.purposes.hrAdmin.id, purposeVersionId: md.purposes.hrAdmin.versionId });
    await linkPersonalDataElement(client, { processingActivityId: ids.hrAdmin, engagementId, organisationId, personalDataElementId: md.elements.salary.id, personalDataElementVersionId: md.elements.salary.versionId });
    await linkDataPrincipalCategory(client, { processingActivityId: ids.hrAdmin, engagementId, organisationId, dataPrincipalCategoryId: md.categories.employees.id, dataPrincipalCategoryVersionId: md.categories.employees.versionId });
    await linkSystem(client, { processingActivityId: ids.hrAdmin, engagementId, organisationId, systemId: md.systems.hrSystem.id, systemVersionId: md.systems.hrSystem.versionId });
    await linkDataStore(client, { processingActivityId: ids.hrAdmin, engagementId, organisationId, dataStoreId: md.stores.employeeStore.id, dataStoreVersionId: md.stores.employeeStore.versionId });

    ids.recruitment = await pa("Recruitment", md.businessUnitHR, "Legitimate use");
    await linkPurpose(client, { processingActivityId: ids.recruitment, engagementId, organisationId, purposeId: md.purposes.recruitment.id, purposeVersionId: md.purposes.recruitment.versionId });
    await linkPersonalDataElement(client, { processingActivityId: ids.recruitment, engagementId, organisationId, personalDataElementId: md.elements.employment.id, personalDataElementVersionId: md.elements.employment.versionId });
    await linkDataPrincipalCategory(client, { processingActivityId: ids.recruitment, engagementId, organisationId, dataPrincipalCategoryId: md.categories.applicants.id, dataPrincipalCategoryVersionId: md.categories.applicants.versionId });

    ids.vendorMgmt = await pa("Vendor management", md.businessUnitDigital, "Legitimate use");
    await linkPurpose(client, { processingActivityId: ids.vendorMgmt, engagementId, organisationId, purposeId: md.purposes.vendorMgmt.id, purposeVersionId: md.purposes.vendorMgmt.versionId });
    await linkDataPrincipalCategory(client, { processingActivityId: ids.vendorMgmt, engagementId, organisationId, dataPrincipalCategoryId: md.categories.vendorContacts.id, dataPrincipalCategoryVersionId: md.categories.vendorContacts.versionId });
    await linkProcessor(client, { processingActivityId: ids.vendorMgmt, engagementId, organisationId, processorId: md.processors.cloudHosting.id, processorVersionId: md.processors.cloudHosting.versionId });

    ids.grievance = await pa("Grievance handling", md.businessUnitRetail, "Legal obligation");
    await linkPurpose(client, { processingActivityId: ids.grievance, engagementId, organisationId, purposeId: md.purposes.grievance.id, purposeVersionId: md.purposes.grievance.versionId });
    await linkDataPrincipalCategory(client, { processingActivityId: ids.grievance, engagementId, organisationId, dataPrincipalCategoryId: md.categories.customers.id, dataPrincipalCategoryVersionId: md.categories.customers.versionId });

    return ids;
  });

  // Engagement Membership (real domain function — Slice C7.2): the
  // second consultant joins the engagement as a genuine, eligible
  // tenant member added through the real membership-management path.
  const engagementRoles = await withRequestDb(leadUserId, (db) => listEngagementRoles(db));
  const consultantRoleId = engagementRoles.find((r) => r.name === "Consultant")!.id;
  await withRequestDb(leadUserId, (db) =>
    addEngagementMember(db, leadUserId, { organisationId, engagementId, targetUserId: secondUserId, roleId: consultantRoleId }),
  );

  // Assessment (real domain function — Slice C7.1): auto-populates one
  // AssessmentControl per Control in the pinned, published library.
  const { id: assessmentId } = await withRequestDb(leadUserId, (db) =>
    createAssessment(db, leadUserId, { engagementId, assessmentType: "annual", periodLabel: "FY2026-27 Annual DPDP Assessment" }),
  );

  let detail: AssessmentDetail = await withRequestDb(leadUserId, (db) => getAssessmentDetail(db, leadUserId, assessmentId));
  const assessmentControlIdByCode: Record<string, string> = {};
  for (const row of detail.controlRows) {
    const code = Object.keys(controlIdByCode).find((c) => controlIdByCode[c] === row.controlId);
    if (code) assessmentControlIdByCode[code] = row.assessmentControlId;
  }

  // Assessment Responses (real domain function): a realistic mixture —
  // implemented / partially_implemented / not_implemented / not_applicable
  // — deliberately leaving several controls unresponded.
  for (const [code, r] of Object.entries(RESPONSES)) {
    await withRequestDb(leadUserId, (db) =>
      updateAssessmentResponse(db, leadUserId, {
        assessmentControlId: assessmentControlIdByCode[code]!,
        effectivenessRating: r.rating,
        decisionRationale: r.rationale,
      }),
    );
  }
  const respondedControlCodes = Object.keys(RESPONSES);
  const unrespondedControlCodes = Object.keys(controlIdByCode).filter((c) => !respondedControlCodes.includes(c));

  // Control Tests (real domain function): varied methodology/result.
  const controlTestIdByCode: Record<string, string> = {};
  for (const t of CONTROL_TESTS) {
    const actorId = t.actor === "lead" ? leadUserId : secondUserId;
    const { id } = await withRequestDb(actorId, (db) =>
      createControlTest(db, actorId, {
        assessmentId,
        controlId: controlIdByCode[t.code]!,
        methodology: t.methodology,
        sampleDescription: t.sampleDescription,
        result: t.result,
        testedAt: t.testedAt,
      }),
    );
    controlTestIdByCode[t.code] = id;
  }

  // Re-fetch the assessment detail once more, now that responses exist,
  // to get real AssessmentResponse ids for Evidence linking below.
  detail = await withRequestDb(leadUserId, (db) => getAssessmentDetail(db, leadUserId, assessmentId));
  const responseIdByCode: Record<string, string> = {};
  for (const row of detail.controlRows) {
    if (!row.response) continue;
    const code = Object.keys(controlIdByCode).find((c) => controlIdByCode[c] === row.controlId);
    if (code) responseIdByCode[code] = row.response.id;
  }

  // --- Risks (real domain function — Slice C3) -----------------------------
  const riskIds: Record<string, string> = {};
  const risk1 = await withRequestDb(leadUserId, (db) =>
    createRisk(db, leadUserId, {
      assessmentId,
      controlId: controlIdByCode["CON-02"]!,
      title: "No self-service mechanism for consent withdrawal",
      description: "Customers cannot withdraw consent without contacting support directly, creating friction and delay in honouring withdrawal requests.",
      likelihood: 4,
      impact: 4,
      inherentRating: "high",
      residualLikelihood: 3,
      residualImpact: 3,
      residualRating: "medium",
      assignOwnerToSelf: true,
    }),
  );
  riskIds.consentWithdrawal = risk1.id;

  const risk2 = await withRequestDb(leadUserId, (db) =>
    createRisk(db, leadUserId, {
      assessmentId,
      controlId: controlIdByCode["VEN-01"]!,
      title: "Unmanaged vendor risk — DPAs not executed with two processors",
      description: "Two of four active processors handle personal data without an executed Data Processing Agreement in place.",
      likelihood: 4,
      impact: 5,
      inherentRating: "high",
      residualLikelihood: null,
      residualImpact: null,
      residualRating: null,
      assignOwnerToSelf: true,
    }),
  );
  riskIds.vendorDpaGap = risk2.id;

  const risk3 = await withRequestDb(leadUserId, (db) =>
    createRisk(db, leadUserId, {
      assessmentId,
      controlId: controlIdByCode["SEC-02"]!,
      title: "Unencrypted internal batch feed exposes personal data in transit",
      description: "One internal batch integration transmits personal data without TLS, confirmed by control testing.",
      likelihood: 3,
      impact: 4,
      inherentRating: "high",
      residualLikelihood: 2,
      residualImpact: 3,
      residualRating: "medium",
      assignOwnerToSelf: true,
    }),
  );
  riskIds.unencryptedBatchFeed = risk3.id;
  await withRequestDb(leadUserId, (db) => updateRiskStatus(db, leadUserId, { organisationId, engagementId, riskId: risk3.id, status: "mitigating" }));

  const risk4 = await withRequestDb(leadUserId, (db) =>
    createRisk(db, leadUserId, {
      assessmentId,
      controlId: controlIdByCode["BRE-02"]!,
      title: "No defined regulatory breach-notification timeline or owner",
      description: "The incident response procedure does not specify who notifies the regulator or by when, risking a missed statutory deadline.",
      likelihood: 3,
      impact: 5,
      inherentRating: "critical",
      residualLikelihood: null,
      residualImpact: null,
      residualRating: null,
      assignOwnerToSelf: true,
    }),
  );
  riskIds.breachNotificationGap = risk4.id;

  const risk5 = await withRequestDb(leadUserId, (db) =>
    createRisk(db, leadUserId, {
      assessmentId,
      controlId: controlIdByCode["RET-01"]!,
      title: "Retention schedule incomplete and inconsistently applied",
      description: "The retention schedule omits marketing and HR data categories, and testing found scheduled deletions were not consistently executed.",
      likelihood: 3,
      impact: 3,
      inherentRating: "medium",
      residualLikelihood: 2,
      residualImpact: 2,
      residualRating: "low",
      assignOwnerToSelf: true,
    }),
  );
  riskIds.retentionScheduleGap = risk5.id;
  await withRequestDb(leadUserId, (db) => updateRiskStatus(db, leadUserId, { organisationId, engagementId, riskId: risk5.id, status: "mitigating" }));

  const risk6 = await withRequestDb(leadUserId, (db) =>
    createRisk(db, leadUserId, {
      assessmentId,
      controlId: controlIdByCode["NOT-02"]!,
      title: "Privacy notice grievance-process detail incomplete",
      description: "The privacy notice does not yet describe the grievance redressal process in the level of detail leadership has decided is proportionate for now.",
      likelihood: 2,
      impact: 2,
      inherentRating: "low",
      residualLikelihood: null,
      residualImpact: null,
      residualRating: null,
      assignOwnerToSelf: true,
    }),
  );
  riskIds.noticeDetailGap = risk6.id;
  await withRequestDb(leadUserId, (db) => updateRiskStatus(db, leadUserId, { organisationId, engagementId, riskId: risk6.id, status: "accepted" }));

  // --- Findings (real domain function — Slice C4) --------------------------
  const findingIds: Record<string, string> = {};
  const f1 = await withRequestDb(leadUserId, (db) =>
    createFinding(db, leadUserId, { riskId: riskIds.consentWithdrawal!, title: "No self-service consent withdrawal channel available to customers", description: "Customers must contact support to withdraw consent; no in-app or self-service option exists.", severity: "high", assignOwnerToSelf: true }),
  );
  findingIds.consentWithdrawal = f1.id;

  const f2 = await withRequestDb(leadUserId, (db) =>
    createFinding(db, leadUserId, { riskId: riskIds.vendorDpaGap!, title: "Two active processors operating without an executed Data Processing Agreement", description: "Confirmed by evidence review during control testing.", severity: "high", assignOwnerToSelf: true }),
  );
  findingIds.vendorDpaGap = f2.id;

  const f3 = await withRequestDb(leadUserId, (db) =>
    createFinding(db, leadUserId, { riskId: riskIds.unencryptedBatchFeed!, title: "Personal data transmitted unencrypted via internal batch feed", description: "Confirmed by configuration review during control testing.", severity: "high", assignOwnerToSelf: true }),
  );
  findingIds.unencryptedBatchFeed = f3.id;
  await withRequestDb(leadUserId, (db) => updateFinding(db, leadUserId, { organisationId, engagementId, findingId: f3.id, title: "Personal data transmitted unencrypted via internal batch feed", description: "Confirmed by configuration review during control testing. Remediation underway.", severity: "high", status: "in_progress", ownerAction: "keep" }));

  const f4 = await withRequestDb(leadUserId, (db) =>
    createFinding(db, leadUserId, { riskId: riskIds.breachNotificationGap!, title: "Breach response procedure omits regulatory notification timeline and ownership", description: "No named owner or deadline for regulator/data-principal notification following a confirmed breach.", severity: "critical", assignOwnerToSelf: true }),
  );
  findingIds.breachNotificationGap = f4.id;

  const f5 = await withRequestDb(leadUserId, (db) =>
    createFinding(db, leadUserId, { riskId: riskIds.retentionScheduleGap!, title: "Retention schedule not applied to marketing and HR data categories", description: "Marketing and HR personal data categories are absent from the documented retention schedule.", severity: "medium", assignOwnerToSelf: true }),
  );
  findingIds.retentionScheduleGap = f5.id;
  await withRequestDb(leadUserId, (db) => updateFinding(db, leadUserId, { organisationId, engagementId, findingId: f5.id, title: "Retention schedule not applied to marketing and HR data categories", description: "Marketing and HR personal data categories are absent from the documented retention schedule. Remediation underway.", severity: "medium", status: "in_progress", ownerAction: "keep" }));

  const f6 = await withRequestDb(leadUserId, (db) =>
    createFinding(db, leadUserId, { riskId: riskIds.retentionScheduleGap!, title: "Sampled records show retention-expiry deletion has not been consistently executed", description: "2 of 5 sampled records past their retention period had not yet been deleted at the time of testing.", severity: "medium", assignOwnerToSelf: true }),
  );
  findingIds.deletionNotExecuted = f6.id;

  const f7 = await withRequestDb(leadUserId, (db) =>
    createFinding(db, leadUserId, { riskId: riskIds.noticeDetailGap!, title: "Privacy notice does not yet describe grievance process in adequate detail", description: "Leadership has accepted this gap for the current cycle; to be revisited at the next notice review.", severity: "low", assignOwnerToSelf: true }),
  );
  findingIds.noticeDetailGap = f7.id;
  await withRequestDb(leadUserId, (db) => updateFinding(db, leadUserId, { organisationId, engagementId, findingId: f7.id, title: "Privacy notice does not yet describe grievance process in adequate detail", description: "Leadership has accepted this gap for the current cycle; to be revisited at the next notice review.", severity: "low", status: "accepted", ownerAction: "keep" }));

  // --- Remediation Actions (real domain function — Slice C5) --------------
  const remediationIds: Record<string, string> = {};

  const r1 = await withRequestDb(leadUserId, (db) =>
    createRemediationAction(db, leadUserId, { findingId: findingIds.consentWithdrawal!, title: "Build self-service consent withdrawal option in the customer app", description: "Add a withdrawal action to account settings, wired to the consent-management backend.", priority: "high", dueDate: "2026-12-15", assignOwnerToSelf: true }),
  );
  remediationIds.consentWithdrawalSelfService = r1.id;
  await withRequestDb(leadUserId, (db) => updateRemediationAction(db, leadUserId, { organisationId, engagementId, remediationActionId: r1.id, title: "Build self-service consent withdrawal option in the customer app", description: "Add a withdrawal action to account settings, wired to the consent-management backend. Development in progress.", priority: "high", dueDate: "2026-12-15", status: "in_progress", ownerAction: "keep" }));

  const r2 = await withRequestDb(secondUserId, (db) =>
    createRemediationAction(db, secondUserId, { findingId: findingIds.vendorDpaGap!, title: "Execute Data Processing Agreements with the two outstanding processors", description: "Legal to circulate and countersign the standard DPA template with both processors.", priority: "critical", dueDate: "2026-10-31", assignOwnerToSelf: true }),
  );
  remediationIds.executeOutstandingDpas = r2.id;

  const r3 = await withRequestDb(leadUserId, (db) =>
    createRemediationAction(db, leadUserId, { findingId: findingIds.vendorDpaGap!, title: "Add processor DPA status tracker to the vendor register", description: null, priority: "medium", dueDate: "2027-01-31", assignOwnerToSelf: true }),
  );
  remediationIds.dpaTracker = r3.id;

  const r4 = await withRequestDb(leadUserId, (db) =>
    createRemediationAction(db, leadUserId, { findingId: findingIds.unencryptedBatchFeed!, title: "Enable TLS on the internal batch feed integration", description: "Reconfigure the batch integration endpoint to require TLS 1.2+.", priority: "high", dueDate: "2026-11-30", assignOwnerToSelf: true }),
  );
  remediationIds.enableTlsBatchFeed = r4.id;
  await withRequestDb(leadUserId, (db) => updateRemediationAction(db, leadUserId, { organisationId, engagementId, remediationActionId: r4.id, title: "Enable TLS on the internal batch feed integration", description: "Reconfigure the batch integration endpoint to require TLS 1.2+. Completed and verified.", priority: "high", dueDate: "2026-11-30", status: "closed", ownerAction: "keep" }));

  const r5 = await withRequestDb(secondUserId, (db) =>
    createRemediationAction(db, secondUserId, { findingId: findingIds.breachNotificationGap!, title: "Update incident response procedure with regulatory notification timeline and named owner", description: "Add a notification-timeline table and assign the DPO function as notification owner.", priority: "critical", dueDate: "2026-10-15", assignOwnerToSelf: true }),
  );
  remediationIds.breachProcedureUpdate = r5.id;
  await withRequestDb(secondUserId, (db) => updateRemediationAction(db, secondUserId, { organisationId, engagementId, remediationActionId: r5.id, title: "Update incident response procedure with regulatory notification timeline and named owner", description: "Add a notification-timeline table and assign the DPO function as notification owner. Draft under legal review.", priority: "critical", dueDate: "2026-10-15", status: "in_progress", ownerAction: "keep" }));

  const r6 = await withRequestDb(leadUserId, (db) =>
    createRemediationAction(db, leadUserId, { findingId: findingIds.retentionScheduleGap!, title: "Extend retention schedule to cover marketing and HR data categories", description: null, priority: "medium", dueDate: "2027-02-28", assignOwnerToSelf: true }),
  );
  remediationIds.extendRetentionSchedule = r6.id;

  const r7 = await withRequestDb(leadUserId, (db) =>
    createRemediationAction(db, leadUserId, { findingId: findingIds.deletionNotExecuted!, title: "Run deletion sweep for records past retention expiry and document evidence", description: "Execute the deletion job for the two outstanding records and capture before/after evidence.", priority: "medium", dueDate: "2026-12-31", assignOwnerToSelf: true }),
  );
  remediationIds.deletionSweep = r7.id;
  await withRequestDb(leadUserId, (db) => updateRemediationAction(db, leadUserId, { organisationId, engagementId, remediationActionId: r7.id, title: "Run deletion sweep for records past retention expiry and document evidence", description: "Execute the deletion job for the two outstanding records and capture before/after evidence. Believed complete, pending validation.", priority: "medium", dueDate: "2026-12-31", status: "closed", ownerAction: "keep" }));

  const r8 = await withRequestDb(secondUserId, (db) =>
    createRemediationAction(db, secondUserId, { findingId: findingIds.noticeDetailGap!, title: "Add grievance process summary to the privacy notice", description: null, priority: "low", dueDate: null, assignOwnerToSelf: true }),
  );
  remediationIds.noticeGrievanceSummary = r8.id;

  // --- Validation Records (real domain function — Slice C6) ---------------
  const validationIds: Record<string, string> = {};

  const v1 = await withRequestDb(leadUserId, (db) =>
    createValidationRecord(db, leadUserId, {
      remediationActionId: remediationIds.enableTlsBatchFeed!,
      outcome: "accepted",
      rationale: "Reviewed updated TLS configuration export for the batch feed integration; encryption confirmed in transit for all sampled records.",
    }),
  );
  validationIds.tlsBatchFeedAccepted = v1.id;

  const v2 = await withRequestDb(leadUserId, (db) =>
    createValidationRecord(db, leadUserId, {
      remediationActionId: remediationIds.deletionSweep!,
      outcome: "rejected",
      rationale: "Deletion evidence provided covers only 3 of the 5 previously-sampled records; 2 records past retention remain in the data store. Remediation action reopened.",
    }),
  );
  validationIds.deletionSweepRejected = v2.id;
  // A rejected validation is a real, common outcome — the RemediationAction
  // itself is manually reopened as a separate, explicit action (never
  // automatic — this codebase's own documented posture, DECISIONS.md),
  // matching the demo's own realism.
  await withRequestDb(leadUserId, (db) =>
    updateRemediationAction(db, leadUserId, {
      organisationId,
      engagementId,
      remediationActionId: remediationIds.deletionSweep!,
      title: "Run deletion sweep for records past retention expiry and document evidence",
      description: "Execute the deletion job for the two outstanding records and capture before/after evidence. Validation rejected — 2 records remain undeleted; reopened.",
      priority: "medium",
      dueDate: "2026-12-31",
      status: "in_progress",
      ownerAction: "keep",
    }),
  );

  // --- Evidence (real domain function — Slice C2) ---------------------------
  // Exercises all four EvidenceLink subject types this application
  // supports: assessment_response, control_test, remediation_action,
  // validation_record.
  const evidenceIds: Record<string, string> = {};

  const e1 = await withRequestDb(leadUserId, (db) =>
    uploadEvidence(db, leadUserId, {
      organisationId,
      engagementId,
      title: "Privacy Notice — Customer App (SAMPLE)",
      evidenceType: "policy_document",
      linkTo: { type: "assessment_response", assessmentResponseId: responseIdByCode["NOT-01"]! },
      file: syntheticFile("Privacy Notice — Customer App"),
    }),
  );
  evidenceIds.privacyNotice = e1.evidenceId;

  const e2 = await withRequestDb(leadUserId, (db) =>
    uploadEvidence(db, leadUserId, {
      organisationId,
      engagementId,
      title: "Consent Capture Flow — Screenshot (SAMPLE)",
      evidenceType: "screenshot",
      linkTo: { type: "assessment_response", assessmentResponseId: responseIdByCode["CON-01"]! },
      file: syntheticFile("Consent Capture Flow Screenshot"),
    }),
  );
  evidenceIds.consentScreenshot = e2.evidenceId;

  const e3 = await withRequestDb(secondUserId, (db) =>
    uploadEvidence(db, secondUserId, {
      organisationId,
      engagementId,
      title: "Access Control Group Membership Export (SAMPLE)",
      evidenceType: "system_configuration_export",
      linkTo: { type: "control_test", controlTestId: controlTestIdByCode["SEC-01"]! },
      file: syntheticFile("Access Control Group Membership Export"),
    }),
  );
  evidenceIds.accessControlExport = e3.evidenceId;

  const e4 = await withRequestDb(leadUserId, (db) =>
    uploadEvidence(db, leadUserId, {
      organisationId,
      engagementId,
      title: "Vendor DPA Status Summary (SAMPLE)",
      evidenceType: "other",
      linkTo: { type: "control_test", controlTestId: controlTestIdByCode["VEN-01"]! },
      file: syntheticFile("Vendor DPA Status Summary"),
    }),
  );
  evidenceIds.vendorDpaSummary = e4.evidenceId;

  const e5 = await withRequestDb(leadUserId, (db) =>
    uploadEvidence(db, leadUserId, {
      organisationId,
      engagementId,
      title: "Incident Response Procedure v1 (SAMPLE)",
      evidenceType: "policy_document",
      linkTo: { type: "assessment_response", assessmentResponseId: responseIdByCode["BRE-01"]! },
      file: syntheticFile("Incident Response Procedure v1"),
    }),
  );
  evidenceIds.incidentResponseProcedure = e5.evidenceId;

  const e6 = await withRequestDb(leadUserId, (db) =>
    uploadEvidence(db, leadUserId, {
      organisationId,
      engagementId,
      title: "TLS Configuration Export — Batch Feed, Post-Remediation (SAMPLE)",
      evidenceType: "system_configuration_export",
      linkTo: { type: "remediation_action", remediationActionId: remediationIds.enableTlsBatchFeed! },
      file: syntheticFile("TLS Configuration Export — Batch Feed Post-Remediation"),
    }),
  );
  evidenceIds.tlsConfigExport = e6.evidenceId;

  const e7 = await withRequestDb(leadUserId, (db) =>
    uploadEvidence(db, leadUserId, {
      organisationId,
      engagementId,
      title: "Deletion Sweep Log, Partial (SAMPLE)",
      evidenceType: "other",
      linkTo: { type: "remediation_action", remediationActionId: remediationIds.deletionSweep! },
      file: syntheticFile("Deletion Sweep Log Partial"),
    }),
  );
  evidenceIds.deletionSweepLog = e7.evidenceId;

  const e8 = await withRequestDb(leadUserId, (db) =>
    uploadEvidence(db, leadUserId, {
      organisationId,
      engagementId,
      title: "Retention Schedule Extract (SAMPLE)",
      evidenceType: "policy_document",
      linkTo: { type: "assessment_response", assessmentResponseId: responseIdByCode["RET-01"]! },
      file: syntheticFile("Retention Schedule Extract"),
    }),
  );
  evidenceIds.retentionScheduleExtract = e8.evidenceId;

  const e9 = await withRequestDb(leadUserId, (db) =>
    uploadEvidence(db, leadUserId, {
      organisationId,
      engagementId,
      title: "Validation Note — TLS Confirmation (SAMPLE)",
      evidenceType: "other",
      linkTo: { type: "validation_record", validationRecordId: validationIds.tlsBatchFeedAccepted! },
      file: syntheticFile("Validation Note — TLS Confirmation"),
    }),
  );
  evidenceIds.tlsValidationNote = e9.evidenceId;

  return {
    tenantId,
    organisationId,
    organisationName,
    engagementId,
    engagementName,
    controlLibraryVersionId,
    assessmentId,
    leadUserId,
    secondUserId,
    controlIdByCode,
    processingActivityIds,
    riskIds,
    findingIds,
    remediationIds,
    validationIds,
    evidenceIds,
    respondedControlCodes,
    unrespondedControlCodes,
    controlTestCodes: CONTROL_TESTS.map((t) => t.code),
  };
}
