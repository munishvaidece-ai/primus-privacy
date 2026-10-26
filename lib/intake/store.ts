import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { intakeFiles, engagements } from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess } from "@/lib/authorization/service";
import { getEvidenceStorageAdapter, sha256Buffer } from "@/lib/storage/evidence-storage";
import { getViewer } from "@/lib/workspace/common";
import { emit } from "@/lib/workspace/emit";
import { validateTemplateFile, type Issue, type ParsedTemplate, type ValidationResult } from "@/lib/templates/validate";
import { TEMPLATES, type TemplateKey } from "@/lib/templates/definitions";

export const INTAKE_MAX_BYTES = 15 * 1024 * 1024;

export type IntakeRole = "template" | "support" | "evidence_file" | "proof_file";

export interface IntakeFileRow {
  id: string;
  phase: number;
  role: IntakeRole;
  templateKey: string | null;
  filename: string;
  sizeBytes: number;
  source: string;
  status: "received" | "accepted" | "rejected" | "processed";
  summary: string;
  issues: Issue[];
  uploadedBy: string;
  uploadedByName: string;
  uploadedBySide: "primus" | "client";
  uploadedAt: Date;
  processedAt: Date | null;
}

export interface FileInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SAFE_NAME = (n: string) => path.basename(n).replace(/[^\w.\- ()]/g, "_").slice(0, 160) || "file";

async function store(db: RequestDb, userId: string, input: {
  engagementId: string; organisationId: string; phase: number; role: IntakeRole; templateKey: string | null; file: FileInput;
  source: string; status: "accepted" | "rejected" | "received"; validation: unknown; parsed: unknown | null;
}): Promise<string> {
  const [eng] = await db.select({ tenantId: engagements.tenantId }).from(engagements).where(and(eq(engagements.id, input.engagementId), eq(engagements.organisationId, input.organisationId))).limit(1);
  if (!eng) throw new NotFoundOrForbiddenError();
  const viewer = await getViewer(db, userId);
  const id = randomUUID();
  const objectKey = `tenants/${eng.tenantId}/organisations/${input.organisationId}/intake/${id}`;
  const storage = getEvidenceStorageAdapter();
  const up = await storage.upload(objectKey, input.file.buffer, input.file.mimeType || "application/octet-stream");
  try {
    await db.insert(intakeFiles).values({
      id,
      tenantId: eng.tenantId,
      organisationId: input.organisationId,
      engagementId: input.engagementId,
      phase: input.phase,
      role: input.role,
      templateKey: input.templateKey,
      filename: SAFE_NAME(input.file.filename),
      mimeType: input.file.mimeType || "application/octet-stream",
      sizeBytes: up.fileSizeBytes,
      storagePath: objectKey,
      checksumSha256: up.checksumSha256,
      source: input.source,
      status: input.status,
      validation: input.validation as Record<string, unknown>,
      parsed: input.parsed as Record<string, unknown> | null,
      uploadedBy: userId,
      uploadedByName: viewer.displayName ?? viewer.email ?? "Someone",
      uploadedBySide: viewer.side,
    });
  } catch (err) {
    await storage.remove(objectKey).catch(() => undefined);
    throw err;
  }
  return id;
}

/** Receives a filled template: checks it against the template and records the outcome, accepted or not. */
export async function receiveTemplateFile(
  db: RequestDb,
  userId: string,
  input: { engagementId: string; organisationId: string; template: TemplateKey; file: FileInput; source?: string },
): Promise<{ id: string; result: ValidationResult }> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);
  const def = TEMPLATES[input.template];
  let result: ValidationResult;
  if (input.file.buffer.byteLength === 0) {
    result = { ok: false, detectedKey: null, issues: [{ severity: "error", message: "The file is empty." }], data: null, summary: "The file is empty, so nothing was read.", stats: { rows: 0, errors: 1, warnings: 0 } };
  } else if (input.file.buffer.byteLength > INTAKE_MAX_BYTES) {
    result = { ok: false, detectedKey: null, issues: [{ severity: "error", message: `Files must be ${INTAKE_MAX_BYTES / 1024 / 1024}MB or smaller.` }], data: null, summary: "The file is too large, so nothing was read.", stats: { rows: 0, errors: 1, warnings: 0 } };
  } else if (!/\.xlsx$/i.test(input.file.filename)) {
    result = { ok: false, detectedKey: null, issues: [{ severity: "error", message: `"${input.file.filename}" is not an Excel (.xlsx) file. This slot takes the filled "${def.title}" template.` }], data: null, summary: `This slot takes the ${def.title} as an Excel (.xlsx) file. Nothing was read.`, stats: { rows: 0, errors: 1, warnings: 0 } };
  } else {
    result = validateTemplateFile(new Uint8Array(input.file.buffer), input.template);
  }
  const id = await store(db, userId, {
    engagementId: input.engagementId,
    organisationId: input.organisationId,
    phase: def.phase,
    role: "template",
    templateKey: input.template,
    file: input.file,
    source: input.source ?? "upload",
    status: result.ok ? "accepted" : "rejected",
    validation: { ok: result.ok, summary: result.summary, detectedKey: result.detectedKey, issues: result.issues, stats: result.stats },
    parsed: result.ok ? result.data : null,
  });
  await emit(db, {
    engagementId: input.engagementId,
    kind: "intake_file",
    summary: result.ok ? `${input.file.filename} was uploaded for phase ${def.phase} and passed the ${def.title} check` : `${input.file.filename} was uploaded for phase ${def.phase} and was refused: ${result.summary}`,
    subjectType: "intake_file",
    subjectId: id,
    clientVisible: true,
  });
  return { id, result };
}

/** Receives a supporting, evidence or proof file. It is kept as sent; it is read later by the AI, not here. */
export async function receiveSupportFile(
  db: RequestDb,
  userId: string,
  input: { engagementId: string; organisationId: string; phase: number; role: Exclude<IntakeRole, "template">; file: FileInput; source?: string },
): Promise<{ id: string }> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);
  if (input.file.buffer.byteLength === 0) throw new IntakeInputError("The file is empty.");
  if (input.file.buffer.byteLength > INTAKE_MAX_BYTES) throw new IntakeInputError(`Files must be ${INTAKE_MAX_BYTES / 1024 / 1024}MB or smaller.`);
  const id = await store(db, userId, { ...input, templateKey: null, source: input.source ?? "upload", status: "received", validation: { ok: true, summary: "Received.", issues: [] }, parsed: null });
  await emit(db, { engagementId: input.engagementId, kind: "intake_file", summary: `${input.file.filename} was uploaded for phase ${input.phase}`, subjectType: "intake_file", subjectId: id, clientVisible: true });
  return { id };
}

export class IntakeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeInputError";
  }
}

export async function listIntakeFiles(db: RequestDb, userId: string, input: { engagementId: string; organisationId: string; phase?: number }): Promise<IntakeFileRow[]> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);
  const rows = await db
    .select()
    .from(intakeFiles)
    .where(and(eq(intakeFiles.engagementId, input.engagementId), input.phase ? eq(intakeFiles.phase, input.phase) : undefined))
    .orderBy(desc(intakeFiles.uploadedAt));
  return rows.map(toRow);
}

function toRow(r: typeof intakeFiles.$inferSelect): IntakeFileRow {
  const v = (r.validation ?? {}) as { summary?: string; issues?: Issue[] };
  return {
    id: r.id,
    phase: r.phase,
    role: r.role as IntakeRole,
    templateKey: r.templateKey,
    filename: r.filename,
    sizeBytes: r.sizeBytes,
    source: r.source,
    status: r.status as IntakeFileRow["status"],
    summary: v.summary ?? "",
    issues: v.issues ?? [],
    uploadedBy: r.uploadedBy,
    uploadedByName: r.uploadedByName,
    uploadedBySide: r.uploadedBySide as "primus" | "client",
    uploadedAt: r.uploadedAt,
    processedAt: r.processedAt,
  };
}

/** The newest accepted, not yet processed template for a phase, with what was read from it. */
export async function nextTemplateToProcess(db: RequestDb, engagementId: string, template: TemplateKey): Promise<{ row: IntakeFileRow; data: ParsedTemplate } | null> {
  const [r] = await db
    .select()
    .from(intakeFiles)
    .where(and(eq(intakeFiles.engagementId, engagementId), eq(intakeFiles.templateKey, template), eq(intakeFiles.status, "accepted")))
    .orderBy(desc(intakeFiles.uploadedAt))
    .limit(1);
  if (!r || !r.parsed) return null;
  return { row: toRow(r), data: r.parsed as ParsedTemplate };
}

/** The newest accepted or processed copy of a template, for work that needs an earlier phase's data. */
export async function latestParsed(db: RequestDb, engagementId: string, template: TemplateKey): Promise<{ row: IntakeFileRow; data: ParsedTemplate } | null> {
  const [r] = await db
    .select()
    .from(intakeFiles)
    .where(and(eq(intakeFiles.engagementId, engagementId), eq(intakeFiles.templateKey, template), inArray(intakeFiles.status, ["accepted", "processed"])))
    .orderBy(desc(intakeFiles.uploadedAt))
    .limit(1);
  if (!r || !r.parsed) return null;
  return { row: toRow(r), data: r.parsed as ParsedTemplate };
}

export async function markProcessed(db: RequestDb, fileId: string, jobId: string | null): Promise<void> {
  await db.update(intakeFiles).set({ status: "processed", processedAt: new Date(), processedJobId: jobId }).where(eq(intakeFiles.id, fileId));
}

export async function listSupportFiles(db: RequestDb, engagementId: string, phase: number, role: IntakeRole): Promise<Array<typeof intakeFiles.$inferSelect>> {
  return db.select().from(intakeFiles).where(and(eq(intakeFiles.engagementId, engagementId), eq(intakeFiles.phase, phase), eq(intakeFiles.role, role))).orderBy(asc(intakeFiles.uploadedAt));
}

export { XLSX_MIME };
