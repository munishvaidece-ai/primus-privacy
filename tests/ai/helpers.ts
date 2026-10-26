// Fixture builder for the AI layer tests: a tenant with an Engagement
// Manager, a Consultant, the provisioned AI agent user, a small control
// library, an assessment and scope, ready for the autopilot to work on.
import { randomUUID } from "node:crypto";
import {
  asFixtureSetup,
  createTenant,
  createOrganisation,
  createEngagement,
  createUser,
  grantEngagementMembership,
  createControlLibraryVersion,
  publishControlLibraryVersion,
  createControl,
  pinEngagementControlLibraryVersion,
  createAssessment,
  addAssessmentControl,
  createAssessmentResponse,
  createRiskScoringModel,
} from "../app/helpers";

export const CONTROL_DEFS = [
  {
    key: "breach",
    code: "BR-1",
    title: "Personal data breach detection and notification",
    description: "Procedure to detect, contain, assess and notify the Data Protection Board and affected data principals of a personal data breach within the required time.",
  },
  {
    key: "policy",
    code: "PP-1",
    title: "Privacy policy governance",
    description: "A written privacy policy approved by management, with a named owner, a version number and a review date.",
  },
  {
    key: "training",
    code: "TR-1",
    title: "Staff privacy awareness training",
    description: "All staff complete annual privacy awareness training and attendance is recorded.",
  },
  {
    key: "retention",
    code: "RT-1",
    title: "Data retention and erasure schedule",
    description: "A retention schedule defines how long each category of personal data is kept and when it is erased.",
  },
] as const;

export interface AiFixture {
  tenantId: string;
  organisationId: string;
  engagementId: string;
  libraryId: string;
  assessmentId: string;
  emId: string;
  consultantId: string;
  agentId: string;
  controlIds: Record<string, string>;
  assessmentControlIds: Record<string, string>;
  responseIds: Record<string, string>;
}

export async function buildAiFixture(label: string): Promise<AiFixture> {
  const f = {} as AiFixture;
  f.controlIds = {};
  f.assessmentControlIds = {};
  f.responseIds = {};
  await asFixtureSetup(async (client) => {
    f.tenantId = await createTenant(client, `${label} Tenant`);
    f.organisationId = await createOrganisation(client, f.tenantId, `${label} Org`);
    f.engagementId = await createEngagement(client, f.tenantId, f.organisationId, `${label} Engagement`);
    await createRiskScoringModel(client, { tenantId: f.tenantId, name: "Test matrix", version: "v1", matrixDefinition: { scale: "1-5" }, isActive: true });
    f.libraryId = await createControlLibraryVersion(client, { tenantId: f.tenantId, versionLabel: `${label} Library` });
    for (const c of CONTROL_DEFS) {
      f.controlIds[c.key] = await createControl(client, {
        tenantId: f.tenantId,
        controlLibraryVersionId: f.libraryId,
        code: c.code,
        title: c.title,
        description: c.description,
      });
    }
    await publishControlLibraryVersion(client, f.libraryId);
    await pinEngagementControlLibraryVersion(client, f.engagementId, f.libraryId);
    f.assessmentId = await createAssessment(client, {
      engagementId: f.engagementId,
      organisationId: f.organisationId,
      tenantId: f.tenantId,
      controlLibraryVersionId: f.libraryId,
      periodLabel: "FY2026",
    });
    f.emId = await createUser(client, { tenantId: f.tenantId });
    f.consultantId = await createUser(client, { tenantId: f.tenantId });
    await grantEngagementMembership(client, f.emId, f.engagementId, "Engagement Manager");
    await grantEngagementMembership(client, f.consultantId, f.engagementId, "Consultant");
    // The AI agent, exactly as scripts/provision-ai-agent.ts creates it.
    f.agentId = await createUser(client, { tenantId: f.tenantId, email: `ai-agent@${f.tenantId}.agent.primus.invalid` });
    for (const c of CONTROL_DEFS) {
      f.assessmentControlIds[c.key] = await addAssessmentControl(client, {
        assessmentId: f.assessmentId,
        controlId: f.controlIds[c.key]!,
        tenantId: f.tenantId,
        organisationId: f.organisationId,
        engagementId: f.engagementId,
        controlLibraryVersionId: f.libraryId,
      });
      f.responseIds[c.key] = await createAssessmentResponse(client, {
        assessmentControlId: f.assessmentControlIds[c.key]!,
        tenantId: f.tenantId,
        organisationId: f.organisationId,
        engagementId: f.engagementId,
        effectivenessRating: "not_assessed",
        respondentId: f.emId,
      });
    }
  });
  return f;
}

export const GOOD_POLICY_TEXT = `Privacy Policy
Version 2.1. Effective from 1 April 2026. Last reviewed 15 March 2026. Next review 15 March 2027.
Approved by the Board of Directors and signed by the Chief Executive Officer.
Owner: the Data Protection Officer is accountable for this privacy policy and responsible for keeping it current.
Scope: this privacy policy applies to all employees, contractors and systems that process personal data.
Governance: management reviews the privacy policy annually; every change is recorded with a new version number and review date.
The written privacy policy sets out how personal data is collected, used, retained and protected, and who within management is accountable.`;

const MENU = `Canteen menu for the week. Monday: vegetable biryani, dal tadka, curd rice, fresh fruit. Tuesday: rajma chawal, paneer butter masala, jeera rice, salad. Wednesday: chole bhature, aloo gobi, raita, sweet. Thursday: sambar rice, poriyal, papad, buttermilk. Friday: veg pulao, mixed dal, roti, kheer. Please return trays to the counter after lunch. The cafeteria is open from noon to three.`;
export const JUNK_TEXT = Array.from({ length: 5 }, (_, i) => `${MENU} (week ${i + 1})`).join("\n\n");

export const newId = () => randomUUID();
