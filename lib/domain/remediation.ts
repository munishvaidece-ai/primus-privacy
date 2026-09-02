import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { findings, remediationActions, remediationFindings, validationRecords, users } from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess, requireValidationPerformAccess } from "@/lib/authorization/service";

// Slice C5 (PHASE C — REMEDIATION) — the Remediation domain module:
// turns an existing Finding into a structured, traceable
// RemediationAction, using the EXACT existing RemediationAction/
// RemediationFinding/RemediationRisk/RemediationControl/ValidationRecord
// model built (database-only) in Milestone 7 (migrations 0012/0013),
// hardened for owner tenant-scoping in migration 0022 (mirroring Slices
// C3.1/C4's identical `risks.owner_id`/`findings.owner_id` fix — see
// DECISIONS.md R-104). No schema redesign, no new junction. Validation
// itself was explicitly out of scope through Slice C5 (PHASE C5
// instructions §23) — this module still only ever READS
// `validation_records` for display, never creates/updates one; Slice C6
// (PHASE C — VALIDATION) adds the actual creation path in the sibling
// lib/domain/validation.ts module instead, keeping the two domains
// separate.

export class InvalidRemediationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRemediationInputError";
  }
}

const PRIORITY_VALUES = ["low", "medium", "high", "critical"] as const;
type PriorityValue = (typeof PRIORITY_VALUES)[number];
const STATUS_VALUES = ["open", "in_progress", "evidence_submitted", "validated", "closed"] as const;
type StatusValue = (typeof STATUS_VALUES)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CreateRemediationActionInput {
  findingId: string;
  title: string;
  description: string | null;
  priority: PriorityValue | null;
  dueDate: string | null; // YYYY-MM-DD
  assignOwnerToSelf: boolean;
}

/**
 * Creates a RemediationAction from an existing Finding (PHASE C5
 * instructions §4): Finding → Create Remediation Action → validate →
 * authorize → persist → audit → show Remediation. Mirrors
 * `createFinding`'s (Slice C4) exact shape: `findingId` identifies the
 * source context only; tenant/organisation/engagement scope is always
 * re-derived from the Finding's own authoritative row, never trusted
 * from the caller (instructions §4/§16). The Finding↔RemediationAction
 * relationship is the EXISTING `remediation_findings` many-to-many
 * junction (DATA_MODEL.md §8/§11: "RemediationAction N ←→ N Finding") —
 * one row is always created linking the new RemediationAction to its
 * source Finding; nothing prevents multiple RemediationActions from the
 * same Finding (instructions §6 — no artificial "one RemediationAction
 * per Finding" rule is imposed, since the schema doesn't require one).
 *
 * `remediation_findings_finding_scope_fk` (migration 0012) already
 * proves, by construction, that a RemediationFinding row's `finding_id`
 * belongs to the exact same tenant/organisation/engagement as the
 * RemediationAction it links — structurally impossible for a
 * RemediationAction to be associated with a cross-tenant/cross-
 * organisation/cross-engagement Finding (instructions §5; no gap, no
 * schema change needed for this part).
 *
 * `priority` is never automatically copied from the source Finding's
 * `severity` or the ultimate source Risk's rating (instructions §8) —
 * an independent, optional field the consultant sets explicitly (the
 * creation form's own `<select>` may default to the source Finding's
 * severity as a UI convenience only, never enforced here).
 *
 * Ownership mirrors `createRisk`/`createFinding`'s identical self-only
 * design (instructions §9): `assignOwnerToSelf` is the only mechanism.
 * Migration 0022 makes this a database-enforced guarantee too
 * (`remediation_actions_owner_id_tenant_fk`).
 *
 * Not blocked by Assessment finalization (instructions §20) — see
 * DECISIONS.md for the full reasoning (mirrors R-98/R-103's identical
 * conclusion for Risk/Finding: no trigger anywhere in migrations
 * 0012/0013 references Assessment finalization for `remediation_
 * actions`/`remediation_findings` either).
 */
export async function createRemediationAction(
  db: RequestDb,
  userId: string,
  input: CreateRemediationActionInput,
): Promise<{ id: string }> {
  if (!input.title.trim()) {
    throw new InvalidRemediationInputError("Title is required.");
  }
  if (input.dueDate !== null && !DATE_RE.test(input.dueDate)) {
    throw new InvalidRemediationInputError("Use the date format YYYY-MM-DD for the due date.");
  }

  const [finding] = await db
    .select({
      id: findings.id,
      tenantId: findings.tenantId,
      organisationId: findings.organisationId,
      engagementId: findings.engagementId,
    })
    .from(findings)
    .where(eq(findings.id, input.findingId))
    .limit(1);
  if (!finding) throw new NotFoundOrForbiddenError();

  await requireEngagementAccess(db, userId, finding.engagementId, finding.organisationId);

  const id = randomUUID();
  await db.insert(remediationActions).values({
    id,
    engagementId: finding.engagementId,
    organisationId: finding.organisationId,
    tenantId: finding.tenantId,
    title: input.title.trim(),
    description: input.description,
    priority: input.priority,
    dueDate: input.dueDate,
    ownerId: input.assignOwnerToSelf ? userId : null,
    createdBy: userId,
    updatedBy: userId,
  });

  await db.insert(remediationFindings).values({
    remediationActionId: id,
    findingId: finding.id,
    tenantId: finding.tenantId,
    organisationId: finding.organisationId,
    engagementId: finding.engagementId,
    createdBy: userId,
  });

  return { id };
}

export interface UpdateRemediationActionInput {
  organisationId: string;
  engagementId: string;
  remediationActionId: string;
  title: string;
  description: string | null;
  priority: PriorityValue | null;
  status: StatusValue;
  dueDate: string | null;
  ownerAction: "keep" | "assign_self" | "unassign";
}

/**
 * Updates a RemediationAction's own fields (PHASE C5 instructions
 * §24/§28: title/description/priority/status/due_date/owner are the
 * fields this schema actually supports and the `remediation_actions_
 * update` RLS policy actually permits). `status` accepts any of the
 * five existing values with no enforced transition order — nothing in
 * migration 0012/0013 restricts which status a RemediationAction may
 * move to next (DECISIONS.md R-71: "`RemediationAction.status =
 * 'evidence_submitted'` is NOT enforced at the database layer to
 * require a linked Evidence row to exist" — the whole status field is
 * deliberately application-layer-optional, not a database state
 * machine, so this function does not invent transition rules the
 * repository itself doesn't define, per instructions §24).
 *
 * `completed_at` is set exactly once, the first time `status` reaches
 * a terminal value (`validated`/`closed`) — matching `remediation_
 * actions.ts`'s own schema comment ("records when `status` first
 * reached a terminal value"). It is never cleared if status later moves
 * away from a terminal value — a historical marker, not a live
 * "currently terminal" flag. This is accurate timestamp bookkeeping for
 * an explicit, consultant-chosen status change, not the "automatic
 * remediation completion" instructions §23 forbid (nothing here
 * transitions status on its own).
 *
 * **P2A.1 (Close Remediation Self-Validation Gap):** `status =
 * "validated"` is DATA_MODEL.md §8's own name for the exact same
 * decision `createValidationRecord` (lib/domain/validation.ts) makes
 * explicit — "the explicit consultant-validation step between 'evidence
 * submitted' and 'control reassessment'" (validation-records.ts's own
 * header). Setting it is therefore gated by the same `validation.perform`
 * permission as creating a ValidationRecord, closing the second,
 * narrower self-validation surface P2A's own final report flagged
 * (superseding DECISIONS.md R-151's earlier "left untouched" call — see
 * R-154). Every other status value, and every other field on this
 * function, is completely unchanged: a client still has full,
 * unrestricted remediation participation (progress notes, due date,
 * ownership, and every non-"validated" status transition, "closed"
 * included).
 */
export async function updateRemediationAction(
  db: RequestDb,
  userId: string,
  input: UpdateRemediationActionInput,
): Promise<void> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  if (!input.title.trim()) {
    throw new InvalidRemediationInputError("Title is required.");
  }
  if (input.dueDate !== null && !DATE_RE.test(input.dueDate)) {
    throw new InvalidRemediationInputError("Use the date format YYYY-MM-DD for the due date.");
  }

  // P2A.1: setting (or keeping) `status = "validated"` is the consultant-
  // validation declaration itself — gated by the same `validation.perform`
  // permission `createValidationRecord` requires, closing the second
  // self-validation surface this function's own docstring above
  // describes. Every other status value is unaffected.
  if (input.status === "validated") {
    await requireValidationPerformAccess(db, userId, input.engagementId, input.organisationId);
  }

  const [row] = await db
    .select({
      id: remediationActions.id,
      organisationId: remediationActions.organisationId,
      engagementId: remediationActions.engagementId,
      completedAt: remediationActions.completedAt,
    })
    .from(remediationActions)
    .where(eq(remediationActions.id, input.remediationActionId))
    .limit(1);
  if (!row || row.organisationId !== input.organisationId || row.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  const ownerId = input.ownerAction === "assign_self" ? userId : input.ownerAction === "unassign" ? null : undefined;
  const enteringTerminal = (input.status === "validated" || input.status === "closed") && row.completedAt === null;

  await db
    .update(remediationActions)
    .set({
      title: input.title.trim(),
      description: input.description,
      priority: input.priority,
      status: input.status,
      dueDate: input.dueDate,
      ...(ownerId !== undefined ? { ownerId } : {}),
      ...(enteringTerminal ? { completedAt: new Date() } : {}),
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(remediationActions.id, input.remediationActionId));
}

export interface RemediationListRow {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  ownerEmail: string | null;
  dueDate: string | null;
  sourceFindingTitle: string | null;
  createdAt: Date;
}

/**
 * The basic engagement-wide RemediationAction list (PHASE C5
 * instructions §14) — real data, no dashboard, no charts. One batched
 * query (`LEFT JOIN`, not one query per remediation action).
 */
export async function listRemediationActionsForEngagement(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string },
): Promise<RemediationListRow[]> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const rows = await db
    .select({
      id: remediationActions.id,
      title: remediationActions.title,
      status: remediationActions.status,
      priority: remediationActions.priority,
      ownerEmail: users.email,
      dueDate: remediationActions.dueDate,
      sourceFindingTitle: findings.title,
      createdAt: remediationActions.createdAt,
    })
    .from(remediationActions)
    .leftJoin(users, eq(users.id, remediationActions.ownerId))
    .leftJoin(remediationFindings, eq(remediationFindings.remediationActionId, remediationActions.id))
    .leftJoin(findings, eq(findings.id, remediationFindings.findingId))
    .where(and(eq(remediationActions.engagementId, input.engagementId), eq(remediationActions.organisationId, input.organisationId)))
    .orderBy(desc(remediationActions.createdAt));

  return rows;
}

export interface RemediationForFindingRow {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  ownerEmail: string | null;
  dueDate: string | null;
  createdAt: Date;
}

/**
 * RemediationActions linked to one specific Finding (PHASE C5
 * instructions §13 — the compact list the Finding detail page shows:
 * "Finding → Remediation Actions → Create Remediation").
 */
export async function listRemediationActionsForFinding(db: RequestDb, findingId: string): Promise<RemediationForFindingRow[]> {
  const rows = await db
    .select({
      id: remediationActions.id,
      title: remediationActions.title,
      status: remediationActions.status,
      priority: remediationActions.priority,
      ownerEmail: users.email,
      dueDate: remediationActions.dueDate,
      createdAt: remediationActions.createdAt,
    })
    .from(remediationFindings)
    .innerJoin(remediationActions, eq(remediationActions.id, remediationFindings.remediationActionId))
    .leftJoin(users, eq(users.id, remediationActions.ownerId))
    .where(eq(remediationFindings.findingId, findingId))
    .orderBy(desc(remediationActions.createdAt));

  return rows;
}

export interface RemediationValidationRow {
  id: string;
  outcome: string;
  validatedByEmail: string | null;
  validatedAt: Date;
  rationale: string | null;
  triggersControlTestId: string | null;
  triggersAssessmentResponseId: string | null;
}

export interface RemediationActionDetail {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  dueDate: string | null;
  ownerEmail: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  organisationId: string;
  engagementId: string;
  sourceFindings: { id: string; title: string; severity: string; status: string }[];
  validationRecords: RemediationValidationRow[];
}

/**
 * RemediationAction detail (PHASE C5 instructions §11): identity,
 * status, priority, owner, due date, and the source Finding(s) —
 * resolved from the EXISTING `remediation_findings` relationship only.
 * Risk/Assessment/Control/Evidence traceability (instructions §4) is
 * deliberately NOT resolved here — the caller (the RemediationAction
 * detail page) reuses the EXISTING `getFindingDetail` (Slice C4) with
 * this result's own primary `sourceFindings[0]` id, which itself
 * reuses `getRiskDetail` (Slice C3) and, from there,
 * `getControlTestsForControl`/`getEvidenceSummaryForControl` — the
 * identical composition Finding detail already performs, one layer
 * deeper. No duplicate read path, no copied Finding/Risk/Evidence
 * metadata (instructions §5's "do not duplicate source data").
 *
 * `validationRecords` is the FULL, read-only ValidationRecord history
 * for this RemediationAction, most recent first — every record,
 * including any earlier rejected/superseded ones (Slice C6 instructions
 * §6/§27: multiple validations are normal, never collapsed to "just the
 * latest"). Creating a ValidationRecord is a separate, explicit action
 * (`createValidationRecord`, lib/domain/validation.ts) invoked from the
 * page that reads this detail — this function itself only ever reads.
 */
export async function getRemediationActionDetail(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string; remediationActionId: string },
): Promise<RemediationActionDetail> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const [row] = await db
    .select({
      id: remediationActions.id,
      title: remediationActions.title,
      description: remediationActions.description,
      status: remediationActions.status,
      priority: remediationActions.priority,
      dueDate: remediationActions.dueDate,
      ownerEmail: users.email,
      completedAt: remediationActions.completedAt,
      createdAt: remediationActions.createdAt,
      updatedAt: remediationActions.updatedAt,
      organisationId: remediationActions.organisationId,
      engagementId: remediationActions.engagementId,
    })
    .from(remediationActions)
    .leftJoin(users, eq(users.id, remediationActions.ownerId))
    .where(eq(remediationActions.id, input.remediationActionId))
    .limit(1);
  if (!row || row.organisationId !== input.organisationId || row.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  const sourceFindingRows = await db
    .select({ id: findings.id, title: findings.title, severity: findings.severity, status: findings.status })
    .from(remediationFindings)
    .innerJoin(findings, eq(findings.id, remediationFindings.findingId))
    .where(eq(remediationFindings.remediationActionId, row.id))
    .orderBy(desc(remediationFindings.createdAt));

  const validationRows = await db
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
    .where(eq(validationRecords.remediationActionId, row.id))
    .orderBy(desc(validationRecords.validatedAt));

  return { ...row, sourceFindings: sourceFindingRows, validationRecords: validationRows };
}
