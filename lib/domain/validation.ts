import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { remediationActions, validationRecords, users } from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess, requireValidationPerformAccess, canReviewEvidence } from "@/lib/authorization/service";
import { getEvidenceSummaryForValidationRecord, type EvidenceSummaryRow } from "@/lib/domain/evidence";

// Slice C6 (PHASE C — VALIDATION) — the Validation domain module: turns
// an existing RemediationAction into an explicit, auditable
// ValidationRecord, using the EXACT existing ValidationRecord model
// built (database-only) in Milestone 7 (migrations 0012/0013), hardened
// for validator tenant-scoping in migration 0023 (mirroring Slices
// C3.1/C4/C5's identical `risks.owner_id`/`findings.owner_id`/
// `remediation_actions.owner_id` fix — see DECISIONS.md R-107). No
// schema redesign.
//
// This module deliberately does NOT touch `remediation_actions.status`
// anywhere (instructions §11/§29): direct inspection of migration 0013
// found no trigger connecting `validation_records` writes to
// `remediation_actions.status` — the definitive evidence that a status
// transition here would be an invented rule, not one this schema
// actually enforces. A consultant who wants to reflect a validation
// outcome in the RemediationAction's own status does so as a separate,
// explicit action via the existing (Slice C5) `updateRemediationAction`.
// See DECISIONS.md for the full reasoning.
//
// Multiple ValidationRecords per RemediationAction are normal, not an
// error (instructions §6/§27) — nothing in the schema limits a
// RemediationAction to one ValidationRecord, and PRODUCT_UX_BLUEPRINT.md
// itself frames correction as "record a new validation," never "edit
// the existing one." `listValidationRecordsForRemediation` therefore
// always returns the FULL history, most recent first, never just the
// latest.

export class ValidationRationaleRequiredError extends Error {
  constructor(message = "A rationale is required when rejecting a validation.") {
    super(message);
    this.name = "ValidationRationaleRequiredError";
  }
}

export class InvalidValidationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidValidationInputError";
  }
}

const OUTCOME_VALUES = ["accepted", "rejected"] as const;
type OutcomeValue = (typeof OUTCOME_VALUES)[number];

export interface CreateValidationRecordInput {
  remediationActionId: string;
  outcome: OutcomeValue;
  rationale: string | null;
}

/**
 * Creates a ValidationRecord from an existing RemediationAction
 * (instructions §4): Remediation → Create Validation → authenticate →
 * authorize → validate → persist → audit → show Validation. Mirrors
 * `createFinding`/`createRemediationAction`'s exact shape:
 * `remediationActionId` identifies the source context only; tenant/
 * organisation/engagement scope is always re-derived from the
 * RemediationAction's own authoritative row, never trusted from the
 * caller (instructions §4/§10).
 *
 * `outcome` accepts only the two existing `validation_outcome` enum
 * values — no invented "partially validated"/"needs more evidence"
 * state (instructions §7). Rejecting without a rationale is refused
 * server-side, reusing the exact precedent `reviewEvidence`
 * (`ReviewRationaleRequiredError`, Slice C2) already established for
 * this project's identical "rejection needs a reason" UX rule
 * (instructions §13's "rationale" field).
 *
 * `validatedBy` is always the acting user's own id — never an
 * assignable/caller-supplied target (instructions §8: "preserve
 * self-validation-only if that's what exists" — the same self-only
 * pattern `respondentId`/`testerId`/`ownerUserId` already use
 * throughout this codebase). Migration 0023 makes this a
 * database-enforced guarantee too
 * (`validation_records_validated_by_tenant_fk`).
 *
 * Deliberately does NOT set `triggers_control_test_id`/
 * `triggers_assessment_response_id` — those reassessment-trigger
 * columns are a separate, later, explicit action
 * (PRODUCT_UX_BLUEPRINT.md row #16: "later link reassessment"), out of
 * scope for this slice (instructions §12 — no invented auto-reopen/
 * cascade).
 *
 * Not blocked by Assessment finalization (instructions §22): a
 * ValidationRecord has no Assessment relationship at all (it attaches
 * only to a RemediationAction), so finalization is structurally not
 * applicable here — mirrors `resolveLinkSubject`'s identical
 * `remediation_action` conclusion in lib/domain/evidence.ts.
 *
 * **P2A (Authorization & Confidentiality Hardening):** gated by the
 * dedicated `validation.perform` permission, not the broad
 * `requireEngagementAccess` this function used before P2A — the load-
 * bearing fix that slice exists for: a client must never be able to
 * self-validate its own remediation. Granted only to Engagement Manager
 * and Consultant (`db/seed/roles.ts`) — no client-side role holds it.
 * See DECISIONS.md.
 */
export async function createValidationRecord(
  db: RequestDb,
  userId: string,
  input: CreateValidationRecordInput,
): Promise<{ id: string }> {
  if (!OUTCOME_VALUES.includes(input.outcome)) {
    throw new InvalidValidationInputError("Invalid outcome.");
  }
  if (input.outcome === "rejected" && !input.rationale?.trim()) {
    throw new ValidationRationaleRequiredError();
  }

  const [remediation] = await db
    .select({
      id: remediationActions.id,
      tenantId: remediationActions.tenantId,
      organisationId: remediationActions.organisationId,
      engagementId: remediationActions.engagementId,
    })
    .from(remediationActions)
    .where(eq(remediationActions.id, input.remediationActionId))
    .limit(1);
  if (!remediation) throw new NotFoundOrForbiddenError();

  await requireValidationPerformAccess(db, userId, remediation.engagementId, remediation.organisationId);

  const id = randomUUID();
  await db.insert(validationRecords).values({
    id,
    remediationActionId: remediation.id,
    tenantId: remediation.tenantId,
    organisationId: remediation.organisationId,
    engagementId: remediation.engagementId,
    validatedBy: userId,
    outcome: input.outcome,
    rationale: input.rationale?.trim() ? input.rationale.trim() : null,
    createdBy: userId,
  });

  return { id };
}

export interface ValidationRecordListRow {
  id: string;
  outcome: string;
  validatedByEmail: string | null;
  validatedAt: Date;
  rationale: string | null;
  triggersControlTestId: string | null;
  triggersAssessmentResponseId: string | null;
}

/**
 * The FULL ValidationRecord history for one RemediationAction
 * (instructions §6/§27) — every record, most recent first, including
 * any earlier rejected/superseded ones. Never collapses to "just the
 * latest" — a rejected V1 followed by an accepted V2 must both remain
 * queryable (instructions §21/§27's historical-integrity requirement).
 */
export async function listValidationRecordsForRemediation(
  db: RequestDb,
  remediationActionId: string,
): Promise<ValidationRecordListRow[]> {
  const rows = await db
    .select({
      id: validationRecords.id,
      outcome: validationRecords.outcome,
      validatedByEmail: users.email,
      validatedAt: validationRecords.validatedAt,
      rationale: validationRecords.rationale,
      triggersControlTestId: validationRecords.triggersControlTestId,
      triggersAssessmentResponseId: validationRecords.triggersAssessmentResponseId,
    })
    .from(validationRecords)
    .leftJoin(users, eq(users.id, validationRecords.validatedBy))
    .where(eq(validationRecords.remediationActionId, remediationActionId))
    .orderBy(desc(validationRecords.validatedAt));

  return rows;
}

export interface EngagementValidationRecordRow extends ValidationRecordListRow {
  remediationActionId: string;
  remediationActionTitle: string;
}

/**
 * The FULL ValidationRecord history for an entire Engagement (Slice R1
 * — the Engagement Report's own Validation section, PHASE R1
 * instructions §11). Mirrors `listRisksForEngagement`/
 * `listFindingsForEngagement`/`listRemediationActionsForEngagement`'s
 * identical "one batched query, engagement-wide, real data, no
 * dashboard" shape (Slices C3/C4/C5) — added here, alongside
 * `listValidationRecordsForRemediation` above, rather than as an ad hoc
 * query inside the report module itself, so this list stays the one
 * place engagement-scoped Validation reads live. Scoped directly off
 * `validation_records.engagement_id`/`organisation_id` (both NOT NULL —
 * see db/schema/validation-records.ts) rather than joining through
 * RemediationAction for scope, though RemediationAction is still joined
 * for its title (the report must show what each validation validated).
 * Same "never collapses to latest" posture as the per-RemediationAction
 * list: every historical record for every RemediationAction in the
 * Engagement is returned, most recent first.
 */
export async function listValidationRecordsForEngagement(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string },
): Promise<EngagementValidationRecordRow[]> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const rows = await db
    .select({
      id: validationRecords.id,
      outcome: validationRecords.outcome,
      validatedByEmail: users.email,
      validatedAt: validationRecords.validatedAt,
      rationale: validationRecords.rationale,
      triggersControlTestId: validationRecords.triggersControlTestId,
      triggersAssessmentResponseId: validationRecords.triggersAssessmentResponseId,
      remediationActionId: remediationActions.id,
      remediationActionTitle: remediationActions.title,
    })
    .from(validationRecords)
    .innerJoin(remediationActions, eq(remediationActions.id, validationRecords.remediationActionId))
    .leftJoin(users, eq(users.id, validationRecords.validatedBy))
    .where(and(eq(validationRecords.engagementId, input.engagementId), eq(validationRecords.organisationId, input.organisationId)))
    .orderBy(desc(validationRecords.validatedAt));

  return rows;
}

export interface ValidationRecordDetail {
  id: string;
  outcome: string;
  validatedByEmail: string | null;
  validatedAt: Date;
  rationale: string | null;
  triggersControlTestId: string | null;
  triggersAssessmentResponseId: string | null;
  createdAt: Date;
  organisationId: string;
  engagementId: string;
  remediationAction: { id: string; title: string; status: string };
  evidence: EvidenceSummaryRow[];
}

/**
 * ValidationRecord detail (instructions §13): identity, outcome,
 * validator, date, rationale, the read-only reassessment-trigger
 * columns (shown but never editable from here — instructions §5's
 * "record a new validation, never edit the existing one"), the source
 * RemediationAction for back-navigation (instructions §14), and any
 * Evidence linked directly to this ValidationRecord (instructions §9,
 * via the same generic EvidenceLink used everywhere else).
 */
export async function getValidationRecordDetail(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string; validationRecordId: string },
): Promise<ValidationRecordDetail> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const [row] = await db
    .select({
      id: validationRecords.id,
      outcome: validationRecords.outcome,
      validatedByEmail: users.email,
      validatedAt: validationRecords.validatedAt,
      rationale: validationRecords.rationale,
      triggersControlTestId: validationRecords.triggersControlTestId,
      triggersAssessmentResponseId: validationRecords.triggersAssessmentResponseId,
      createdAt: validationRecords.createdAt,
      organisationId: validationRecords.organisationId,
      engagementId: validationRecords.engagementId,
      remediationActionId: remediationActions.id,
      remediationActionTitle: remediationActions.title,
      remediationActionStatus: remediationActions.status,
    })
    .from(validationRecords)
    .innerJoin(remediationActions, eq(remediationActions.id, validationRecords.remediationActionId))
    .leftJoin(users, eq(users.id, validationRecords.validatedBy))
    .where(eq(validationRecords.id, input.validationRecordId))
    .limit(1);
  if (!row || row.organisationId !== input.organisationId || row.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  // P2A: server-side evidence-visibility enforcement — see
  // lib/domain/evidence.ts's own P2A notes.
  const canSeeInternal = await canReviewEvidence(db, userId, input.engagementId, input.organisationId);
  const evidenceRows = await getEvidenceSummaryForValidationRecord(db, row.id, canSeeInternal);

  return {
    id: row.id,
    outcome: row.outcome,
    validatedByEmail: row.validatedByEmail,
    validatedAt: row.validatedAt,
    rationale: row.rationale,
    triggersControlTestId: row.triggersControlTestId,
    triggersAssessmentResponseId: row.triggersAssessmentResponseId,
    createdAt: row.createdAt,
    organisationId: row.organisationId,
    engagementId: row.engagementId,
    remediationAction: { id: row.remediationActionId, title: row.remediationActionTitle, status: row.remediationActionStatus },
    evidence: evidenceRows,
  };
}
