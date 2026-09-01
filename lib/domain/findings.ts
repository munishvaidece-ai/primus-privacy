import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { risks, findings, findingRisks, users } from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess } from "@/lib/authorization/service";

// Slice C4 (PHASE C — FINDINGS) — the Findings domain module: turns an
// existing Risk into a structured, traceable Finding, using the EXACT
// existing Finding/FindingRisk/FindingControl/FindingProcessingActivity
// model built (database-only) in Milestone 7 (migrations 0012/0013),
// hardened for owner tenant-scoping in migration 0021 (mirroring Slice
// C3.1's identical `risks.owner_id` fix — see DECISIONS.md R-102). No
// schema redesign, no new junction, no invented Finding↔Evidence
// relationship (the approved schema has none — see this file's own
// docstrings for where that traceability is resolved instead).

export class InvalidFindingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFindingInputError";
  }
}

const SEVERITY_VALUES = ["low", "medium", "high", "critical"] as const;
type SeverityValue = (typeof SEVERITY_VALUES)[number];
const STATUS_VALUES = ["open", "in_progress", "resolved", "accepted"] as const;
type StatusValue = (typeof STATUS_VALUES)[number];

export interface CreateFindingInput {
  riskId: string;
  title: string;
  description: string | null;
  severity: SeverityValue;
  assignOwnerToSelf: boolean;
}

/**
 * Creates a Finding from an existing Risk (PHASE C4 instructions §3/§4):
 * Risk → Create Finding → validate → authorize → persist → audit → show
 * Finding. Mirrors `createRisk`'s (Slice C3) exact shape: `riskId`
 * identifies the source context only; tenant/organisation/engagement
 * scope is always re-derived from the Risk's own authoritative row,
 * never trusted from the caller (instructions §4/§15). The Risk↔Finding
 * relationship is the EXISTING `finding_risks` many-to-many junction
 * (DATA_MODEL.md §8/§11: "Finding N ←→ N Risk") — one row is always
 * created linking the new Finding to its source Risk; nothing prevents
 * multiple Findings from the same Risk (instructions §21 — no
 * artificial "one Finding per Risk" rule is imposed, since the schema
 * doesn't require one).
 *
 * `finding_risks_risk_scope_fk` (migration 0012) already proves, by
 * construction, that a FindingRisk row's `risk_id` belongs to the exact
 * same tenant/organisation/engagement as the Finding it links —
 * structurally impossible for a Finding to reference a cross-tenant/
 * cross-organisation/cross-engagement Risk (instructions §12; no gap,
 * no schema change needed for this part).
 *
 * `severity` is always the consultant's own explicit input — never
 * copied from the source Risk's `inherent_rating`/`residual_rating`
 * automatically (instructions §9): nothing in DATA_MODEL.md or this
 * project's schema requires that behavior, and `findings.severity` is
 * an independently-stored column with no computed/derived relationship
 * to `risks` at the database layer. (The Finding creation form may
 * default its own severity <select> to the source Risk's rating as a
 * UI convenience only — never enforced, never written by this
 * function without the consultant's own confirmation.)
 *
 * Ownership mirrors `createRisk`'s identical self-only design
 * (instructions §10): `assignOwnerToSelf` is the only mechanism: no
 * arbitrary target user is ever accepted. Migration 0021 makes this a
 * database-enforced guarantee too (`findings_owner_id_tenant_fk`),
 * exactly like `risks.owner_id` since Slice C3.1.
 *
 * Not blocked by Assessment finalization (instructions §13) — see this
 * function's own module-level note below and DECISIONS.md for the full
 * reasoning (mirrors R-98's identical conclusion for Risk, applied here
 * for the same reason: no trigger anywhere in migrations 0012/0013
 * references Assessment finalization for `findings`/`finding_risks`
 * either, and Findings are the next stage after a Risk — which is
 * itself frequently already tied to a finalized Assessment).
 */
export async function createFinding(
  db: RequestDb,
  userId: string,
  input: CreateFindingInput,
): Promise<{ id: string }> {
  if (!input.title.trim()) {
    throw new InvalidFindingInputError("Title is required.");
  }

  const [risk] = await db
    .select({
      id: risks.id,
      tenantId: risks.tenantId,
      organisationId: risks.organisationId,
      engagementId: risks.engagementId,
    })
    .from(risks)
    .where(eq(risks.id, input.riskId))
    .limit(1);
  if (!risk) throw new NotFoundOrForbiddenError();

  await requireEngagementAccess(db, userId, risk.engagementId, risk.organisationId);

  const id = randomUUID();
  await db.insert(findings).values({
    id,
    engagementId: risk.engagementId,
    organisationId: risk.organisationId,
    tenantId: risk.tenantId,
    title: input.title.trim(),
    description: input.description,
    severity: input.severity,
    ownerId: input.assignOwnerToSelf ? userId : null,
    createdBy: userId,
    updatedBy: userId,
  });

  await db.insert(findingRisks).values({
    findingId: id,
    riskId: risk.id,
    tenantId: risk.tenantId,
    organisationId: risk.organisationId,
    engagementId: risk.engagementId,
    createdBy: userId,
  });

  return { id };
}

export interface UpdateFindingInput {
  organisationId: string;
  engagementId: string;
  findingId: string;
  title: string;
  description: string | null;
  severity: SeverityValue;
  status: StatusValue;
  ownerAction: "keep" | "assign_self" | "unassign";
}

/**
 * Updates a Finding's own fields (PHASE C4 instructions §20/§26: title/
 * description/severity/status/owner are the fields this schema actually
 * supports and the `findings_update` RLS policy actually permits — no
 * field beyond these exists on `findings`, and no "rationale" field was
 * added, mirroring Slice C3's identical R-100 finding for Risk: DATA_
 * MODEL.md §8/`db/schema/findings.ts` name no such column). Unlike
 * Risk's scoring fields (frozen at creation because they're pinned to
 * an immutable `RiskScoringModel`, Slice C3), Finding has no such
 * pinned-configuration concept — every field here is an ordinary,
 * ongoing risk-register-style edit, matching `findings`' own
 * `findings_prevent_reparenting` trigger, which only freezes
 * `{engagement_id,organisation_id,tenant_id}`, never `title`/
 * `description`/`severity`/`status`/`owner_id`.
 *
 * `ownerAction` mirrors `createRisk`'s self-only design (instructions
 * §10) but, unlike Risk (status-only edit in Slice C3), Finding's
 * owner can also be changed post-creation — still only ever to the
 * caller's own id, or cleared entirely; never an arbitrary target user.
 */
export async function updateFinding(db: RequestDb, userId: string, input: UpdateFindingInput): Promise<void> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  if (!input.title.trim()) {
    throw new InvalidFindingInputError("Title is required.");
  }

  const [finding] = await db
    .select({ id: findings.id, organisationId: findings.organisationId, engagementId: findings.engagementId })
    .from(findings)
    .where(eq(findings.id, input.findingId))
    .limit(1);
  if (!finding || finding.organisationId !== input.organisationId || finding.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  const ownerId = input.ownerAction === "assign_self" ? userId : input.ownerAction === "unassign" ? null : undefined;

  await db
    .update(findings)
    .set({
      title: input.title.trim(),
      description: input.description,
      severity: input.severity,
      status: input.status,
      ...(ownerId !== undefined ? { ownerId } : {}),
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(findings.id, input.findingId));
}

export interface FindingListRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  ownerEmail: string | null;
  sourceRiskTitle: string | null;
  createdAt: Date;
}

/**
 * The basic engagement-wide Finding list (PHASE C4 instructions §6) —
 * real data, no dashboard, no charts. One batched query (`LEFT JOIN`,
 * not one query per finding). Mirrors `listRisksForEngagement`'s
 * (Slice C3) identical "first joined source row, not an aggregate"
 * posture, since this slice only ever creates exactly one `finding_
 * risks` row per Finding.
 */
export async function listFindingsForEngagement(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string },
): Promise<FindingListRow[]> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const rows = await db
    .select({
      id: findings.id,
      title: findings.title,
      severity: findings.severity,
      status: findings.status,
      ownerEmail: users.email,
      sourceRiskTitle: risks.title,
      createdAt: findings.createdAt,
    })
    .from(findings)
    .leftJoin(users, eq(users.id, findings.ownerId))
    .leftJoin(findingRisks, eq(findingRisks.findingId, findings.id))
    .leftJoin(risks, eq(risks.id, findingRisks.riskId))
    .where(and(eq(findings.engagementId, input.engagementId), eq(findings.organisationId, input.organisationId)))
    .orderBy(desc(findings.createdAt));

  return rows;
}

export interface FindingForRiskRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  ownerEmail: string | null;
  createdAt: Date;
}

/**
 * Findings linked to one specific Risk (PHASE C4 instructions §19 — the
 * compact list the Risk detail page shows: "Assessment → Risk →
 * Findings → Create Finding").
 */
export async function listFindingsForRisk(db: RequestDb, riskId: string): Promise<FindingForRiskRow[]> {
  const rows = await db
    .select({
      id: findings.id,
      title: findings.title,
      severity: findings.severity,
      status: findings.status,
      ownerEmail: users.email,
      createdAt: findings.createdAt,
    })
    .from(findingRisks)
    .innerJoin(findings, eq(findings.id, findingRisks.findingId))
    .leftJoin(users, eq(users.id, findings.ownerId))
    .where(eq(findingRisks.riskId, riskId))
    .orderBy(desc(findings.createdAt));

  return rows;
}

export interface FindingDetail {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  ownerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
  organisationId: string;
  engagementId: string;
  sourceRisks: { id: string; title: string; inherentRating: string; status: string }[];
}

/**
 * Finding detail (PHASE C4 instructions §7): identity, severity,
 * status, owner, and the source Risk(s) — resolved from the EXISTING
 * `finding_risks` relationship only. Evidence/Assessment/Control
 * traceability (instructions §5/§6) is deliberately NOT resolved here —
 * the caller (the Finding detail page) reuses the EXISTING
 * `getRiskDetail` (lib/domain/risks.ts) with this result's own primary
 * `sourceRisks[0]` id, exactly the same function the Risk detail page
 * itself already calls, and from THAT result's own `sourceAssessment`/
 * `sourceControls`/`sourceAssessmentResponse`, further reuses
 * `getControlTestsForControl`/`getEvidenceSummaryForControl` — the
 * identical composition Risk detail already performs, one layer deeper.
 * No duplicate read path, no copied Risk/Evidence metadata (instructions
 * §5's "do not duplicate source data into Finding merely for display —
 * use joins/read models").
 */
export async function getFindingDetail(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string; findingId: string },
): Promise<FindingDetail> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const [row] = await db
    .select({
      id: findings.id,
      title: findings.title,
      description: findings.description,
      severity: findings.severity,
      status: findings.status,
      ownerEmail: users.email,
      createdAt: findings.createdAt,
      updatedAt: findings.updatedAt,
      organisationId: findings.organisationId,
      engagementId: findings.engagementId,
    })
    .from(findings)
    .leftJoin(users, eq(users.id, findings.ownerId))
    .where(eq(findings.id, input.findingId))
    .limit(1);
  if (!row || row.organisationId !== input.organisationId || row.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  const sourceRiskRows = await db
    .select({ id: risks.id, title: risks.title, inherentRating: risks.inherentRating, status: risks.status })
    .from(findingRisks)
    .innerJoin(risks, eq(risks.id, findingRisks.riskId))
    .where(eq(findingRisks.findingId, row.id))
    .orderBy(desc(findingRisks.createdAt));

  return { ...row, sourceRisks: sourceRiskRows };
}
