// Released reports, data-principal request log (rights) and the audit trail.
import { beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { getReleasedReportFile, listReleasedReports, releaseReport } from "@/lib/workspace/reports";
import { listRightsRequests, logRightsRequest, setRightsStatus } from "@/lib/workspace/rights";
import { engagementAuditTrail } from "@/lib/workspace/audit";
import { releaseFindings } from "@/lib/workspace/review";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { WorkspaceInputError } from "@/lib/workspace/common";
import { buildWorkspaceFixture, insertFinding, pool, type WsFixture } from "./helpers";

describe("released reports", () => {
  let f: WsFixture;
  beforeAll(async () => {
    f = await buildWorkspaceFixture("Rep");
    await insertFinding(f, { title: "SECRET-DRAFT-FINDING", released: false });
    await insertFinding(f, { title: "Visible finding", released: true });
  });

  it("only a person with the report permission can release; clients and the AI cannot", async () => {
    for (const u of [f.clientAdminId, f.consultantId, f.auditorId]) {
      await expect(withRequestDb(u, (db) => releaseReport(db, u, { organisationId: f.organisationId, engagementId: f.engagementId, userEmail: null }))).rejects.toThrow(NotFoundOrForbiddenError);
    }
    await expect(withRequestDb(f.agentId, (db) => releaseReport(db, f.agentId, { organisationId: f.organisationId, engagementId: f.engagementId, userEmail: null }))).rejects.toThrow();
  });

  it("the Engagement Manager releases a versioned PDF snapshot; the client is told and can download it", async () => {
    const a = await withRequestDb(f.emId, (db) => releaseReport(db, f.emId, { organisationId: f.organisationId, engagementId: f.engagementId, userEmail: "em@example.test" }));
    expect(a.version).toBe(1);
    const b = await withRequestDb(f.emId, (db) => releaseReport(db, f.emId, { organisationId: f.organisationId, engagementId: f.engagementId, userEmail: "em@example.test", title: "Second issue" }));
    expect(b.version).toBe(2);
    const list = await withRequestDb(f.clientAdminId, (db) => listReleasedReports(db, {}));
    expect(list.map((r) => r.version).sort()).toEqual([1, 2]);
    const file = await withRequestDb(f.clientAdminId, (db) => getReleasedReportFile(db, a.id));
    expect(file.content.subarray(0, 5).toString()).toBe("%PDF-");
    // A draft finding's title is not inside the client's copy.
    expect(file.content.toString("latin1")).not.toContain("SECRET-DRAFT-FINDING");
    const n = await pool.query("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'report_released'", [f.clientAdminId]);
    expect(n.rowCount).toBe(2);
  });

  it("a snapshot cannot be altered or removed, and another organisation cannot see or fetch it", async () => {
    const [r] = await withRequestDb(f.emId, (db) => listReleasedReports(db, {}));
    const c = await pool.connect();
    try {
      for (const sql of ["UPDATE report_releases SET title = 'x' WHERE id = $1", "DELETE FROM report_releases WHERE id = $1"]) {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE authenticated");
        await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [f.emId]);
        await expect(c.query(sql, [r!.id])).rejects.toThrow();
        await c.query("ROLLBACK");
      }
    } finally {
      c.release();
    }
    expect(await withRequestDb(f.otherClientId, (db) => listReleasedReports(db, {}))).toHaveLength(0);
    await expect(withRequestDb(f.otherClientId, (db) => getReleasedReportFile(db, r!.id))).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(withRequestDb(f.clientAdminId, (db) => getReleasedReportFile(db, "not-a-uuid"))).rejects.toThrow(NotFoundOrForbiddenError);
  });
});

describe("data-principal request log", () => {
  let f: WsFixture;
  const scope = () => ({ engagementId: f.engagementId });
  beforeAll(async () => {
    f = await buildWorkspaceFixture("Rights");
  });

  it("a client administrator logs a request with a 90-day default clock and a numbered reference", async () => {
    const r = await withRequestDb(f.clientAdminId, (db) => logRightsRequest(db, f.clientAdminId, { ...scope(), title: "Customer wants a copy of data", requestType: "access", channel: "email", receivedOn: "2026-10-01" }));
    expect(r.reference).toBe("RR-2026-0001");
    const list = await withRequestDb(f.clientAdminId, (db) => listRightsRequests(db, f.engagementId));
    expect(list).toHaveLength(1);
    expect(Math.round((list[0]!.dueAt!.getTime() - list[0]!.receivedAt.getTime()) / 86400_000)).toBe(90);
  });

  it("validates the input", async () => {
    await expect(withRequestDb(f.clientAdminId, (db) => logRightsRequest(db, f.clientAdminId, { ...scope(), title: "", requestType: "access", channel: "email" }))).rejects.toThrow(WorkspaceInputError);
    await expect(withRequestDb(f.clientAdminId, (db) => logRightsRequest(db, f.clientAdminId, { ...scope(), title: "x", requestType: "bogus", channel: "email" }))).rejects.toThrow(WorkspaceInputError);
    await expect(withRequestDb(f.clientAdminId, (db) => logRightsRequest(db, f.clientAdminId, { ...scope(), title: "x", requestType: "access", channel: "email", receivedOn: "2026-10-10", dueOn: "2026-10-01" }))).rejects.toThrow(WorkspaceInputError);
  });

  it("a read-only executive can view but not log or close; a business owner has no access", async () => {
    expect(await withRequestDb(f.cxoId, (db) => listRightsRequests(db, f.engagementId))).toHaveLength(1);
    await expect(withRequestDb(f.cxoId, (db) => logRightsRequest(db, f.cxoId, { ...scope(), title: "x", requestType: "access", channel: "email" }))).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(withRequestDb(f.businessOwnerId, (db) => listRightsRequests(db, f.engagementId))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("another organisation cannot see or change the requests", async () => {
    await expect(withRequestDb(f.otherClientId, (db) => listRightsRequests(db, f.engagementId))).rejects.toThrow(NotFoundOrForbiddenError);
    const [r] = await withRequestDb(f.clientAdminId, (db) => listRightsRequests(db, f.engagementId));
    await expect(withRequestDb(f.otherClientId, (db) => setRightsStatus(db, f.otherClientId, { caseId: r!.id, status: "closed", engagementId: f.otherEngagementId }))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("the client can move a request to in progress and close it, but not reopen it", async () => {
    const [r] = await withRequestDb(f.clientAdminId, (db) => listRightsRequests(db, f.engagementId));
    await withRequestDb(f.clientAdminId, (db) => setRightsStatus(db, f.clientAdminId, { caseId: r!.id, status: "in_progress", engagementId: f.engagementId }));
    await withRequestDb(f.clientAdminId, (db) => setRightsStatus(db, f.clientAdminId, { caseId: r!.id, status: "closed", engagementId: f.engagementId }));
    await expect(withRequestDb(f.clientAdminId, (db) => setRightsStatus(db, f.clientAdminId, { caseId: r!.id, status: "in_progress", engagementId: f.engagementId }))).rejects.toThrow(WorkspaceInputError);
  });

  it("a client never reads the underlying case table (it also holds the AI's draft)", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [f.clientAdminId]);
      const r = await c.query("SELECT 1 FROM ops_cases WHERE engagement_id = $1", [f.engagementId]);
      expect(r.rowCount).toBe(0);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });
});

describe("audit trail", () => {
  let f: WsFixture;
  beforeAll(async () => {
    f = await buildWorkspaceFixture("Audit");
    const id = await insertFinding(f, { title: "Audited finding", released: false });
    await withRequestDb(f.emId, (db) => releaseFindings(db, f.emId, { engagementId: f.engagementId, findingIds: [id] }));
  });

  it("people with the audit permission read the change history of their engagement", async () => {
    for (const u of [f.emId, f.consultantId, f.auditorId]) {
      const rows = await withRequestDb(u, (db) => engagementAuditTrail(db, u, f.engagementId));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.entityType === "findings" && r.changedFields.includes("released_at"))).toBe(true);
    }
  });

  it("clients, other organisations and the unrelated cannot read it", async () => {
    for (const u of [f.clientAdminId, f.businessOwnerId, f.cxoId]) {
      await expect(withRequestDb(u, (db) => engagementAuditTrail(db, u, f.engagementId))).rejects.toThrow(NotFoundOrForbiddenError);
    }
    await expect(withRequestDb(f.otherClientId, (db) => engagementAuditTrail(db, f.otherClientId, f.engagementId))).rejects.toThrow(NotFoundOrForbiddenError);
  });
});
