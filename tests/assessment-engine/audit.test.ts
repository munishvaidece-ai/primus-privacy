// Milestone 5 instructions §16: assessment creation, status transitions,
// control inclusion, response changes, rationale changes, test
// creation/modification, and finalization must all be auditable.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAssessmentControl,
  asFixtureSetup,
  asUser,
  createAssessment,
  createAssessmentResponse,
  createControl,
  createControlLibraryVersion,
  createControlTest,
  createEngagement,
  createOrganisation,
  createTenant,
  createUser,
  finalizeAssessment,
  grantOrganisationMembership,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Assessment Engine auditability", () => {
  let tenant: string, org: string, engagement: string, library: string, control: string, user: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Assessment audit test tenant");
      org = await createOrganisation(client, tenant, "Assessment audit test org");
      engagement = await createEngagement(client, tenant, org, "Assessment audit test engagement");
      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Assessment Audit Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "AUD1", title: "Audit test control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function latestAuditEntries(entityType: string, entityId: string) {
    const rows = await asUser(user, (c) =>
      c.query(
        `SELECT action, entity_type, entity_id, actor_user_id, field_changes
         FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY occurred_at`,
        [entityType, entityId],
      ),
    );
    return rows.rows;
  }

  it("Assessment creation and status transition (finalization) are both audited", async () => {
    const id = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "Audit Trail Assessment" }));
    await asFixtureSetup((c) => finalizeAssessment(c, id));

    const entries = await latestAuditEntries("assessments", id);
    expect(entries.map((e) => e.action)).toEqual(["insert", "update"]);
    expect(entries[0]!.field_changes.period_label).toBe("Audit Trail Assessment");
    expect(entries[1]!.field_changes.new.status).toBe("finalized");
  });

  it("control inclusion (AssessmentControl) is audited as an insert event", async () => {
    const assessment = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "AC Audit Assessment" }));
    const acId = await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: assessment, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library }));

    const entries = await latestAuditEntries("assessment_controls", acId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "insert" });
    expect(entries[0]!.field_changes.control_id).toBe(control);
  });

  it("response changes and rationale changes are audited as update events", async () => {
    const assessment = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "Response Audit Assessment" }));
    const acId = await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: assessment, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library }));
    const responseId = await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acId, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "not_implemented" }));
    await asFixtureSetup((c) => c.query(`UPDATE assessment_responses SET effectiveness_rating = 'partially_implemented', decision_rationale = 'Updated rationale' WHERE id = $1`, [responseId]));

    const entries = await latestAuditEntries("assessment_responses", responseId);
    expect(entries.map((e) => e.action)).toEqual(["insert", "update"]);
    expect(entries[1]!.field_changes.new.effectiveness_rating).toBe("partially_implemented");
    expect(entries[1]!.field_changes.new.decision_rationale).toBe("Updated rationale");
  });

  it("ControlTest creation and modification are both audited", async () => {
    const testId = await asFixtureSetup((c) => createControlTest(c, { controlId: control, tenantId: tenant, methodology: "Original methodology", result: "pass" }));
    await asFixtureSetup((c) => c.query(`UPDATE control_tests SET result = 'exception_noted' WHERE id = $1`, [testId]));

    const entries = await latestAuditEntries("control_tests", testId);
    expect(entries.map((e) => e.action)).toEqual(["insert", "update"]);
    expect(entries[0]!.field_changes.methodology).toBe("Original methodology");
    expect(entries[1]!.field_changes.new.result).toBe("exception_noted");
  });

  it("every audit entry is correctly attributed to the acting user via auth.uid()", async () => {
    const committedId = await (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE authenticated");
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user]);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO assessments (engagement_id, organisation_id, tenant_id, control_library_version_id, assessment_type, period_label)
           VALUES ($1, $2, $3, $4, 'control_readiness', 'Attribution Check') RETURNING id`,
          [engagement, org, tenant, library],
        );
        await client.query("COMMIT");
        return rows[0]!.id;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    })();

    const entries = await latestAuditEntries("assessments", committedId);
    expect(entries[0]!.actor_user_id).toBe(user);
  });
});
