// PHASE A instructions §21 (Authorization) — the six required scenarios,
// run against real PostgreSQL, exercising the actual application-layer
// authorization service (lib/authorization/service.ts) and domain
// functions (lib/domain/*.ts), never a mocked permission function.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  canAccessOrganisation,
  canAccessEngagement,
  NotFoundOrForbiddenError,
} from "@/lib/authorization/service";
import { getOrganisationDetail } from "@/lib/domain/organisations";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { updateAssessmentResponse, AssessmentFinalizedError } from "@/lib/domain/assessments";
import {
  addAssessmentControl,
  asFixtureSetup,
  createAssessment,
  createAssessmentResponse,
  createControl,
  createControlLibraryVersion,
  createEngagement,
  createOrganisation,
  createTenant,
  createUser,
  finalizeAssessment,
  grantEngagementMembership,
  grantOrganisationMembership,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Application-layer authorization (Slice A1)", () => {
  let tenantA: string, tenantB: string;
  let orgA1: string, orgA2: string, orgB: string;
  let engagementA1: string, engagementA2: string, engagementB: string;
  let libraryA: string, controlA: string, controlA2: string;
  let assessmentA1: string, assessmentControlA1: string;

  let userA1: string; // member of orgA1 only
  let outsiderUser: string; // no membership anywhere

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice A1 Auth Tenant A");
      tenantB = await createTenant(client, "Slice A1 Auth Tenant B");
      orgA1 = await createOrganisation(client, tenantA, "Slice A1 Org A1");
      orgA2 = await createOrganisation(client, tenantA, "Slice A1 Org A2");
      orgB = await createOrganisation(client, tenantB, "Slice A1 Org B");

      engagementA1 = await createEngagement(client, tenantA, orgA1, "Slice A1 Engagement A1");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Slice A1 Engagement A2");
      engagementB = await createEngagement(client, tenantB, orgB, "Slice A1 Engagement B");

      libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice A1 Library" });
      controlA = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C1", title: "Slice A1 control" });
      // Created before publishing — Milestone 4's rule blocks inserting
      // new Controls into an already-published library version, and
      // test 6 below needs a second control after the library is
      // published.
      controlA2 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C2", title: "Slice A1 control 2" });
      await publishControlLibraryVersion(client, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA1, libraryA);

      assessmentA1 = await createAssessment(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026" });
      assessmentControlA1 = await addAssessmentControl(client, { assessmentId: assessmentA1, controlId: controlA, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, controlLibraryVersionId: libraryA });

      userA1 = await createUser(client, { tenantId: tenantA, clientOrgId: orgA1 });
      await grantOrganisationMembership(client, userA1, orgA1);

      outsiderUser = await createUser(client, { tenantId: tenantA });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // (1) Tenant A user cannot access Tenant B's organisation.
  it("1. a Tenant A user cannot access Tenant B's organisation", async () => {
    await withRequestDb(userA1, async (db) => {
      expect(await canAccessOrganisation(db, userA1, orgB)).toBe(false);
    });
    await expect(
      withRequestDb(userA1, (db) => getOrganisationDetail(db, userA1, orgB)),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // (2) Tenant A user cannot access Tenant B's engagement.
  it("2. a Tenant A user cannot access Tenant B's engagement", async () => {
    await withRequestDb(userA1, async (db) => {
      expect(await canAccessEngagement(db, userA1, engagementB, orgB)).toBe(false);
    });
    await expect(
      withRequestDb(userA1, (db) => getEngagementDetail(db, userA1, engagementB)),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // (3) Organisation A user cannot access Organisation B's engagement (same tenant).
  it("3. an Organisation A1 user cannot access Organisation A2's engagement, even under the same tenant", async () => {
    await withRequestDb(userA1, async (db) => {
      expect(await canAccessEngagement(db, userA1, engagementA2, orgA2)).toBe(false);
    });
    await expect(
      withRequestDb(userA1, (db) => getEngagementDetail(db, userA1, engagementA2)),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // (4) User without engagement access cannot update AssessmentResponse.
  it("4. a user without access to this engagement cannot update its AssessmentResponse", async () => {
    await expect(
      withRequestDb(outsiderUser, (db) =>
        updateAssessmentResponse(db, outsiderUser, {
          assessmentControlId: assessmentControlA1,
          effectivenessRating: "implemented",
          decisionRationale: "Attempted by an unauthorized user.",
        }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);

    // Confirm nothing was actually written.
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT id FROM assessment_responses WHERE assessment_control_id = $1", [assessmentControlA1]),
    );
    expect(rows).toHaveLength(0);
  });

  // (5) Finalized AssessmentResponse cannot be mutated.
  it("5. a finalized assessment's response cannot be mutated, by an otherwise-authorized user", async () => {
    // First, a legitimate response while still draft.
    await withRequestDb(userA1, (db) =>
      updateAssessmentResponse(db, userA1, {
        assessmentControlId: assessmentControlA1,
        effectivenessRating: "partially_implemented",
        decisionRationale: "Initial response.",
      }),
    );

    await asFixtureSetup((c) => finalizeAssessment(c, assessmentA1));

    await expect(
      withRequestDb(userA1, (db) =>
        updateAssessmentResponse(db, userA1, {
          assessmentControlId: assessmentControlA1,
          effectivenessRating: "implemented",
          decisionRationale: "Attempted after finalization.",
        }),
      ),
    ).rejects.toThrow(AssessmentFinalizedError);

    // The response is exactly what it was before the finalized attempt.
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT effectiveness_rating FROM assessment_responses WHERE assessment_control_id = $1", [assessmentControlA1]),
    );
    expect(rows[0]!.effectiveness_rating).toBe("partially_implemented");
  });

  // (6) Direct malicious request cannot bypass authorization — proves
  // the database (RLS) is a real, independent backstop, not merely
  // trusted because the application layer above it happens to check
  // first. Bypasses lib/domain/assessments.ts entirely and issues the
  // same raw INSERT it would run, directly, as an unauthorized user.
  it("6. a direct request that skips the application authorization layer is still rejected by RLS", async () => {
    // A fresh, still-draft Assessment/AssessmentControl pair (assessmentA1
    // itself is finalized by test 5 above; using a separate one here
    // isolates this check to RLS's own tenant/engagement scoping, not
    // the finalization trigger, which fires first and would otherwise
    // mask which mechanism actually rejected the write).
    const freshAssessment = await asFixtureSetup((c) =>
      createAssessment(c, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2027 (RLS bypass check)" }),
    );
    const secondAssessmentControl = await asFixtureSetup((c) =>
      addAssessmentControl(c, { assessmentId: freshAssessment, controlId: controlA2, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, controlLibraryVersionId: libraryA }),
    );

    await expect(
      withRequestDb(outsiderUser, (db, client) =>
        client.query(
          `INSERT INTO assessment_responses (assessment_control_id, tenant_id, organisation_id, engagement_id, effectiveness_rating)
           VALUES ($1, $2, $3, $4, 'implemented')`,
          [secondAssessmentControl, tenantA, orgA1, engagementA1],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
