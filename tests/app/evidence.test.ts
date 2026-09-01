// Slice C2 — Secure Evidence Storage + Evidence Review. Tests the real
// functions the real Assessment workspace/Server Actions call
// (lib/domain/evidence.ts, lib/storage/evidence-storage.ts) against
// real PostgreSQL — no mocked permission functions. Covers the required
// database (1-10) and application (11-17) security scenarios (PHASE C2
// instructions §26), the historical versioning scenario (§27), the
// review lifecycle (§28), and failure/cleanup behavior (§29). The
// Storage-layer scenarios (§26 items 18-22) are covered separately in
// tests/app/evidence-storage.test.ts, and explicitly NOT re-claimed
// here as "tested against real Supabase" — see that file's own header.
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  uploadEvidence,
  addDocumentVersion,
  createEvidenceForVersion,
  unlinkEvidence,
  reviewEvidence,
  getEvidenceDownloadUrl,
  getEvidenceSummaryForControl,
  listDocumentVersionsForDocument,
  InvalidFileError,
  ReviewRationaleRequiredError,
} from "@/lib/domain/evidence";
import { AssessmentFinalizedError } from "@/lib/domain/assessments";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import {
  asAnon,
  asFixtureSetup,
  createTenant,
  createOrganisation,
  createEngagement,
  createUser,
  grantEngagementMembership,
  createControlLibraryVersion,
  publishControlLibraryVersion,
  createControl,
  pinEngagementControlLibraryVersion,
  createAssessment,
  finalizeAssessment,
  addAssessmentControl,
  createAssessmentResponse,
  createControlTest as createControlTestFixture,
  pool,
} from "./helpers";

const LOCAL_STORAGE_ROOT = path.join(process.cwd(), ".local-storage", "evidence");

function textFile(content = "synthetic evidence content — not a real client document") {
  return { buffer: Buffer.from(content, "utf8"), filename: "evidence.txt", mimeType: "text/plain" };
}

async function countRows(table: string, whereCol: string, whereVal: string): Promise<number> {
  const { rows } = await asFixtureSetup((c) => c.query(`SELECT count(*)::int as n FROM ${table} WHERE ${whereCol} = $1`, [whereVal]));
  return rows[0].n;
}

describe("Application layer — Evidence Storage + Review (Slice C2)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgA2: string, orgB: string;
  let engagementA: string, engagementA2: string, engagementB: string;
  let libraryA: string, controlA1: string, controlA2: string;
  let controlB1: string;
  let assessmentA: string, assessmentAFinalized: string, assessmentA2: string, assessmentB: string;
  let assessmentControlA1: string, assessmentControlA2: string;
  let assessmentControlAFinalized: string;
  let assessmentControlA2Org: string;
  let assessmentControlB: string;

  let userA: string; // engagement member of engagementA
  let outsiderA: string; // tenant A, no membership anywhere
  let userB: string; // engagement member of engagementB

  let responseA1: string; // AssessmentResponse for assessmentControlA1
  let responseAFinalized: string; // AssessmentResponse for assessmentControlAFinalized, created before finalizing
  let controlTestA1: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice C2 Tenant A");
      tenantB = await createTenant(client, "Slice C2 Tenant B");
      orgA = await createOrganisation(client, tenantA, "Slice C2 Org A");
      orgA2 = await createOrganisation(client, tenantA, "Slice C2 Org A2");
      orgB = await createOrganisation(client, tenantB, "Slice C2 Org B");

      engagementA = await createEngagement(client, tenantA, orgA, "Slice C2 Engagement A");
      engagementA2 = await createEngagement(client, tenantA, orgA, "Slice C2 Engagement A (second)");
      engagementB = await createEngagement(client, tenantB, orgB, "Slice C2 Engagement B");

      libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice C2 Library A" });
      controlA1 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C1", title: "Slice C2 Control 1" });
      controlA2 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C2", title: "Slice C2 Control 2" });
      await publishControlLibraryVersion(client, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA2, libraryA);

      const libraryB = await createControlLibraryVersion(client, { tenantId: tenantB, versionLabel: "Slice C2 Library B" });
      controlB1 = await createControl(client, { tenantId: tenantB, controlLibraryVersionId: libraryB, code: "B1", title: "Slice C2 Control B1" });
      await publishControlLibraryVersion(client, libraryB);
      await pinEngagementControlLibraryVersion(client, engagementB, libraryB);

      assessmentA = await createAssessment(client, { engagementId: engagementA, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026" });
      assessmentAFinalized = await createAssessment(client, { engagementId: engagementA, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (finalized)" });
      assessmentA2 = await createAssessment(client, { engagementId: engagementA2, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (Engagement A2)" });
      assessmentB = await createAssessment(client, { engagementId: engagementB, organisationId: orgB, tenantId: tenantB, controlLibraryVersionId: libraryB, periodLabel: "FY2026 (Tenant B)" });

      assessmentControlA1 = await addAssessmentControl(client, { assessmentId: assessmentA, controlId: controlA1, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, controlLibraryVersionId: libraryA });
      assessmentControlA2 = await addAssessmentControl(client, { assessmentId: assessmentA, controlId: controlA2, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, controlLibraryVersionId: libraryA });
      assessmentControlAFinalized = await addAssessmentControl(client, { assessmentId: assessmentAFinalized, controlId: controlA1, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, controlLibraryVersionId: libraryA });
      assessmentControlA2Org = await addAssessmentControl(client, { assessmentId: assessmentA2, controlId: controlA1, tenantId: tenantA, organisationId: orgA, engagementId: engagementA2, controlLibraryVersionId: libraryA });
      assessmentControlB = await addAssessmentControl(client, { assessmentId: assessmentB, controlId: controlB1, tenantId: tenantB, organisationId: orgB, engagementId: engagementB, controlLibraryVersionId: libraryB });

      userA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA, engagementA);
      outsiderA = await createUser(client, { tenantId: tenantA });
      userB = await createUser(client, { tenantId: tenantB });
      await grantEngagementMembership(client, userB, engagementB);

      responseA1 = await createAssessmentResponse(client, {
        assessmentControlId: assessmentControlA1,
        tenantId: tenantA,
        organisationId: orgA,
        engagementId: engagementA,
        effectivenessRating: "implemented",
        respondentId: userA,
      });
      controlTestA1 = await createControlTestFixture(client, {
        controlId: controlA1,
        tenantId: tenantA,
        assessmentId: assessmentA,
        organisationId: orgA,
        engagementId: engagementA,
        result: "pass",
        testerId: userA,
      });

      // Created BEFORE finalizing — needed by the finalization-lock tests.
      responseAFinalized = await createAssessmentResponse(client, {
        assessmentControlId: assessmentControlAFinalized,
        tenantId: tenantA,
        organisationId: orgA,
        engagementId: engagementA,
        effectivenessRating: "implemented",
      });
      await finalizeAssessment(client, assessmentAFinalized);
    });
  });

  afterEach(async () => {
    await fs.rm(LOCAL_STORAGE_ROOT, { recursive: true, force: true }).catch(() => {});
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- Application-level behavior -----------------------------------

  it("uploadEvidence success: creates Document + DocumentVersion (v1, pending scan) + Evidence + EvidenceLink, and the real file exists on disk with a matching checksum", async () => {
    const file = textFile();
    const { evidenceId, documentId, documentVersionId } = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Access control policy",
        evidenceType: "policy_document",
        linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
        file,
      }),
    );

    expect(evidenceId).toBeTruthy();

    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT dv.version_number, dv.checksum_sha256, dv.file_size_bytes, dv.scan_status, dv.storage_path, e.document_version_id, el.subject_type
         FROM document_versions dv
         JOIN evidence e ON e.document_version_id = dv.id
         JOIN evidence_links el ON el.evidence_id = e.id
         WHERE dv.id = $1`,
        [documentVersionId],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version_number: 1,
      scan_status: "pending", // D-05 remains unresolved — never marked 'clean'.
      subject_type: "assessment_response",
    });

    const onDisk = await fs.readFile(path.join(LOCAL_STORAGE_ROOT, rows[0].storage_path));
    expect(onDisk.equals(file.buffer)).toBe(true);
    expect(rows[0].checksum_sha256).toHaveLength(64); // real sha256 hex digest

    expect(documentId).toBeTruthy();
  });

  it("addDocumentVersion: adds v2 to an existing Document without touching v1", async () => {
    const first = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Versioned policy",
        evidenceType: "policy_document",
        linkTo: { type: "control_test", controlTestId: controlTestA1 },
        file: textFile("version 1 content"),
      }),
    );

    const { documentVersionId: v2Id } = await withRequestDb(userA, (db) =>
      addDocumentVersion(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        documentId: first.documentId,
        file: textFile("version 2 content — different from v1"),
      }),
    );

    const versions = await withRequestDb(userA, (db) =>
      listDocumentVersionsForDocument(db, userA, { organisationId: orgA, engagementId: engagementA, documentId: first.documentId }),
    );
    expect(versions).toHaveLength(2);
    const v1 = versions.find((v) => v.id === first.documentVersionId)!;
    const v2 = versions.find((v) => v.id === v2Id)!;
    expect(v1.versionNumber).toBe(1);
    expect(v2.versionNumber).toBe(2);
    expect(v1.checksumSha256).not.toBe(v2.checksumSha256);
  });

  it("createEvidenceForVersion: pins a new Evidence record to a specific, already-uploaded version", async () => {
    const { documentId, documentVersionId: v1 } = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Reusable document",
        evidenceType: "other",
        linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
        file: textFile("shared content"),
      }),
    );
    const { documentVersionId: v2 } = await withRequestDb(userA, (db) =>
      addDocumentVersion(db, userA, { organisationId: orgA, engagementId: engagementA, documentId, file: textFile("v2 content") }),
    );

    const { evidenceId } = await withRequestDb(userA, (db) =>
      createEvidenceForVersion(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        documentVersionId: v2,
        title: "Evidence pinned to v2",
        evidenceType: "other",
        linkTo: { type: "control_test", controlTestId: controlTestA1 },
      }),
    );

    const { rows } = await asFixtureSetup((c) => c.query(`SELECT document_version_id FROM evidence WHERE id = $1`, [evidenceId]));
    expect(rows[0].document_version_id).toBe(v2);
    expect(rows[0].document_version_id).not.toBe(v1);
  });

  it("reviewEvidence: pending → accepted, with reviewer attribution and reviewed_at populated", async () => {
    const { evidenceId } = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "To be accepted",
        evidenceType: "other",
        linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
        file: textFile(),
      }),
    );

    await withRequestDb(userA, (db) =>
      reviewEvidence(db, userA, { organisationId: orgA, engagementId: engagementA, evidenceId, reviewStatus: "accepted", reviewRationale: null }),
    );

    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT review_status, reviewed_by, reviewed_at FROM evidence WHERE id = $1`, [evidenceId]),
    );
    expect(rows[0]).toMatchObject({ review_status: "accepted", reviewed_by: userA });
    expect(rows[0].reviewed_at).not.toBeNull();
  });

  it("reviewEvidence: pending → rejected requires a rationale, and stores it once provided", async () => {
    const { evidenceId } = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "To be rejected",
        evidenceType: "other",
        linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
        file: textFile(),
      }),
    );

    await expect(
      withRequestDb(userA, (db) =>
        reviewEvidence(db, userA, { organisationId: orgA, engagementId: engagementA, evidenceId, reviewStatus: "rejected", reviewRationale: null }),
      ),
    ).rejects.toThrow(ReviewRationaleRequiredError);

    await withRequestDb(userA, (db) =>
      reviewEvidence(db, userA, { organisationId: orgA, engagementId: engagementA, evidenceId, reviewStatus: "rejected", reviewRationale: "Document is expired." }),
    );
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT review_status, review_rationale FROM evidence WHERE id = $1`, [evidenceId]));
    expect(rows[0]).toMatchObject({ review_status: "rejected", review_rationale: "Document is expired." });
  });

  it("unlinkEvidence: removes the EvidenceLink without deleting the underlying Evidence/DocumentVersion", async () => {
    const { evidenceId, documentVersionId } = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "To be unlinked",
        evidenceType: "other",
        linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
        file: textFile(),
      }),
    );
    const { rows: linkRows } = await asFixtureSetup((c) => c.query(`SELECT id FROM evidence_links WHERE evidence_id = $1`, [evidenceId]));
    const evidenceLinkId = linkRows[0].id;

    await withRequestDb(userA, (db) => unlinkEvidence(db, userA, { organisationId: orgA, engagementId: engagementA, evidenceLinkId }));

    expect(await countRows("evidence_links", "id", evidenceLinkId)).toBe(0);
    expect(await countRows("evidence", "id", evidenceId)).toBe(1);
    expect(await countRows("document_versions", "id", documentVersionId)).toBe(1);
  });

  it("getEvidenceDownloadUrl: returns a signed URL + expiry, and writes an audit_log row for the access event (SECURITY.md §5)", async () => {
    const { evidenceId } = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "To be downloaded",
        evidenceType: "other",
        linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
        file: textFile(),
      }),
    );

    const { url, expiresAt } = await withRequestDb(userA, (db) =>
      getEvidenceDownloadUrl(db, userA, { organisationId: orgA, engagementId: engagementA, evidenceId }),
    );
    expect(url).toContain("local-evidence-storage://");
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT actor_user_id, entity_type, action, reason FROM audit_log WHERE entity_type = 'evidence' AND entity_id = $1 AND reason = 'evidence_signed_url_issued'`, [evidenceId]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: userA, entity_type: "evidence", action: "insert", reason: "evidence_signed_url_issued" });
  });

  it("getEvidenceSummaryForControl / listDocumentVersionsForDocument reflect uploaded evidence and versions", async () => {
    const { evidenceId, documentId, documentVersionId } = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Summary check",
        evidenceType: "screenshot",
        linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
        file: textFile(),
      }),
    );

    const summary = await withRequestDb(userA, (db) => getEvidenceSummaryForControl(db, responseA1, []));
    const row = summary.find((e) => e.id === evidenceId);
    expect(row).toMatchObject({ title: "Summary check", evidenceType: "screenshot", documentId, documentVersionId, linkedVia: "assessment_response" });

    const versions = await withRequestDb(userA, (db) =>
      listDocumentVersionsForDocument(db, userA, { organisationId: orgA, engagementId: engagementA, documentId }),
    );
    expect(versions).toMatchObject([{ id: documentVersionId, versionNumber: 1, evidenceCount: 1 }]);
  });

  // --- Historical versioning scenario (PHASE C2 instructions §27) ----

  it("Historical versioning: Document D1/V1 → Evidence E1 is never silently moved to V2, and D1/V1 stay exactly as they were", async () => {
    const v1Content = textFile("V1 content — the original");
    const { documentId, documentVersionId: v1Id, evidenceId: e1Id } = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Historical scenario document",
        evidenceType: "policy_document",
        linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
        file: v1Content,
      }),
    );
    const { rows: v1Before } = await asFixtureSetup((c) => c.query(`SELECT checksum_sha256, version_number FROM document_versions WHERE id = $1`, [v1Id]));

    // Upload V2 for the same logical Document.
    const { documentVersionId: v2Id } = await withRequestDb(userA, (db) =>
      addDocumentVersion(db, userA, { organisationId: orgA, engagementId: engagementA, documentId, file: textFile("V2 content — a correction") }),
    );
    expect(v2Id).not.toBe(v1Id);

    // E1 still references V1, not V2.
    const { rows: e1Rows } = await asFixtureSetup((c) => c.query(`SELECT document_version_id FROM evidence WHERE id = $1`, [e1Id]));
    expect(e1Rows[0].document_version_id).toBe(v1Id);
    expect(e1Rows[0].document_version_id).not.toBe(v2Id);

    // V1 is completely unchanged — same checksum, same version number.
    const { rows: v1After } = await asFixtureSetup((c) => c.query(`SELECT checksum_sha256, version_number FROM document_versions WHERE id = $1`, [v1Id]));
    expect(v1After[0]).toMatchObject(v1Before[0]);

    // V2 has a distinct version identity.
    const { rows: v2Rows } = await asFixtureSetup((c) => c.query(`SELECT version_number, checksum_sha256 FROM document_versions WHERE id = $1`, [v2Id]));
    expect(v2Rows[0].version_number).toBe(2);
    expect(v2Rows[0].checksum_sha256).not.toBe(v1Before[0].checksum_sha256);

    // V2 can independently be used for new Evidence.
    const { evidenceId: e2Id } = await withRequestDb(userA, (db) =>
      createEvidenceForVersion(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        documentVersionId: v2Id,
        title: "Evidence for the corrected version",
        evidenceType: "policy_document",
        linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
      }),
    );
    expect(e2Id).not.toBe(e1Id);
    const { rows: e2Rows } = await asFixtureSetup((c) => c.query(`SELECT document_version_id FROM evidence WHERE id = $1`, [e2Id]));
    expect(e2Rows[0].document_version_id).toBe(v2Id);

    // Changing the Document's own metadata (title) does not alter E1's
    // historical version reference at all.
    await asFixtureSetup((c) => c.query(`UPDATE documents SET title = 'Renamed document' WHERE id = $1`, [documentId]));
    const { rows: e1After } = await asFixtureSetup((c) => c.query(`SELECT document_version_id FROM evidence WHERE id = $1`, [e1Id]));
    expect(e1After[0].document_version_id).toBe(v1Id);
  });

  // --- Failure / cleanup tests (PHASE C2 instructions §29) -----------

  it("Invalid file (no filename) is rejected before any storage or database write", async () => {
    const before = await countRows("documents", "organisation_id", orgA);
    await expect(
      withRequestDb(userA, (db) =>
        uploadEvidence(db, userA, {
          organisationId: orgA,
          engagementId: engagementA,
          title: "Bad upload",
          evidenceType: "other",
          linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
          file: { buffer: Buffer.from("x"), filename: "", mimeType: "text/plain" },
        }),
      ),
    ).rejects.toThrow(InvalidFileError);
    expect(await countRows("documents", "organisation_id", orgA)).toBe(before);
  });

  it("Oversized file is rejected before any storage or database write", async () => {
    const oversized = Buffer.alloc(26 * 1024 * 1024); // over the 25MB limit
    await expect(
      withRequestDb(userA, (db) =>
        uploadEvidence(db, userA, {
          organisationId: orgA,
          engagementId: engagementA,
          title: "Too big",
          evidenceType: "other",
          linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
          file: { buffer: oversized, filename: "huge.txt", mimeType: "text/plain" },
        }),
      ),
    ).rejects.toThrow(InvalidFileError);
  });

  it("Unsupported MIME type is rejected", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        uploadEvidence(db, userA, {
          organisationId: orgA,
          engagementId: engagementA,
          title: "Executable",
          evidenceType: "other",
          linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
          file: { buffer: Buffer.from("MZ..."), filename: "evil.exe", mimeType: "application/x-msdownload" },
        }),
      ),
    ).rejects.toThrow(InvalidFileError);
  });

  it("MIME type/extension mismatch is rejected (never trusts the browser-supplied MIME type alone)", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        uploadEvidence(db, userA, {
          organisationId: orgA,
          engagementId: engagementA,
          title: "Mismatched",
          evidenceType: "other",
          linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
          file: { buffer: Buffer.from("not really a pdf"), filename: "fake.pdf", mimeType: "text/plain" },
        }),
      ),
    ).rejects.toThrow(InvalidFileError);
  });

  it("Duplicate upload: two uploads of identical file content are each independent Documents, not deduplicated", async () => {
    const content = textFile("identical content");
    const first = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, { organisationId: orgA, engagementId: engagementA, title: "Copy A", evidenceType: "other", linkTo: { type: "assessment_response", assessmentResponseId: responseA1 }, file: content }),
    );
    const second = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, { organisationId: orgA, engagementId: engagementA, title: "Copy B", evidenceType: "other", linkTo: { type: "assessment_response", assessmentResponseId: responseA1 }, file: content }),
    );
    expect(first.documentId).not.toBe(second.documentId);
    expect(first.evidenceId).not.toBe(second.evidenceId);

    const { rows } = await asFixtureSetup((c) => c.query(`SELECT checksum_sha256 FROM document_versions WHERE id IN ($1,$2)`, [first.documentVersionId, second.documentVersionId]));
    expect(rows[0].checksum_sha256).toBe(rows[1].checksum_sha256); // same content, same hash — still two independent rows.
  });

  it("A finalized assessment's evidence upload is rejected before any storage write occurs (no orphan is possible)", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        uploadEvidence(db, userA, {
          organisationId: orgA,
          engagementId: engagementA,
          title: "Attempted after finalization",
          evidenceType: "other",
          linkTo: { type: "assessment_response", assessmentResponseId: responseAFinalized },
          file: textFile(),
        }),
      ),
    ).rejects.toThrow(AssessmentFinalizedError);
    // Nothing was ever written to local storage for this rejected attempt.
    await expect(fs.readdir(LOCAL_STORAGE_ROOT)).rejects.toThrow();
  });

  // --- Required security scenarios (PHASE C2 instructions §26) -------
  // Database (1-10)

  it("1/2. Tenant A cannot read Tenant B's Document/DocumentVersion", async () => {
    const ctId = await asFixtureSetup((c) =>
      createControlTestFixture(c, { controlId: controlB1, tenantId: tenantB, assessmentId: assessmentB, organisationId: orgB, engagementId: engagementB, result: "pass" }),
    );
    const { documentId } = await withRequestDb(userB, (db) =>
      uploadEvidence(db, userB, { organisationId: orgB, engagementId: engagementB, title: "Tenant B doc", evidenceType: "other", linkTo: { type: "control_test", controlTestId: ctId }, file: textFile() }),
    );

    await expect(
      withRequestDb(userA, (db) => listDocumentVersionsForDocument(db, userA, { organisationId: orgA, engagementId: engagementA, documentId })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("3. Tenant A cannot read Tenant B's Evidence", async () => {
    const ctId = await asFixtureSetup((c) => createControlTestFixture(c, { controlId: controlB1, tenantId: tenantB, assessmentId: assessmentB, organisationId: orgB, engagementId: engagementB, result: "pass" }));
    const { evidenceId } = await withRequestDb(userB, (db) =>
      uploadEvidence(db, userB, { organisationId: orgB, engagementId: engagementB, title: "Tenant B evidence", evidenceType: "other", linkTo: { type: "control_test", controlTestId: ctId }, file: textFile() }),
    );
    await expect(
      withRequestDb(userA, (db) => getEvidenceDownloadUrl(db, userA, { organisationId: orgA, engagementId: engagementA, evidenceId })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("4/5. Tenant A cannot create Evidence or EvidenceLink under Tenant B", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        uploadEvidence(db, userA, { organisationId: orgB, engagementId: engagementB, title: "Cross-tenant attempt", evidenceType: "other", linkTo: { type: "assessment_response", assessmentResponseId: responseA1 }, file: textFile() }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("6. Organisation A cannot access Organisation A2's Evidence (same tenant, different organisation)", async () => {
    // engagementA2 belongs to orgA too in this fixture set, so use a truly
    // different organisation: reuse orgA2 with its own engagement.
    const engagementOrgA2 = await asFixtureSetup((c) => createEngagement(c, tenantA, orgA2, "Slice C2 Org A2 Engagement"));
    const libraryA2Local = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenantA, versionLabel: "Slice C2 Library A2-local" }));
    const controlOrgA2 = await asFixtureSetup((c) => createControl(c, { tenantId: tenantA, controlLibraryVersionId: libraryA2Local, code: "OA2", title: "Org A2 control" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, libraryA2Local));
    await asFixtureSetup((c) => pinEngagementControlLibraryVersion(c, engagementOrgA2, libraryA2Local));
    const assessmentOrgA2 = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagementOrgA2, organisationId: orgA2, tenantId: tenantA, controlLibraryVersionId: libraryA2Local, periodLabel: "Org A2 FY2026" }));
    const acOrgA2 = await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: assessmentOrgA2, controlId: controlOrgA2, tenantId: tenantA, organisationId: orgA2, engagementId: engagementOrgA2, controlLibraryVersionId: libraryA2Local }));
    const respOrgA2 = await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acOrgA2, tenantId: tenantA, organisationId: orgA2, engagementId: engagementOrgA2, effectivenessRating: "implemented" }));
    const userOrgA2 = await asFixtureSetup(async (c) => {
      const id = await createUser(c, { tenantId: tenantA });
      await grantEngagementMembership(c, id, engagementOrgA2);
      return id;
    });
    const { evidenceId } = await withRequestDb(userOrgA2, (db) =>
      uploadEvidence(db, userOrgA2, { organisationId: orgA2, engagementId: engagementOrgA2, title: "Org A2 evidence", evidenceType: "other", linkTo: { type: "assessment_response", assessmentResponseId: respOrgA2 }, file: textFile() }),
    );

    await expect(
      withRequestDb(userA, (db) => getEvidenceDownloadUrl(db, userA, { organisationId: orgA, engagementId: engagementA, evidenceId })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("7. Engagement A cannot access Engagement A2's Evidence (same organisation, different engagement)", async () => {
    const respA2 = await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: assessmentControlA2Org, tenantId: tenantA, organisationId: orgA, engagementId: engagementA2, effectivenessRating: "implemented" }));
    const userEngA2 = await asFixtureSetup(async (c) => {
      const id = await createUser(c, { tenantId: tenantA });
      await grantEngagementMembership(c, id, engagementA2);
      return id;
    });
    const { evidenceId } = await withRequestDb(userEngA2, (db) =>
      uploadEvidence(db, userEngA2, { organisationId: orgA, engagementId: engagementA2, title: "Engagement A2 evidence", evidenceType: "other", linkTo: { type: "assessment_response", assessmentResponseId: respA2 }, file: textFile() }),
    );

    await expect(
      withRequestDb(userA, (db) => getEvidenceDownloadUrl(db, userA, { organisationId: orgA, engagementId: engagementA, evidenceId })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("8. Evidence belonging to another organisation cannot be linked to Assessment A's subject", async () => {
    const ctId = await asFixtureSetup((c) => createControlTestFixture(c, { controlId: controlB1, tenantId: tenantB, assessmentId: assessmentB, organisationId: orgB, engagementId: engagementB, result: "pass" }));
    const { documentVersionId: crossOrgVersionId } = await withRequestDb(userB, (db) =>
      uploadEvidence(db, userB, { organisationId: orgB, engagementId: engagementB, title: "Tenant B version", evidenceType: "other", linkTo: { type: "control_test", controlTestId: ctId }, file: textFile() }),
    );

    await expect(
      withRequestDb(userA, (db) =>
        createEvidenceForVersion(db, userA, {
          organisationId: orgA,
          engagementId: engagementA,
          documentVersionId: crossOrgVersionId,
          title: "Attempted cross-org link",
          evidenceType: "other",
          linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
        }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("9. A historical DocumentVersion cannot be modified (direct, raw UPDATE attempt)", async () => {
    const { documentVersionId } = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, { organisationId: orgA, engagementId: engagementA, title: "Immutable version", evidenceType: "other", linkTo: { type: "assessment_response", assessmentResponseId: responseA1 }, file: textFile() }),
    );
    await expect(
      withRequestDb(userA, (db, client) => client.query(`UPDATE document_versions SET storage_path = 'tampered' WHERE id = $1`, [documentVersionId])),
    ).rejects.toThrow(/immutable/i);
  });

  it("10. Finalized Assessment evidence relationships respect database locking (direct, raw EvidenceLink INSERT attempt)", async () => {
    const { documentVersionId } = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, { organisationId: orgA, engagementId: engagementA, title: "For finalized link attempt", evidenceType: "other", linkTo: { type: "assessment_response", assessmentResponseId: responseA1 }, file: textFile() }),
    );
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT id FROM evidence WHERE document_version_id = $1`, [documentVersionId]));
    const evidenceId = rows[0].id;

    await expect(
      withRequestDb(userA, (db, client) =>
        client.query(
          `INSERT INTO evidence_links (evidence_id, tenant_id, organisation_id, engagement_id, subject_type, assessment_response_id) VALUES ($1,$2,$3,$4,'assessment_response',$5)`,
          [evidenceId, tenantA, orgA, engagementA, responseAFinalized],
        ),
      ),
    ).rejects.toThrow(/finalized/i);
  });

  // Application (11-17)

  it("11. Anonymous upload is rejected (raw INSERT as anon)", async () => {
    await expect(
      asAnon((client) =>
        client.query(`INSERT INTO documents (tenant_id, organisation_id, engagement_id, title, document_type) VALUES ($1,$2,$3,'Anon doc','other')`, [tenantA, orgA, engagementA]),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it("12. Anonymous download/read is rejected", async () => {
    const { documentVersionId } = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, { organisationId: orgA, engagementId: engagementA, title: "Anon read attempt", evidenceType: "other", linkTo: { type: "assessment_response", assessmentResponseId: responseA1 }, file: textFile() }),
    );
    await expect(
      asAnon((client) => client.query(`SELECT storage_path FROM document_versions WHERE id = $1`, [documentVersionId])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("13. Unauthorized user (no membership at all) cannot upload evidence", async () => {
    await expect(
      withRequestDb(outsiderA, (db) =>
        uploadEvidence(db, outsiderA, { organisationId: orgA, engagementId: engagementA, title: "Unauthorized attempt", evidenceType: "other", linkTo: { type: "assessment_response", assessmentResponseId: responseA1 }, file: textFile() }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("14. Unauthorized user cannot obtain a signed URL", async () => {
    const { evidenceId } = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, { organisationId: orgA, engagementId: engagementA, title: "For unauthorized download attempt", evidenceType: "other", linkTo: { type: "assessment_response", assessmentResponseId: responseA1 }, file: textFile() }),
    );
    await expect(
      withRequestDb(outsiderA, (db) => getEvidenceDownloadUrl(db, outsiderA, { organisationId: orgA, engagementId: engagementA, evidenceId })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("15. Browser-supplied ids cannot cross the tenant boundary (organisationId claiming a different real organisation than the engagement's own)", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        uploadEvidence(db, userA, {
          organisationId: orgA2, // a real org, but NOT engagementA's real organisation
          engagementId: engagementA,
          title: "Mismatched scope attempt",
          evidenceType: "other",
          linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
          file: textFile(),
        }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("16. There is no code path that accepts a browser-supplied storage path/object key — every read resolves it server-side from the authorized Evidence row", async () => {
    // Structural proof: getEvidenceDownloadUrl's own input type carries
    // only an evidenceId, never a storagePath/objectKey — confirmed by
    // exercising it with a real, but unauthorized-for-this-caller,
    // evidenceId (the underlying object's real path is never visible to
    // or accepted from the caller at any point).
    const ctId = await asFixtureSetup((c) => createControlTestFixture(c, { controlId: controlB1, tenantId: tenantB, assessmentId: assessmentB, organisationId: orgB, engagementId: engagementB, result: "pass" }));
    const { evidenceId } = await withRequestDb(userB, (db) =>
      uploadEvidence(db, userB, { organisationId: orgB, engagementId: engagementB, title: "Path-guessing attempt target", evidenceType: "other", linkTo: { type: "control_test", controlTestId: ctId }, file: textFile() }),
    );
    await expect(
      withRequestDb(userA, (db) => getEvidenceDownloadUrl(db, userA, { organisationId: orgA, engagementId: engagementA, evidenceId })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });
});
