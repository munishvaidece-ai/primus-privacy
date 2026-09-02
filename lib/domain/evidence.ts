import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import {
  documents,
  documentVersions,
  evidence,
  evidenceLinks,
  engagements,
  assessments,
  assessmentControls,
  assessmentResponses,
  controlTests,
  remediationActions,
  validationRecords,
  auditLog,
  users,
} from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess } from "@/lib/authorization/service";
import { AssessmentFinalizedError } from "@/lib/domain/assessments";
import {
  getEvidenceStorageAdapter,
  buildEvidenceObjectKey,
  ALLOWED_EVIDENCE_MIME_TYPES,
  EVIDENCE_MAX_FILE_SIZE_BYTES,
  SIGNED_URL_EXPIRY_SECONDS,
} from "@/lib/storage/evidence-storage";

// Slice C2 (PHASE C2) — the Evidence domain module: real, secure
// file-based evidence, built on the existing Document/DocumentVersion/
// Evidence/EvidenceLink model (Milestone 6) and Assessment Engine
// (Milestone 5) exactly as they already are. No new domain table, no
// new migration — migration 0011 already carries every INSERT/UPDATE
// policy, GRANT, and audit trigger this module's writes need (confirmed
// by direct inspection before writing any code, the same finding Slice
// C1 made for the assessment-engine tables).

export class InvalidFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFileError";
  }
}

export class ReviewRationaleRequiredError extends Error {
  constructor(message = "A rationale is required when rejecting evidence.") {
    super(message);
    this.name = "ReviewRationaleRequiredError";
  }
}

/**
 * Server-side file validation (PHASE C2 instructions §8): file
 * presence, filename, MIME type, extension-matches-MIME-type, and size
 * — never trusting the browser-supplied MIME type alone. No content
 * inspection beyond this (instructions §8: "do NOT build an elaborate
 * content inspection engine") — see lib/storage/evidence-storage.ts's
 * own docs for the exact allow-list/size limit and DECISIONS.md R-94
 * for why those specific values were chosen.
 */
function validateEvidenceFile(filename: string, mimeType: string, sizeBytes: number): void {
  if (!filename || !filename.trim()) {
    throw new InvalidFileError("A file is required.");
  }
  if (sizeBytes <= 0) {
    throw new InvalidFileError("The uploaded file is empty.");
  }
  if (sizeBytes > EVIDENCE_MAX_FILE_SIZE_BYTES) {
    throw new InvalidFileError(`Files must be ${Math.floor(EVIDENCE_MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB or smaller.`);
  }
  const allowedExtensions = ALLOWED_EVIDENCE_MIME_TYPES[mimeType];
  if (!allowedExtensions) {
    throw new InvalidFileError(`File type "${mimeType}" is not an allowed evidence type.`);
  }
  const extension = path.extname(filename).toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    throw new InvalidFileError(`File extension "${extension || "(none)"}" does not match its content type.`);
  }
}

export interface EvidenceFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

type LinkTarget =
  | { type: "assessment_response"; assessmentResponseId: string }
  | { type: "control_test"; controlTestId: string }
  | { type: "remediation_action"; remediationActionId: string }
  | { type: "validation_record"; validationRecordId: string };

interface ResolvedLinkSubject {
  subjectType: "assessment_response" | "control_test" | "remediation_action" | "validation_record";
  assessmentResponseId: string | null;
  controlTestId: string | null;
  remediationActionId: string | null;
  validationRecordId: string | null;
  // null for a `remediation_action`/`validation_record` subject —
  // neither has an Assessment relationship at all (DATA_MODEL.md §8),
  // so Assessment finalization is structurally not applicable to them
  // (Slice C5 instructions §20/§22; Slice C6 instructions §22 reaches
  // the identical conclusion for ValidationRecord) — never blocked,
  // never a false "finalized" read for a subject with no Assessment to
  // be finalized.
  assessmentStatus: string | null;
}

/**
 * Resolves and validates the Evidence link target (PHASE C2
 * instructions §13, extended in Slice C5 §22 to also support
 * `remediation_action` — the fourth `EvidenceLink` subject type this
 * project's own schema already defines, DATA_MODEL.md §8: "Evidence
 * attaches to RemediationAction... via the same generic EvidenceLink
 * used everywhere else." No new generic polymorphic system — this is
 * the same, already-existing per-subject-type-nullable-column
 * mechanism, one more branch). Re-derives the subject's own tenant/
 * organisation/engagement (and, where applicable, its Assessment's
 * finalization status) from the database, never trusting the caller's
 * own `organisationId`/`engagementId` as proof that the subject
 * actually belongs there (instructions §18).
 */
async function resolveLinkSubject(
  db: RequestDb,
  linkTo: LinkTarget,
  engagementId: string,
  organisationId: string,
  tenantId: string,
): Promise<ResolvedLinkSubject> {
  if (linkTo.type === "assessment_response") {
    const [row] = await db
      .select({
        id: assessmentResponses.id,
        tenantId: assessmentResponses.tenantId,
        organisationId: assessmentResponses.organisationId,
        engagementId: assessmentResponses.engagementId,
        assessmentStatus: assessments.status,
      })
      .from(assessmentResponses)
      .innerJoin(assessmentControls, eq(assessmentControls.id, assessmentResponses.assessmentControlId))
      .innerJoin(assessments, eq(assessments.id, assessmentControls.assessmentId))
      .where(eq(assessmentResponses.id, linkTo.assessmentResponseId))
      .limit(1);
    if (!row || row.tenantId !== tenantId || row.organisationId !== organisationId || row.engagementId !== engagementId) {
      throw new NotFoundOrForbiddenError();
    }
    return {
      subjectType: "assessment_response",
      assessmentResponseId: row.id,
      controlTestId: null,
      remediationActionId: null,
      validationRecordId: null,
      assessmentStatus: row.assessmentStatus,
    };
  }

  if (linkTo.type === "control_test") {
    const [row] = await db
      .select({
        id: controlTests.id,
        tenantId: controlTests.tenantId,
        organisationId: controlTests.organisationId,
        engagementId: controlTests.engagementId,
        assessmentStatus: assessments.status,
      })
      .from(controlTests)
      .innerJoin(assessments, eq(assessments.id, controlTests.assessmentId))
      .where(eq(controlTests.id, linkTo.controlTestId))
      .limit(1);
    if (!row || row.tenantId !== tenantId || row.organisationId !== organisationId || row.engagementId !== engagementId) {
      throw new NotFoundOrForbiddenError();
    }
    return {
      subjectType: "control_test",
      assessmentResponseId: null,
      controlTestId: row.id,
      remediationActionId: null,
      validationRecordId: null,
      assessmentStatus: row.assessmentStatus,
    };
  }

  if (linkTo.type === "remediation_action") {
    const [row] = await db
      .select({
        id: remediationActions.id,
        tenantId: remediationActions.tenantId,
        organisationId: remediationActions.organisationId,
        engagementId: remediationActions.engagementId,
      })
      .from(remediationActions)
      .where(eq(remediationActions.id, linkTo.remediationActionId))
      .limit(1);
    if (!row || row.tenantId !== tenantId || row.organisationId !== organisationId || row.engagementId !== engagementId) {
      throw new NotFoundOrForbiddenError();
    }
    return {
      subjectType: "remediation_action",
      assessmentResponseId: null,
      controlTestId: null,
      remediationActionId: row.id,
      validationRecordId: null,
      assessmentStatus: null,
    };
  }

  // linkTo.type === "validation_record" (Slice C6, instructions §9): the
  // fourth and final EvidenceLink subject type this project's own schema
  // already defines (DATA_MODEL.md §8: "Evidence attaches to...
  // ValidationRecord via the same generic EvidenceLink used everywhere
  // else"). Mirrors the `remediation_action` branch above exactly —
  // ValidationRecord has no Assessment relationship either, so
  // `assessmentStatus` is always null here too.
  const [row] = await db
    .select({
      id: validationRecords.id,
      tenantId: validationRecords.tenantId,
      organisationId: validationRecords.organisationId,
      engagementId: validationRecords.engagementId,
    })
    .from(validationRecords)
    .where(eq(validationRecords.id, linkTo.validationRecordId))
    .limit(1);
  if (!row || row.tenantId !== tenantId || row.organisationId !== organisationId || row.engagementId !== engagementId) {
    throw new NotFoundOrForbiddenError();
  }
  return {
    subjectType: "validation_record",
    assessmentResponseId: null,
    controlTestId: null,
    remediationActionId: null,
    validationRecordId: row.id,
    assessmentStatus: null,
  };
}

/** Confirms the engagement exists, belongs to the claimed organisation,
 * and returns its own authoritative tenantId — never trusting a
 * browser-supplied tenantId anywhere in this module. */
async function resolveEngagementScope(
  db: RequestDb,
  engagementId: string,
  organisationId: string,
): Promise<{ tenantId: string }> {
  const [row] = await db
    .select({ tenantId: engagements.tenantId, organisationId: engagements.organisationId })
    .from(engagements)
    .where(eq(engagements.id, engagementId))
    .limit(1);
  if (!row || row.organisationId !== organisationId) throw new NotFoundOrForbiddenError();
  return { tenantId: row.tenantId };
}

export interface UploadEvidenceInput {
  organisationId: string;
  engagementId: string;
  title: string;
  evidenceType: "policy_document" | "screenshot" | "system_configuration_export" | "signed_agreement" | "certificate" | "other";
  documentType?: "policy" | "contract" | "screenshot" | "certificate" | "report" | "system_configuration" | "other";
  linkTo: LinkTarget;
  file: EvidenceFile;
}

/**
 * The primary Slice C2 write path (PHASE C2 instructions §7): Browser →
 * Server Action → authenticate → authorize → validate metadata → create
 * Document/DocumentVersion → upload private object → verify checksum →
 * create Evidence/EvidenceLink → audit (automatic, via existing
 * triggers) → return a safe result (no signed URL, no storage
 * internals).
 *
 * Ordering matches instructions §7's own caution exactly: the object is
 * uploaded to Storage FIRST (with an id generated application-side, the
 * same pattern every domain function since Slice B1 already uses to
 * avoid an RLS/RETURNING race — see lib/domain/organisations.ts's own
 * docstring), and only once that succeeds are the Document/
 * DocumentVersion/Evidence/EvidenceLink rows inserted, all within the
 * SAME `withRequestDb` transaction the caller already opened — a
 * failure in any one of those inserts rolls back all of them together
 * (the same established, already-tested mechanism DECISIONS.md R-92
 * documents, not a new transaction API). Storage and Postgres are two
 * different systems, so a true cross-system transaction is impossible
 * (instructions §7); the explicit compensating cleanup in the `catch`
 * below — deleting the just-uploaded object — is what instructions §7
 * ask for instead, so a rolled-back database write never leaves a
 * permanently orphaned Storage object behind.
 */
export async function uploadEvidence(
  db: RequestDb,
  userId: string,
  input: UploadEvidenceInput,
): Promise<{ evidenceId: string; documentId: string; documentVersionId: string }> {
  validateEvidenceFile(input.file.filename, input.file.mimeType, input.file.buffer.byteLength);

  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);
  const { tenantId } = await resolveEngagementScope(db, input.engagementId, input.organisationId);

  const subject = await resolveLinkSubject(db, input.linkTo, input.engagementId, input.organisationId, tenantId);
  if (subject.assessmentStatus === "finalized") {
    throw new AssessmentFinalizedError();
  }

  const documentId = randomUUID();
  const documentVersionId = randomUUID();
  const objectKey = buildEvidenceObjectKey(tenantId, input.organisationId, documentId, documentVersionId);

  const storage = getEvidenceStorageAdapter();
  const uploadResult = await storage.upload(objectKey, input.file.buffer, input.file.mimeType);

  try {
    await db.insert(documents).values({
      id: documentId,
      tenantId,
      organisationId: input.organisationId,
      engagementId: input.engagementId,
      title: input.title,
      documentType: input.documentType ?? "other",
      ownerUserId: userId,
      createdBy: userId,
      updatedBy: userId,
    });

    await db.insert(documentVersions).values({
      id: documentVersionId,
      documentId,
      tenantId,
      organisationId: input.organisationId,
      engagementId: input.engagementId,
      // Trigger-assigned (migration 0011's assign_document_version_number,
      // BEFORE INSERT) — this placeholder is unconditionally overwritten
      // by the database; Drizzle's own generated insert type still
      // requires a value since the column has no plain default at the
      // schema level, only a trigger-computed one.
      versionNumber: 0,
      storagePath: objectKey,
      originalFilename: input.file.filename,
      mimeType: input.file.mimeType,
      fileSizeBytes: uploadResult.fileSizeBytes,
      checksumSha256: uploadResult.checksumSha256,
      uploadedBy: userId,
      // scanStatus is left at its column default ('pending') — D-05
      // (malware scanning) remains unresolved; this code never marks an
      // upload 'clean' or otherwise claims scanning happened. See
      // DECISIONS.md D-05 and this file's own module-level note below.
    });

    const evidenceId = randomUUID();
    await db.insert(evidence).values({
      id: evidenceId,
      tenantId,
      organisationId: input.organisationId,
      engagementId: input.engagementId,
      documentVersionId,
      title: input.title,
      evidenceType: input.evidenceType,
      createdBy: userId,
      updatedBy: userId,
    });

    await db.insert(evidenceLinks).values({
      evidenceId,
      tenantId,
      organisationId: input.organisationId,
      engagementId: input.engagementId,
      subjectType: subject.subjectType,
      assessmentResponseId: subject.assessmentResponseId,
      controlTestId: subject.controlTestId,
      remediationActionId: subject.remediationActionId,
      validationRecordId: subject.validationRecordId,
      createdBy: userId,
    });

    return { evidenceId, documentId, documentVersionId };
  } catch (err) {
    // Compensating cleanup (instructions §7) — `withRequestDb`'s own
    // BEGIN/ROLLBACK already undoes every row above; the object already
    // sitting in Storage does not participate in that transaction, so
    // it must be removed explicitly or it becomes a permanent orphan.
    await storage.remove(objectKey).catch((cleanupErr: unknown) => {
      console.error(`Failed to clean up orphaned evidence storage object ${objectKey} after a failed upload`, cleanupErr);
    });
    if (err instanceof Error && /finalized/i.test(err.message)) {
      throw new AssessmentFinalizedError();
    }
    throw err;
  }
}

export interface AddDocumentVersionInput {
  organisationId: string;
  engagementId: string;
  documentId: string;
  file: EvidenceFile;
}

/**
 * Adds a new, independently-immutable version to an EXISTING logical
 * Document (PHASE C2 instructions §11/§23) — never overwrites a prior
 * version (migration 0011's `document_versions_prevent_tampering`
 * trigger is the real, unconditional enforcement regardless of this
 * function). Deliberately does NOT touch any existing Evidence row —
 * "Evidence must never silently follow 'latest version'... it remains
 * pinned to the exact version" (instructions §12) — creating Evidence
 * for the new version, if wanted, is a separate, explicit action
 * (`createEvidenceForVersion` below).
 */
export async function addDocumentVersion(
  db: RequestDb,
  userId: string,
  input: AddDocumentVersionInput,
): Promise<{ documentVersionId: string }> {
  validateEvidenceFile(input.file.filename, input.file.mimeType, input.file.buffer.byteLength);

  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const [doc] = await db
    .select({ tenantId: documents.tenantId, organisationId: documents.organisationId, engagementId: documents.engagementId })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!doc || doc.organisationId !== input.organisationId || doc.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  const documentVersionId = randomUUID();
  const objectKey = buildEvidenceObjectKey(doc.tenantId, doc.organisationId, input.documentId, documentVersionId);

  const storage = getEvidenceStorageAdapter();
  const uploadResult = await storage.upload(objectKey, input.file.buffer, input.file.mimeType);

  try {
    await db.insert(documentVersions).values({
      id: documentVersionId,
      documentId: input.documentId,
      tenantId: doc.tenantId,
      organisationId: doc.organisationId,
      engagementId: doc.engagementId,
      // See uploadEvidence's own identical note — trigger-assigned,
      // unconditionally overwritten.
      versionNumber: 0,
      storagePath: objectKey,
      originalFilename: input.file.filename,
      mimeType: input.file.mimeType,
      fileSizeBytes: uploadResult.fileSizeBytes,
      checksumSha256: uploadResult.checksumSha256,
      uploadedBy: userId,
    });
  } catch (err) {
    await storage.remove(objectKey).catch((cleanupErr: unknown) => {
      console.error(`Failed to clean up orphaned evidence storage object ${objectKey} after a failed version upload`, cleanupErr);
    });
    throw err;
  }

  return { documentVersionId };
}

export interface CreateEvidenceForVersionInput {
  organisationId: string;
  engagementId: string;
  documentVersionId: string;
  title: string;
  evidenceType: UploadEvidenceInput["evidenceType"];
  linkTo: LinkTarget;
}

/**
 * Creates an Evidence record pinned to a SPECIFIC, already-uploaded
 * DocumentVersion (PHASE C2 instructions §12) — used when attaching an
 * already-existing version (e.g. one `addDocumentVersion` just created)
 * as evidence, without re-uploading. No storage interaction at all —
 * pure database writes, so this needs no compensating-cleanup handling.
 */
export async function createEvidenceForVersion(
  db: RequestDb,
  userId: string,
  input: CreateEvidenceForVersionInput,
): Promise<{ evidenceId: string }> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);
  const { tenantId } = await resolveEngagementScope(db, input.engagementId, input.organisationId);

  const [version] = await db
    .select({ tenantId: documentVersions.tenantId, organisationId: documentVersions.organisationId, engagementId: documentVersions.engagementId })
    .from(documentVersions)
    .where(eq(documentVersions.id, input.documentVersionId))
    .limit(1);
  if (!version || version.organisationId !== input.organisationId || version.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  const subject = await resolveLinkSubject(db, input.linkTo, input.engagementId, input.organisationId, tenantId);
  if (subject.assessmentStatus === "finalized") {
    throw new AssessmentFinalizedError();
  }

  const evidenceId = randomUUID();
  try {
    await db.insert(evidence).values({
      id: evidenceId,
      tenantId,
      organisationId: input.organisationId,
      engagementId: input.engagementId,
      documentVersionId: input.documentVersionId,
      title: input.title,
      evidenceType: input.evidenceType,
      createdBy: userId,
      updatedBy: userId,
    });
    await db.insert(evidenceLinks).values({
      evidenceId,
      tenantId,
      organisationId: input.organisationId,
      engagementId: input.engagementId,
      subjectType: subject.subjectType,
      assessmentResponseId: subject.assessmentResponseId,
      controlTestId: subject.controlTestId,
      remediationActionId: subject.remediationActionId,
      validationRecordId: subject.validationRecordId,
      createdBy: userId,
    });
  } catch (err) {
    if (err instanceof Error && /finalized/i.test(err.message)) {
      throw new AssessmentFinalizedError();
    }
    throw err;
  }

  return { evidenceId };
}

export interface UnlinkEvidenceInput {
  organisationId: string;
  engagementId: string;
  evidenceLinkId: string;
}

/**
 * Removes an EvidenceLink (PHASE C2 instructions §22: "link/unlink
 * where authorized") — never deletes the underlying Evidence or
 * DocumentVersion row, matching their own never-hard-deleted posture
 * (migration 0011). The existing `evidence_links_enforce_draft_mutable`
 * trigger (migration 0011, extending Milestone 5's finalization
 * guarantee) is the real, unconditional enforcement against unlinking
 * evidence whose subject belongs to a finalized assessment; the
 * `catch` below only turns its raw exception into the same clean error
 * every other write path in this project already uses.
 *
 * Slice C7.3 fix: drizzle-orm's node-postgres driver wraps a `.delete()`
 * failure's real Postgres message on `err.cause`, not `err.message`
 * itself (unlike the `.insert()`/`.update()` failures this project's
 * other trigger-translating catches already handle correctly) —
 * confirmed by direct testing this slice against the now-real
 * finalization trigger this catch was written for but had never
 * actually been exercised against before finalization existed.
 * `errorMessageIncludes` checks both, so this translation works
 * regardless of which layer drizzle put the real message on.
 */
export async function unlinkEvidence(db: RequestDb, userId: string, input: UnlinkEvidenceInput): Promise<void> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const [link] = await db
    .select({ id: evidenceLinks.id, organisationId: evidenceLinks.organisationId, engagementId: evidenceLinks.engagementId })
    .from(evidenceLinks)
    .where(eq(evidenceLinks.id, input.evidenceLinkId))
    .limit(1);
  if (!link || link.organisationId !== input.organisationId || link.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  try {
    await db.delete(evidenceLinks).where(eq(evidenceLinks.id, input.evidenceLinkId));
  } catch (err) {
    if (errorMessageIncludes(err, /finalized/i)) {
      throw new AssessmentFinalizedError();
    }
    throw err;
  }
}

/** Checks a caught error's message for `pattern`, including the real
 * underlying Postgres message when drizzle-orm has wrapped it on
 * `err.cause` rather than `err.message` itself (observed for
 * `.delete()` failures specifically — Slice C7.3). */
function errorMessageIncludes(err: unknown, pattern: RegExp): boolean {
  if (err instanceof Error && pattern.test(err.message)) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return cause instanceof Error && pattern.test(cause.message);
}

export interface ReviewEvidenceInput {
  organisationId: string;
  engagementId: string;
  evidenceId: string;
  reviewStatus: "accepted" | "rejected";
  reviewRationale: string | null;
}

/**
 * The Evidence review lifecycle (PHASE C2 instructions §14/§24) — only
 * the four existing states (`pending_review`/`accepted`/`rejected`/
 * `expired`) are used; this function only ever writes `accepted`/
 * `rejected` (a consultant decision). `expired` is a separate, time-
 * based state this slice does not build a transition for (instructions
 * §14 lists it as something to *see*, not necessarily set — no
 * expiry-sweep job exists anywhere in this project). Rejecting without
 * a rationale is refused server-side (instructions §24: "If rejected:
 * Require review rationale"), not merely a required-attribute on the
 * form. No fine-grained "reviewer" permission distinct from ordinary
 * engagement access exists in the current Role/Permission catalogue
 * (the same R-84/R-93 posture already established) — any engagement
 * member may review, matching how any engagement member may respond to
 * an AssessmentResponse.
 */
export async function reviewEvidence(db: RequestDb, userId: string, input: ReviewEvidenceInput): Promise<void> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  if (input.reviewStatus === "rejected" && !input.reviewRationale?.trim()) {
    throw new ReviewRationaleRequiredError();
  }

  const [row] = await db
    .select({ id: evidence.id, organisationId: evidence.organisationId, engagementId: evidence.engagementId })
    .from(evidence)
    .where(eq(evidence.id, input.evidenceId))
    .limit(1);
  if (!row || row.organisationId !== input.organisationId || row.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  await db
    .update(evidence)
    .set({
      reviewStatus: input.reviewStatus,
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewRationale: input.reviewRationale,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(evidence.id, input.evidenceId));
}

export interface GetEvidenceDownloadUrlInput {
  organisationId: string;
  engagementId: string;
  evidenceId: string;
}

/**
 * Issues a short-lived signed URL for one piece of Evidence's file
 * (PHASE C2 instructions §17): Authenticated user → server
 * authorization → Evidence authorization → short-lived signed URL →
 * private object. Never returns or exposes the raw `storage_path`, a
 * public URL, or any storage credential; never persists the signed URL
 * anywhere (instructions §17). Per SECURITY.md §5's own explicit
 * requirement ("Every signed-URL issuance is itself an auditable
 * event"), this call writes one `audit_log` row itself — the only place
 * in this project's history a Server Action writes directly to
 * `audit_log` rather than relying on a database trigger, because
 * issuing a signed URL is not itself a row mutation any trigger could
 * observe. `entity_type = 'evidence'` (matching the real table this
 * event is about, so every audit event for a given Evidence id groups
 * together regardless of kind) with `reason = 'evidence_signed_url_issued'`
 * distinguishing an access event from an actual Evidence row
 * creation/update (`action = 'insert'` on both, since inserting this
 * row IS the event, not a claim that the Evidence row itself changed).
 */
export async function getEvidenceDownloadUrl(
  db: RequestDb,
  userId: string,
  input: GetEvidenceDownloadUrlInput,
): Promise<{ url: string; expiresAt: Date }> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const [row] = await db
    .select({
      storagePath: documentVersions.storagePath,
      tenantId: evidence.tenantId,
      organisationId: evidence.organisationId,
      engagementId: evidence.engagementId,
    })
    .from(evidence)
    .innerJoin(documentVersions, eq(documentVersions.id, evidence.documentVersionId))
    .where(eq(evidence.id, input.evidenceId))
    .limit(1);
  if (!row || row.organisationId !== input.organisationId || row.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  const storage = getEvidenceStorageAdapter();
  const url = await storage.createSignedUrl(row.storagePath, SIGNED_URL_EXPIRY_SECONDS);
  const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000);

  await db.insert(auditLog).values({
    tenantId: row.tenantId,
    actorUserId: userId,
    entityType: "evidence",
    entityId: input.evidenceId,
    action: "insert",
    reason: "evidence_signed_url_issued",
    fieldChanges: { expiresAt: expiresAt.toISOString() },
  });

  return { url, expiresAt };
}

export interface EvidenceSummaryRow {
  id: string;
  evidenceLinkId: string;
  title: string;
  evidenceType: string;
  reviewStatus: string;
  qualityRating: string | null;
  reviewedByEmail: string | null;
  reviewedAt: Date | null;
  reviewRationale: string | null;
  validUntil: Date | null;
  collectedAt: Date;
  documentId: string;
  documentVersionId: string;
  originalFilename: string;
  linkedVia: "assessment_response" | "control_test" | "remediation_action" | "validation_record";
}

/**
 * The Evidence summary for one Control's Assessment Response and/or
 * ControlTests (moved here from lib/domain/assessments.ts in Slice
 * C2 — the whole Evidence domain now lives in one module; the
 * Assessment workspace page's own import was updated accordingly, no
 * behavior change for what Slice C1 already displayed). Still
 * read-only metadata — no file bytes, no `storage_path`, no signed URL
 * (a separate, explicit action, `getEvidenceDownloadUrl` above).
 */
export async function getEvidenceSummaryForControl(
  db: RequestDb,
  assessmentResponseId: string | null,
  controlTestIds: string[],
): Promise<EvidenceSummaryRow[]> {
  if (!assessmentResponseId && controlTestIds.length === 0) return [];

  const conditions = [];
  if (assessmentResponseId) conditions.push(eq(evidenceLinks.assessmentResponseId, assessmentResponseId));
  if (controlTestIds.length > 0) conditions.push(inArray(evidenceLinks.controlTestId, controlTestIds));

  const rows = await db
    .select({
      id: evidence.id,
      evidenceLinkId: evidenceLinks.id,
      title: evidence.title,
      evidenceType: evidence.evidenceType,
      reviewStatus: evidence.reviewStatus,
      qualityRating: evidence.qualityRating,
      reviewedByEmail: users.email,
      reviewedAt: evidence.reviewedAt,
      reviewRationale: evidence.reviewRationale,
      validUntil: evidence.validUntil,
      collectedAt: evidence.collectedAt,
      documentId: documentVersions.documentId,
      documentVersionId: evidence.documentVersionId,
      originalFilename: documentVersions.originalFilename,
      linkedVia: evidenceLinks.subjectType,
    })
    .from(evidenceLinks)
    .innerJoin(evidence, eq(evidence.id, evidenceLinks.evidenceId))
    .innerJoin(documentVersions, eq(documentVersions.id, evidence.documentVersionId))
    .leftJoin(users, eq(users.id, evidence.reviewedBy))
    .where(or(...conditions))
    .orderBy(desc(evidence.collectedAt));

  // The WHERE clause above only ever matches assessment_response/
  // control_test links — `remediation_action` and `validation_record`
  // are resolved by their own dedicated
  // getEvidenceSummaryForRemediationAction/getEvidenceSummaryFor
  // ValidationRecord functions below instead (Slices C5/C6) — but the
  // column's own DB type covers all four; narrowed explicitly rather
  // than widening this function's own return type.
  return rows as EvidenceSummaryRow[];
}

/**
 * The Evidence summary for an entire Engagement (Slice R1 — the
 * Engagement Report's own Evidence section, PHASE R1 instructions §12:
 * "metadata only... no confidential file embedding, no signed URLs
 * exposed"). Unlike every `getEvidenceSummaryFor*` function above —
 * each of which starts `FROM evidence_links` for a specific subject,
 * since a subject can have zero, one, or several linked Evidence rows
 * — this one starts `FROM evidence` directly, scoped by `evidence`'s
 * own `engagement_id`/`organisation_id` columns (both queried
 * elsewhere in this file, e.g. `getEvidenceDownloadUrl`). One Evidence
 * row is one line in the report's Evidence Summary regardless of how
 * many subjects it happens to be linked to (an EvidenceLink row is not
 * itself report-worthy content — what it's linked to already appears
 * in the report's own Assessment/Remediation/Validation sections); this
 * avoids the row-multiplication a join through `evidence_links` would
 * introduce for any Evidence linked to more than one subject. Still
 * read-only metadata — no `storage_path`, no signed URL, no file
 * bytes.
 */
export interface EngagementEvidenceRow {
  id: string;
  title: string;
  evidenceType: string;
  reviewStatus: string;
  qualityRating: string | null;
  reviewedByEmail: string | null;
  reviewedAt: Date | null;
  validUntil: Date | null;
  collectedAt: Date;
  documentId: string;
  originalFilename: string;
}

export async function getEvidenceSummaryForEngagement(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string },
): Promise<EngagementEvidenceRow[]> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const rows = await db
    .select({
      id: evidence.id,
      title: evidence.title,
      evidenceType: evidence.evidenceType,
      reviewStatus: evidence.reviewStatus,
      qualityRating: evidence.qualityRating,
      reviewedByEmail: users.email,
      reviewedAt: evidence.reviewedAt,
      validUntil: evidence.validUntil,
      collectedAt: evidence.collectedAt,
      documentId: documentVersions.documentId,
      originalFilename: documentVersions.originalFilename,
    })
    .from(evidence)
    .innerJoin(documentVersions, eq(documentVersions.id, evidence.documentVersionId))
    .leftJoin(users, eq(users.id, evidence.reviewedBy))
    .where(and(eq(evidence.engagementId, input.engagementId), eq(evidence.organisationId, input.organisationId)))
    .orderBy(desc(evidence.collectedAt));

  return rows;
}

/**
 * The Evidence summary for one RemediationAction (Slice C5, PHASE C5
 * instructions §22): the fourth `EvidenceLink` subject type — reuses
 * the identical read shape `getEvidenceSummaryForControl` above already
 * established, scoped to `evidence_links.remediation_action_id`
 * instead. Still read-only metadata only — no file bytes, no
 * `storage_path`, no signed URL (instructions §22: "do not expose
 * storage paths").
 */
export async function getEvidenceSummaryForRemediationAction(
  db: RequestDb,
  remediationActionId: string,
): Promise<EvidenceSummaryRow[]> {
  const rows = await db
    .select({
      id: evidence.id,
      evidenceLinkId: evidenceLinks.id,
      title: evidence.title,
      evidenceType: evidence.evidenceType,
      reviewStatus: evidence.reviewStatus,
      qualityRating: evidence.qualityRating,
      reviewedByEmail: users.email,
      reviewedAt: evidence.reviewedAt,
      reviewRationale: evidence.reviewRationale,
      validUntil: evidence.validUntil,
      collectedAt: evidence.collectedAt,
      documentId: documentVersions.documentId,
      documentVersionId: evidence.documentVersionId,
      originalFilename: documentVersions.originalFilename,
      linkedVia: evidenceLinks.subjectType,
    })
    .from(evidenceLinks)
    .innerJoin(evidence, eq(evidence.id, evidenceLinks.evidenceId))
    .innerJoin(documentVersions, eq(documentVersions.id, evidence.documentVersionId))
    .leftJoin(users, eq(users.id, evidence.reviewedBy))
    .where(eq(evidenceLinks.remediationActionId, remediationActionId))
    .orderBy(desc(evidence.collectedAt));

  return rows as EvidenceSummaryRow[];
}

/**
 * The Evidence summary for one ValidationRecord (Slice C6, instructions
 * §9): the fourth and final `EvidenceLink` subject type — reuses the
 * identical read shape `getEvidenceSummaryForRemediationAction` above
 * already established, scoped to `evidence_links.validation_record_id`
 * instead. Still read-only metadata only — no file bytes, no
 * `storage_path`, no signed URL.
 */
export async function getEvidenceSummaryForValidationRecord(
  db: RequestDb,
  validationRecordId: string,
): Promise<EvidenceSummaryRow[]> {
  const rows = await getEvidenceSummaryForValidationRecords(db, [validationRecordId]);
  return rows.filter((r) => r.validationRecordId === validationRecordId);
}

export interface ValidationEvidenceSummaryRow extends EvidenceSummaryRow {
  validationRecordId: string;
}

/**
 * Batched variant of `getEvidenceSummaryForValidationRecord` (Slice C6,
 * instructions §32 — no N+1): one query for ALL of a RemediationAction's
 * ValidationRecords' evidence at once, tagged with which record each row
 * belongs to, mirroring `getEvidenceSummaryForControl`'s own
 * `controlTestIds` batching. Used by the RemediationAction detail page,
 * which shows the full validation history plus each record's own
 * evidence — never one query per ValidationRecord row.
 */
export async function getEvidenceSummaryForValidationRecords(
  db: RequestDb,
  validationRecordIds: string[],
): Promise<ValidationEvidenceSummaryRow[]> {
  if (validationRecordIds.length === 0) return [];

  const rows = await db
    .select({
      id: evidence.id,
      evidenceLinkId: evidenceLinks.id,
      title: evidence.title,
      evidenceType: evidence.evidenceType,
      reviewStatus: evidence.reviewStatus,
      qualityRating: evidence.qualityRating,
      reviewedByEmail: users.email,
      reviewedAt: evidence.reviewedAt,
      reviewRationale: evidence.reviewRationale,
      validUntil: evidence.validUntil,
      collectedAt: evidence.collectedAt,
      documentId: documentVersions.documentId,
      documentVersionId: evidence.documentVersionId,
      originalFilename: documentVersions.originalFilename,
      linkedVia: evidenceLinks.subjectType,
      validationRecordId: evidenceLinks.validationRecordId,
    })
    .from(evidenceLinks)
    .innerJoin(evidence, eq(evidence.id, evidenceLinks.evidenceId))
    .innerJoin(documentVersions, eq(documentVersions.id, evidence.documentVersionId))
    .leftJoin(users, eq(users.id, evidence.reviewedBy))
    .where(inArray(evidenceLinks.validationRecordId, validationRecordIds))
    .orderBy(desc(evidence.collectedAt));

  return rows as ValidationEvidenceSummaryRow[];
}

export interface DocumentVersionRow {
  id: string;
  versionNumber: number;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  checksumSha256: string;
  scanStatus: string;
  uploadedByEmail: string | null;
  uploadedAt: Date;
  evidenceCount: number;
}

/**
 * All versions of one Document (PHASE C2 instructions §23), each
 * showing enough to make it obvious a specific version is being
 * displayed and how many current Evidence rows reference it — "make it
 * obvious that evidence references a specific version... do not imply
 * evidence automatically moves to the latest version." One query (a
 * LEFT JOIN + COUNT), not one query per version.
 */
export async function listDocumentVersionsForDocument(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string; documentId: string },
): Promise<DocumentVersionRow[]> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const [doc] = await db
    .select({ organisationId: documents.organisationId, engagementId: documents.engagementId })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!doc || doc.organisationId !== input.organisationId || doc.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  const rows = await db
    .select({
      id: documentVersions.id,
      versionNumber: documentVersions.versionNumber,
      originalFilename: documentVersions.originalFilename,
      mimeType: documentVersions.mimeType,
      fileSizeBytes: documentVersions.fileSizeBytes,
      checksumSha256: documentVersions.checksumSha256,
      scanStatus: documentVersions.scanStatus,
      uploadedByEmail: users.email,
      uploadedAt: documentVersions.uploadedAt,
      evidenceCount: sql<number>`count(distinct ${evidence.id})`.mapWith(Number),
    })
    .from(documentVersions)
    .leftJoin(users, eq(users.id, documentVersions.uploadedBy))
    .leftJoin(evidence, eq(evidence.documentVersionId, documentVersions.id))
    .where(eq(documentVersions.documentId, input.documentId))
    .groupBy(documentVersions.id, users.email)
    .orderBy(desc(documentVersions.versionNumber));

  return rows;
}
