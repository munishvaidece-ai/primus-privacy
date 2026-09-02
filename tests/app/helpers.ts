// Test harness for the Slice A1 application layer (PHASE A instructions
// §21). Points the application's own `lib/db/request-client.ts` pool at
// the same reset-per-run test database every other suite uses
// (`TEST_DATABASE_SUPERUSER_URL`) — `withRequestDb`'s pool is created
// lazily on first use, so setting `DATABASE_URL` here, before any
// `withRequestDb` call, is enough; no separate test-only connection
// mechanism is introduced. Re-exports the existing fixture builders
// (Milestones 1/4/5) unchanged, per this project's own established
// convention.
process.env.DATABASE_URL = process.env.TEST_DATABASE_SUPERUSER_URL ?? "postgres://postgres:postgres@localhost:5432/primus_privacy_test";

export {
  pool,
  asUser,
  asAnon,
  asFixtureSetup,
  createTenant,
  createOrganisation,
  createEngagement,
  createUser,
  grantTenantMembership,
  grantOrganisationMembership,
  grantEngagementMembership,
} from "../rls/helpers";

export {
  createControlLibraryVersion,
  publishControlLibraryVersion,
  retireControlLibraryVersion,
  createControl,
  createRegulatoryReference,
  createRequirement,
  linkControlRequirement,
} from "../control-library/helpers";

export {
  pinEngagementControlLibraryVersion,
  createAssessment,
  finalizeAssessment,
  addAssessmentControl,
  createAssessmentResponse,
  createControlTest,
} from "../assessment-engine/helpers";

// Slice C3 — raw-SQL fixture builders only, used to set up scenarios the
// real application code (lib/domain/risks.ts) doesn't itself create
// (e.g. a second RiskScoringModel version, or a forged cross-tenant
// row for a security test) — aliased to avoid colliding with
// lib/domain/risks.ts's own `createRisk` domain function, which the
// C3 test file imports separately and exercises directly.
export {
  createRiskScoringModel,
  createRisk as createRiskFixture,
  linkRiskControl,
} from "../risk-remediation/helpers";

// M2 (Maturity Implementation) — raw-SQL fixture builders only.
// MaturityScoringMethodology/MaturityDomain/MaturityDomainWeight/
// MaturityDomainControlMapping have no real domain-layer "create"
// function anywhere in this codebase (methodology authoring / domain
// taxonomy UI is explicitly out of scope, M2 approval §31 — the same
// "practice content configured directly in the database for now"
// posture RiskScoringModel already has). `createMaturityAssessment`/
// `createMaturityScore`/`finalizeMaturityAssessment` are aliased (never
// used to build a legitimate result — that's what `lib/domain/
// maturity.ts`'s own `computeAndFinalizeMaturityAssessment` is exercised
// for) — only to construct negative-path scenarios the real domain
// function itself would never produce (a forged pre-existing
// MaturityAssessment, a direct-SQL immutability probe).
export {
  createMaturityScoringMethodology,
  createMaturityDomain,
  createMaturityDomainWeight,
  linkMaturityDomainControl,
  createMaturityAssessment as createMaturityAssessmentFixture,
  createMaturityScore as createMaturityScoreFixture,
  finalizeMaturityAssessment as finalizeMaturityAssessmentFixture,
} from "../maturity/helpers";
