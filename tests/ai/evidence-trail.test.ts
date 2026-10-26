// The AI "evidence trail": every suggestion records what the AI read, who supplied it,
// through which screen, and why it was chosen. Real PostgreSQL, real row-level security.
import { beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { uploadEvidence } from "@/lib/domain/evidence";
import { createEngagementScope } from "@/lib/domain/applicability";
import { saveAiSettings } from "@/lib/ai/settings";
import { enqueueJob } from "@/lib/ai/queue";
import { runOnce } from "@/lib/ai/worker";
import { listSuggestions } from "@/lib/ai/suggestions";
import { actorMap } from "@/lib/ai/provenance";
import { loadInventory } from "@/lib/ai/inventory";
import { asFixtureSetup, createOrganisation, createUser, pool } from "../app/helpers";
import { buildAiFixture, GOOD_POLICY_TEXT, type AiFixture } from "./helpers";
import type { Source } from "@/lib/ai/types";

describe("AI evidence trail", () => {
  let f: AiFixture;
  let evidenceId: string;
  let clientUser: string;
  let otherClientUser: string;

  beforeAll(async () => {
    f = await buildAiFixture("AI Trail");
    await withRequestDb(f.emId, (db) => createEngagementScope(db, f.emId, { engagementId: f.engagementId }));
    await asFixtureSetup(async (c) => {
      clientUser = await createUser(c, { tenantId: f.tenantId, clientOrgId: f.organisationId });
      const other = await createOrganisation(c, f.tenantId, "Some other client");
      otherClientUser = await createUser(c, { tenantId: f.tenantId, clientOrgId: other });
    });
    await withRequestDb(f.emId, (db) =>
      saveAiSettings(db, f.emId, {
        engagementId: f.engagementId, organisationId: f.organisationId, enabled: true, level: 3, thresholdSupervised: 0.9, thresholdFull: 0.75,
        gates: { rejectCriticalEvidence: true, releaseCriticalFindings: true, issueFinalReport: true, sendBreachNotices: true }, allowExternalAi: false,
      }),
    );
    evidenceId = (
      await withRequestDb(f.emId, (db) =>
        uploadEvidence(db, f.emId, {
          organisationId: f.organisationId, engagementId: f.engagementId, title: "Privacy policy", evidenceType: "policy_document",
          linkTo: { type: "assessment_response", assessmentResponseId: f.responseIds.policy! },
          file: { buffer: Buffer.from(GOOD_POLICY_TEXT, "utf8"), filename: "privacy-policy.txt", mimeType: "text/plain" },
        }),
      )
    ).evidenceId;
    await withRequestDb(f.emId, (db) => enqueueJob(db, { tenantId: f.tenantId, organisationId: f.organisationId, engagementId: f.engagementId, kind: "plan", payload: { full: true }, dedupeKey: "plan", requestedBy: f.emId }));
    for (let i = 0; i < 60 && (await runOnce("trail-worker", () => {})); i++);
  });

  it("every suggestion the AI made records its sources", async () => {
    const all = await withRequestDb(f.emId, (db) => listSuggestions(db, f.engagementId));
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) expect((s.sources as Source[]).length, `${s.kind}: ${s.title}`).toBeGreaterThan(0);
  });

  it("the evidence review names the document, who uploaded it, the screen, and why it was chosen", async () => {
    const all = await withRequestDb(f.emId, (db) => listSuggestions(db, f.engagementId));
    const review = all.find((s) => s.kind === "evidence_review" && s.subjectId === evidenceId)!;
    const doc = (review.sources as Source[]).find((x) => x.type === "document")!;
    expect(doc.label).toContain("privacy-policy.txt");
    expect(doc.providedBy?.side).toBe("primus");
    expect(doc.channel).toMatch(/Primus workspace/);
    expect(doc.origin).toMatch(/Uploaded by/);
    expect(doc.why.length).toBeGreaterThan(10);
    expect(doc.excerpt).toBeTruthy();
    expect(doc.ref).toBe(evidenceId);
  });

  it("the trail cannot be edited after the fact", async () => {
    const all = await withRequestDb(f.emId, (db) => listSuggestions(db, f.engagementId));
    await expect(asFixtureSetup((c) => c.query(`UPDATE ai_suggestions SET sources = '[]'::jsonb WHERE id = $1`, [all[0]!.id]))).rejects.toThrow(/immutable/);
  });

  it("tells Primus people from client people, and never reveals someone from another client", async () => {
    const map = await withRequestDb(f.emId, (db) => actorMap(db, f.engagementId, [f.consultantId, clientUser, otherClientUser, f.agentId]));
    expect(map.get(f.consultantId)?.side).toBe("primus");
    expect(map.get(clientUser)?.side).toBe("client");
    expect(map.get(otherClientUser)).toBeUndefined();
    expect(map.get(f.agentId)?.side).toBe("system");
  });

  it("the agent cannot read the users table, only the narrow name function", async () => {
    const direct = await withRequestDb(f.agentId, (db) => db.execute(`SELECT id FROM users WHERE id = '${clientUser}'` as never));
    expect((direct as unknown as { rows: unknown[] }).rows.length).toBe(0);
    await expect(withRequestDb(f.consultantId, (db) => actorMap(db, "00000000-0000-0000-0000-000000000000", [clientUser]))).rejects.toThrow();
  });

  it("the inventory lists what the AI can read, with provider and how many outputs used it", async () => {
    const items = await withRequestDb(f.emId, (db) => loadInventory(db, f.organisationId, f.engagementId));
    const doc = items.find((i) => i.group === "documents" && i.ref === evidenceId)!;
    expect(doc.provider?.side).toBe("primus");
    expect(doc.usedIn.length).toBeGreaterThan(0);
    expect(items.some((i) => i.group === "answers")).toBe(true);
  });
});
void pool;
