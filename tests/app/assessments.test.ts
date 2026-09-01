// PHASE A instructions §21 (Application): Organisations page,
// organisation detail, engagement detail, Assessment page,
// AssessmentResponse update, audit attribution, error states. Tests the
// actual functions the real pages/Server Action call
// (lib/domain/*.ts) — not a separate, parallel test-only implementation
// — against real PostgreSQL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { listAccessibleOrganisations, getOrganisationDetail } from "@/lib/domain/organisations";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { getAssessmentDetail, updateAssessmentResponse } from "@/lib/domain/assessments";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import {
  addAssessmentControl,
  asFixtureSetup,
  createAssessment,
  createControl,
  createControlLibraryVersion,
  createEngagement,
  createOrganisation,
  createTenant,
  createUser,
  grantOrganisationMembership,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Application layer — Organisations / Engagement / Assessment (Slice A1)", () => {
  let tenant: string, org: string, engagement: string;
  let library: string, control: string;
  let assessment: string, assessmentControl: string;
  let user: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Slice A1 App Tenant");
      org = await createOrganisation(client, tenant, "Slice A1 App Client");
      engagement = await createEngagement(client, tenant, org, "Slice A1 App Engagement");

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Slice A1 App Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C1", title: "Slice A1 app control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      assessment = await createAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026" });
      assessmentControl = await addAssessmentControl(client, { assessmentId: assessment, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });

      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("Organisations page: listAccessibleOrganisations returns the real organisation for an authorized user", async () => {
    const result = await withRequestDb(user, (db) => listAccessibleOrganisations(db));
    expect(result.some((o) => o.id === org && o.name === "Slice A1 App Client")).toBe(true);
  });

  it("Organisation detail: getOrganisationDetail returns real data including the engagement list", async () => {
    const detail = await withRequestDb(user, (db) => getOrganisationDetail(db, user, org));
    expect(detail).toMatchObject({ id: org, name: "Slice A1 App Client" });
    expect(detail.engagements.some((e) => e.id === engagement)).toBe(true);
  });

  it("Organisation detail error state: a nonexistent organisation id resolves to NotFoundOrForbiddenError", async () => {
    await expect(
      withRequestDb(user, (db) => getOrganisationDetail(db, user, "00000000-0000-0000-0000-000000000000")),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("Engagement detail: getEngagementDetail returns real data including the assessment list and control library label", async () => {
    const detail = await withRequestDb(user, (db) => getEngagementDetail(db, user, engagement));
    expect(detail).toMatchObject({
      id: engagement,
      organisationId: org,
      organisationName: "Slice A1 App Client",
      controlLibraryVersionLabel: "Slice A1 App Library",
    });
    expect(detail.assessments.some((a) => a.id === assessment)).toBe(true);
  });

  it("Engagement detail error state: an engagement id that doesn't exist resolves to NotFoundOrForbiddenError", async () => {
    await expect(
      withRequestDb(user, (db) => getEngagementDetail(db, user, "00000000-0000-0000-0000-000000000000")),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("Assessment page: getAssessmentDetail returns the control grid with the Control's own name and no response yet", async () => {
    const detail = await withRequestDb(user, (db) => getAssessmentDetail(db, user, assessment));
    expect(detail).toMatchObject({ id: assessment, periodLabel: "FY2026", status: "draft" });
    const row = detail.controlRows.find((r) => r.assessmentControlId === assessmentControl);
    expect(row).toMatchObject({ controlCode: "C1", controlTitle: "Slice A1 app control", response: null });
  });

  it("AssessmentResponse update: an authorized consultant can record a response, then read it back", async () => {
    await withRequestDb(user, (db) =>
      updateAssessmentResponse(db, user, {
        assessmentControlId: assessmentControl,
        effectivenessRating: "implemented",
        decisionRationale: "Verified via walkthrough.",
      }),
    );

    const detail = await withRequestDb(user, (db) => getAssessmentDetail(db, user, assessment));
    const row = detail.controlRows.find((r) => r.assessmentControlId === assessmentControl);
    expect(row?.response).toMatchObject({
      effectivenessRating: "implemented",
      decisionRationale: "Verified via walkthrough.",
    });
  });

  it("AssessmentResponse update is idempotent-by-control: a second update to the same control edits the same row, not a duplicate", async () => {
    await withRequestDb(user, (db) =>
      updateAssessmentResponse(db, user, {
        assessmentControlId: assessmentControl,
        effectivenessRating: "partially_implemented",
        decisionRationale: "Revised after follow-up.",
      }),
    );

    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT effectiveness_rating, decision_rationale FROM assessment_responses WHERE assessment_control_id = $1", [assessmentControl]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ effectiveness_rating: "partially_implemented", decision_rationale: "Revised after follow-up." });
  });

  it("Audit attribution: the response update is recorded in audit_log, attributed to the acting user", async () => {
    const { rows } = await asUserAuditQuery(user, assessmentControl);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.actor_user_id === user)).toBe(true);
    expect(rows[0]!.entity_type).toBe("assessment_responses");
  });
});

async function asUserAuditQuery(userId: string, assessmentControlId: string) {
  return withRequestDb(userId, (_db, client) =>
    client.query(
      `SELECT ar.field_changes, ar.actor_user_id, ar.entity_type
       FROM audit_log ar
       JOIN assessment_responses r ON r.id = ar.entity_id
       WHERE ar.entity_type = 'assessment_responses' AND r.assessment_control_id = $1
       ORDER BY ar.occurred_at`,
      [assessmentControlId],
    ),
  );
}
