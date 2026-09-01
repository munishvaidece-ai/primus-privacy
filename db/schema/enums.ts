import { pgEnum } from "drizzle-orm/pg-core";

// Shared enums for Milestone 1 (Identity + Tenancy + Engagement Structure).
// Kept small and explicit per DATA_MODEL.md's "explicit status
// fields/enums where justified" — not a placeholder for every conceivable
// future state.

export const tenantStatusEnum = pgEnum("tenant_status", ["active", "suspended"]);

export const organisationStatusEnum = pgEnum("organisation_status", [
  "active",
  "suspended",
  "offboarded",
]);

// Matches DATA_MODEL.md §3's engagement_type enum.
export const engagementTypeEnum = pgEnum("engagement_type", [
  "readiness",
  "annual_assessment",
  "dpia_programme",
  "third_party_assessment",
  "continuous_compliance",
]);

export const engagementStatusEnum = pgEnum("engagement_status", [
  "draft",
  "active",
  "closed",
]);

export const userStatusEnum = pgEnum("user_status", ["active", "suspended"]);

// Matches DATA_MODEL.md §2's three membership scopes.
export const roleScopeEnum = pgEnum("role_scope", [
  "tenant",
  "organisation",
  "engagement",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "active",
  "revoked",
]);

export const auditActionEnum = pgEnum("audit_action", [
  "insert",
  "update",
  "delete",
]);

// --- Milestone 2 (Client Master Data, DATA_MODEL.md §5.1) ------------------

// Shared by all seven master-data identity tables. "Retired" is the only
// deactivation state this milestone needs — master data is never hard
// deleted (DATA_MODEL.md §5.1: "never deleted, only retired").
export const masterDataStatusEnum = pgEnum("master_data_status", [
  "active",
  "retired",
]);

// PersonalDataElementVersion.sensitivity_category. DATA_MODEL.md §5.1
// names the field without fixing its values; this is an engineering
// judgment call (PROGRESS.md), not a DPDP legal classification — a
// consultant can still record a more specific legal basis elsewhere
// later without this enum needing to model it.
export const dataSensitivityEnum = pgEnum("data_sensitivity", [
  "general",
  "sensitive",
  "critical",
]);
