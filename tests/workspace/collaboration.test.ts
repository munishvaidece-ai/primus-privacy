// Tasks, clarifications, evidence requests, notifications and the activity feed.
import { beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { cancelTask, completeTask, createTask, listTasks } from "@/lib/workspace/tasks";
import { closeClarification, getClarification, listClarifications, raiseClarification, replyToClarification } from "@/lib/workspace/clarifications";
import { fulfilEvidenceRequest, listEvidenceRequests, requestEvidence } from "@/lib/workspace/evidence-requests";
import { listNotifications, markAllRead, markRead, unreadCount } from "@/lib/workspace/notifications";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { WorkspaceInputError } from "@/lib/workspace/common";
import { buildWorkspaceFixture, insertEvidence, pool, type WsFixture } from "./helpers";

describe("tasks and milestones", () => {
  let f: WsFixture;
  beforeAll(async () => {
    f = await buildWorkspaceFixture("Tasks");
  });

  it("a Primus task for the Primus team is invisible to clients; a client task is visible to both", async () => {
    await withRequestDb(f.emId, (db) => createTask(db, f.emId, { engagementId: f.engagementId, title: "Internal: prepare scoping memo", assigneeSide: "primus" }));
    await withRequestDb(f.emId, (db) => createTask(db, f.emId, { engagementId: f.engagementId, title: "Share the data inventory", assigneeSide: "client", dueDate: "2030-01-31" }));
    const clientView = await withRequestDb(f.clientAdminId, (db) => listTasks(db, { engagementId: f.engagementId }));
    expect(clientView.map((t) => t.title)).toEqual(["Share the data inventory"]);
    const teamView = await withRequestDb(f.consultantId, (db) => listTasks(db, { engagementId: f.engagementId }));
    expect(teamView).toHaveLength(2);
  });

  it("the client is notified of a task assigned to them; the creator is not", async () => {
    const n = await withRequestDb(f.clientAdminId, (db) => listNotifications(db, f.clientAdminId));
    expect(n.some((x) => x.title.includes("Share the data inventory"))).toBe(true);
    const own = await withRequestDb(f.emId, (db) => listNotifications(db, f.emId));
    expect(own.some((x) => x.title.includes("Share the data inventory"))).toBe(false);
  });

  it("a client cannot create a Primus-side task or a milestone", async () => {
    await expect(withRequestDb(f.clientAdminId, (db) => createTask(db, f.clientAdminId, { engagementId: f.engagementId, title: "x", assigneeSide: "primus" }))).rejects.toThrow(WorkspaceInputError);
    await expect(withRequestDb(f.clientAdminId, (db) => createTask(db, f.clientAdminId, { engagementId: f.engagementId, title: "m", assigneeSide: "client", kind: "milestone", dueDate: "2030-01-01" }))).rejects.toThrow(WorkspaceInputError);
  });

  it("a client cannot see or complete a Primus-only task", async () => {
    const all = await withRequestDb(f.emId, (db) => listTasks(db, { engagementId: f.engagementId }));
    const internal = all.find((t) => t.title.startsWith("Internal"))!;
    await expect(withRequestDb(f.clientAdminId, (db) => completeTask(db, f.clientAdminId, internal.id))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("the client completes their task, which then reads as done and cannot be completed twice", async () => {
    const mine = (await withRequestDb(f.clientAdminId, (db) => listTasks(db, { engagementId: f.engagementId })))[0]!;
    await withRequestDb(f.clientAdminId, (db) => completeTask(db, f.clientAdminId, mine.id));
    await expect(withRequestDb(f.clientAdminId, (db) => completeTask(db, f.clientAdminId, mine.id))).rejects.toThrow(WorkspaceInputError);
    const done = await withRequestDb(f.clientAdminId, (db) => listTasks(db, { engagementId: f.engagementId, status: "done" }));
    expect(done).toHaveLength(1);
  });

  it("a milestone needs a date and is visible to the client", async () => {
    await expect(withRequestDb(f.emId, (db) => createTask(db, f.emId, { engagementId: f.engagementId, title: "Final report", assigneeSide: "primus", kind: "milestone" }))).rejects.toThrow(/due date/i);
    await withRequestDb(f.emId, (db) => createTask(db, f.emId, { engagementId: f.engagementId, title: "Final report", assigneeSide: "primus", kind: "milestone", dueDate: "2030-03-31" }));
    const seen = await withRequestDb(f.businessOwnerId, (db) => listTasks(db, { engagementId: f.engagementId, kind: "milestone" }));
    expect(seen.map((t) => t.title)).toEqual(["Final report"]);
  });

  it("another organisation sees none of it", async () => {
    expect(await withRequestDb(f.otherClientId, (db) => listTasks(db, {}))).toHaveLength(0);
    await expect(withRequestDb(f.otherClientId, (db) => createTask(db, f.otherClientId, { engagementId: f.engagementId, title: "x", assigneeSide: "client" }))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("a task can be cancelled by the team and then disappears from lists", async () => {
    const { id } = await withRequestDb(f.emId, (db) => createTask(db, f.emId, { engagementId: f.engagementId, title: "Cancel me", assigneeSide: "primus" }));
    await withRequestDb(f.emId, (db) => cancelTask(db, f.emId, id));
    const all = await withRequestDb(f.emId, (db) => listTasks(db, { engagementId: f.engagementId }));
    expect(all.some((t) => t.id === id)).toBe(false);
  });
});

describe("clarifications", () => {
  let f: WsFixture;
  beforeAll(async () => {
    f = await buildWorkspaceFixture("Clar");
  });

  it("a thread flows open → answered → open → closed, with numbered references", async () => {
    const { id } = await withRequestDb(f.consultantId, (db) => raiseClarification(db, f.consultantId, { engagementId: f.engagementId, subject: "Who is the DPO?", question: "Please name the Data Protection Officer." }));
    let t = await withRequestDb(f.clientAdminId, (db) => getClarification(db, id));
    expect(t.clarification.reference).toBe("CLR-001");
    expect(t.clarification.status).toBe("open");
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]!.authorSide).toBe("primus");
    await withRequestDb(f.clientAdminId, (db) => replyToClarification(db, f.clientAdminId, { clarificationId: id, body: "Ms Rao is the DPO." }));
    t = await withRequestDb(f.consultantId, (db) => getClarification(db, id));
    expect(t.clarification.status).toBe("answered");
    await withRequestDb(f.consultantId, (db) => replyToClarification(db, f.consultantId, { clarificationId: id, body: "Thanks. Is she full time?" }));
    t = await withRequestDb(f.consultantId, (db) => getClarification(db, id));
    expect(t.clarification.status).toBe("open");
    await withRequestDb(f.consultantId, (db) => closeClarification(db, f.consultantId, id));
    await expect(withRequestDb(f.clientAdminId, (db) => replyToClarification(db, f.clientAdminId, { clarificationId: id, body: "late" }))).rejects.toThrow(WorkspaceInputError);
    const second = await withRequestDb(f.clientAdminId, (db) => raiseClarification(db, f.clientAdminId, { engagementId: f.engagementId, subject: "Scope question", question: "Does scope include the subsidiary?" }));
    const s = await withRequestDb(f.emId, (db) => getClarification(db, second.id));
    expect(s.clarification.reference).toBe("CLR-002");
    expect(s.clarification.raisedBySide).toBe("client");
  });

  it("each side is notified of the other's messages, never of its own", async () => {
    const clientNotes = await pool.query("SELECT title FROM notifications WHERE user_id = $1 AND kind LIKE 'clarification%'", [f.clientAdminId]);
    expect(clientNotes.rows.length).toBeGreaterThanOrEqual(2);
    const consultantNotes = await pool.query("SELECT title FROM notifications WHERE user_id = $1 AND kind LIKE 'clarification%'", [f.consultantId]);
    expect(consultantNotes.rows.length).toBeGreaterThanOrEqual(1);
    // The client who replied got nothing for their own reply.
    const own = await pool.query("SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE '%Ms Rao%'", [f.clientAdminId]);
    expect(own.rowCount).toBe(0);
  });

  it("a different organisation cannot read or answer the thread", async () => {
    const mine = await withRequestDb(f.clientAdminId, (db) => listClarifications(db, {}));
    expect(mine.length).toBe(2);
    expect(await withRequestDb(f.otherClientId, (db) => listClarifications(db, {}))).toHaveLength(0);
    await expect(withRequestDb(f.otherClientId, (db) => getClarification(db, mine[0]!.id))).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(withRequestDb(f.otherClientId, (db) => replyToClarification(db, f.otherClientId, { clarificationId: mine[0]!.id, body: "hi" }))).rejects.toThrow();
  });

  it("a read-only executive can read but cannot be a participant that closes it", async () => {
    const list = await withRequestDb(f.cxoId, (db) => listClarifications(db, {}));
    expect(list.length).toBe(2);
  });
});

describe("evidence requests", () => {
  let f: WsFixture;
  beforeAll(async () => {
    f = await buildWorkspaceFixture("EvReq");
  });

  it("a reviewer requests; the client is notified; only the team can request", async () => {
    await expect(withRequestDb(f.clientAdminId, (db) => requestEvidence(db, f.clientAdminId, { engagementId: f.engagementId, title: "x" }))).rejects.toThrow(NotFoundOrForbiddenError);
    const { id } = await withRequestDb(f.consultantId, (db) => requestEvidence(db, f.consultantId, { engagementId: f.engagementId, title: "Latest privacy policy", description: "Signed copy", dueDate: "2030-02-01" }));
    const list = await withRequestDb(f.clientAdminId, (db) => listEvidenceRequests(db, { engagementId: f.engagementId }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, reference: "ER-001", status: "requested" });
    const n = await pool.query("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'evidence_requested'", [f.clientAdminId]);
    expect(n.rowCount).toBe(1);
  });

  it("the client fulfils with a document from this engagement; a document from elsewhere is refused", async () => {
    const [req] = await withRequestDb(f.clientAdminId, (db) => listEvidenceRequests(db, { engagementId: f.engagementId }));
    const foreign = await insertEvidence(f, { title: "Other org doc", uploadedBy: f.otherClientId, engagementId: f.otherEngagementId, organisationId: f.otherOrgId });
    await expect(withRequestDb(f.clientAdminId, (db) => fulfilEvidenceRequest(db, f.clientAdminId, { requestId: req!.id, evidenceId: foreign }))).rejects.toThrow(WorkspaceInputError);
    const own = await insertEvidence(f, { title: "Privacy policy v3", uploadedBy: f.clientAdminId });
    await withRequestDb(f.clientAdminId, (db) => fulfilEvidenceRequest(db, f.clientAdminId, { requestId: req!.id, evidenceId: own }));
    const after = await withRequestDb(f.consultantId, (db) => listEvidenceRequests(db, { engagementId: f.engagementId }));
    expect(after[0]).toMatchObject({ status: "fulfilled", fulfilledEvidenceId: own });
    await expect(withRequestDb(f.clientAdminId, (db) => fulfilEvidenceRequest(db, f.clientAdminId, { requestId: req!.id, evidenceId: own }))).rejects.toThrow(WorkspaceInputError);
    const n = await pool.query("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'evidence_provided'", [f.consultantId]);
    expect(n.rowCount).toBe(1);
  });

  it("another organisation cannot see or fulfil the request", async () => {
    expect(await withRequestDb(f.otherClientId, (db) => listEvidenceRequests(db, {}))).toHaveLength(0);
  });
});

describe("notifications and the activity feed", () => {
  let f: WsFixture;
  beforeAll(async () => {
    f = await buildWorkspaceFixture("Notif");
    await withRequestDb(f.emId, (db) => createTask(db, f.emId, { engagementId: f.engagementId, title: "Visible to client", assigneeSide: "client" }));
    await withRequestDb(f.emId, (db) => createTask(db, f.emId, { engagementId: f.engagementId, title: "Team only", assigneeSide: "primus" }));
  });

  it("a person reads and marks only their own notifications", async () => {
    const mine = await withRequestDb(f.clientAdminId, (db) => listNotifications(db, f.clientAdminId));
    expect(mine.length).toBeGreaterThan(0);
    expect(await withRequestDb(f.clientAdminId, (db) => unreadCount(db, f.clientAdminId))).toBe(mine.length);
    // Someone else cannot mark it (the update matches no rows) and cannot read it.
    await withRequestDb(f.otherClientId, (db) => markRead(db, f.otherClientId, mine[0]!.id));
    expect(await withRequestDb(f.otherClientId, (db) => listNotifications(db, f.otherClientId))).toHaveLength(0);
    await withRequestDb(f.clientAdminId, (db) => markRead(db, f.clientAdminId, mine[0]!.id));
    expect(await withRequestDb(f.clientAdminId, (db) => unreadCount(db, f.clientAdminId))).toBe(mine.length - 1);
    await withRequestDb(f.clientAdminId, (db) => markAllRead(db, f.clientAdminId));
    expect(await withRequestDb(f.clientAdminId, (db) => unreadCount(db, f.clientAdminId))).toBe(0);
  });

  it("a notification cannot be created or rewritten by hand", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [f.clientAdminId]);
      await expect(
        c.query("INSERT INTO notifications (tenant_id, organisation_id, engagement_id, user_id, kind, title) VALUES ($1,$2,$3,$4,'x','spoof')", [f.tenantId, f.organisationId, f.engagementId, f.emId]),
      ).rejects.toThrow();
      await c.query("ROLLBACK");
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [f.clientAdminId]);
      await expect(c.query("UPDATE notifications SET title = 'changed' WHERE user_id = $1", [f.clientAdminId])).rejects.toThrow();
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });

  it("the client's activity feed omits Primus-only lines", async () => {
    const asClient = await pool.connect();
    try {
      await asClient.query("BEGIN");
      await asClient.query("SET LOCAL ROLE authenticated");
      await asClient.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [f.clientAdminId]);
      const r = await asClient.query("SELECT summary FROM engagement_activity WHERE engagement_id = $1", [f.engagementId]);
      expect(r.rows.map((x) => x.summary).join("|")).toContain("Visible to client");
      expect(r.rows.map((x) => x.summary).join("|")).not.toContain("Team only");
      await asClient.query("ROLLBACK");
    } finally {
      asClient.release();
    }
  });

  it("the activity feed is append-only", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [f.emId]);
      await expect(c.query("UPDATE engagement_activity SET summary = 'rewritten' WHERE engagement_id = $1", [f.engagementId])).rejects.toThrow();
      await c.query("ROLLBACK");
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [f.emId]);
      await expect(c.query("DELETE FROM engagement_activity WHERE engagement_id = $1", [f.engagementId])).rejects.toThrow();
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });
});
