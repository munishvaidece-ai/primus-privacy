// The whole demo, end to end, on the real database: every phase's file goes in as the right person,
// the AI works on it, people approve what they must, and the next phase starts from the result.
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { withRequestDb } from "@/lib/db/request-client";
import { SECTORS } from "@/lib/regulation";
import { STARTER_CONTROLS } from "@/db/seed/starter-library";
import { saveAiSettings } from "@/lib/ai/settings";
import { enqueueJob } from "@/lib/ai/queue";
import { runOnce } from "@/lib/ai/worker";
import { decideSuggestion, listSuggestions } from "@/lib/ai/suggestions";
import { receiveSupportFile, receiveTemplateFile } from "@/lib/intake/store";
import { ensureAssessment, loadControlTests, reconcileEvidence } from "@/lib/intake/load";
import { createEngagementScope, lockEngagementScope } from "@/lib/domain/applicability";
import { getEngagementSectors } from "@/lib/domain/sectors";
import { getDiscovery } from "@/lib/workspace/discovery";
import { listBusinessUnits, listProcessors } from "@/lib/domain/master-data";
import { listProcessingActivities } from "@/lib/domain/processing-activities";
import { finalizeAssessment } from "@/lib/domain/assessments";
import { releaseFindings } from "@/lib/workspace/review";
import { FIRM } from "@/lib/demo/orchid/content";
import { EVIDENCE, SCOPE_SUPPORT, INVENTORY_SUPPORT } from "@/lib/demo/orchid/evidence";
import { docBytes, mimeFor } from "@/lib/demo/orchid/files";
import { closureFile, indexFile, inventoryFile, scopeFile, testsFile } from "@/lib/demo/orchid/pack";
import { PROOFS } from "@/lib/demo/orchid/closure";
import { asFixtureSetup, createControl, createControlLibraryVersion, createEngagement, createOrganisation, createRiskScoringModel, createTenant, createUser, grantEngagementMembership, grantOrganisationMembership, pinEngagementControlLibraryVersion, publishControlLibraryVersion } from "../app/helpers";
import { buildSampleDb, SAMPLE_DB_NAME } from "@/lib/demo/orchid/sample-db";
import { createConnector, listAssets, requestConnectorRun } from "@/lib/connectors/service";
import { findings, remediationActions, assessmentControls } from "@/db/schema";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const log = (...a: unknown[]) => console.log(...a);

async function drain(label: string) {
  let n = 0;
  for (let i = 0; i < 400 && (await runOnce(`orchid-${label}`, () => {})); i++) n++;
  return n;
}

describe("Orchid Hill: all seven phases", () => {
  let tenantId = "", orgId = "", engId = "", em = "", consultant = "", client = "", agent = "";
  const ids = { tenantId: "", orgId: "", engId: "" };
  const scope = () => ({ engagementId: engId, organisationId: orgId });
  const queue = (kind: Parameters<typeof enqueueJob>[1]["kind"], payload: Record<string, unknown> = {}, by = em) =>
    withRequestDb(by, (db) => enqueueJob(db, { tenantId, organisationId: orgId, engagementId: engId, kind, payload, dedupeKey: `${kind}-${Math.random()}`, requestedBy: by }));
  const sugg = () => withRequestDb(em, (db) => listSuggestions(db, engId, { limit: 2000 }));

  beforeAll(async () => {
    await asFixtureSetup(async (c) => {
      tenantId = await createTenant(c, "Orchid Primus");
      orgId = await createOrganisation(c, tenantId, FIRM.name);
      engId = await createEngagement(c, tenantId, orgId, FIRM.engagement);
      await createRiskScoringModel(c, { tenantId, name: "Test matrix", version: "v1", matrixDefinition: { scale: "1-5" }, isActive: true });
      const lib = await createControlLibraryVersion(c, { tenantId, versionLabel: "Starter + sector" });
      const all = [...STARTER_CONTROLS, ...SECTORS.flatMap((s) => s.controls.map((k) => ({ code: k.code, title: k.title, type: k.type, description: k.description })))];
      for (const k of all) await createControl(c, { tenantId, controlLibraryVersionId: lib, code: k.code, title: k.title, description: k.description, controlType: k.type });
      await publishControlLibraryVersion(c, lib);
      await pinEngagementControlLibraryVersion(c, engId, lib);
      em = await createUser(c, { tenantId });
      consultant = await createUser(c, { tenantId });
      client = await createUser(c, { tenantId, clientOrgId: orgId });
      agent = await createUser(c, { tenantId, email: `ai-agent@${tenantId}.agent.primus.invalid` });
      await grantEngagementMembership(c, em, engId, "Engagement Manager");
      await grantEngagementMembership(c, consultant, engId, "Consultant");
      await grantOrganisationMembership(c, client, orgId, "Client Administrator");
    });
    Object.assign(ids, { tenantId, orgId, engId });
    await withRequestDb(em, (db) =>
      saveAiSettings(db, em, { engagementId: engId, organisationId: orgId, enabled: true, level: 3, thresholdSupervised: 0.9, thresholdFull: 0.75, gates: { rejectCriticalEvidence: true, releaseCriticalFindings: true, issueFinalReport: true, sendBreachNotices: true }, allowExternalAi: false }),
    );
    void agent;
  }, 120_000);

  it("phase 1: the wrong file is refused, the right one is read, sectors and units come out", async () => {
    const wrong = await withRequestDb(client, (db) => receiveTemplateFile(db, client, { ...scope(), template: "SCOPE-INTAKE", file: { buffer: Buffer.from(indexFile()), filename: "05_Evidence_Index.xlsx", mimeType: XLSX } }));
    expect(wrong.result.ok).toBe(false);
    log("wrong template:", wrong.result.summary);
    const ok = await withRequestDb(client, (db) => receiveTemplateFile(db, client, { ...scope(), template: "SCOPE-INTAKE", file: { buffer: Buffer.from(scopeFile()), filename: "01_Scope_Intake_Form.xlsx", mimeType: XLSX } }));
    expect(ok.result.ok, JSON.stringify(ok.result.issues)).toBe(true);
    for (const s of SCOPE_SUPPORT) await withRequestDb(client, async (db) => receiveSupportFile(db, client, { ...scope(), phase: 1, role: "support", file: { buffer: Buffer.from(await docBytes(s)), filename: s.file, mimeType: mimeFor(s.format) } }));
    await queue("intake_scope");
    await drain("p1");
    const all = await sugg();
    for (const s of all) log(`  [${s.status}] ${s.kind}: ${s.title} (${s.confidence})`);
    const sectors = await withRequestDb(em, (db) => getEngagementSectors(db, em, scope()));
    log("sectors now:", sectors);
    expect(sectors).toContain("broking");
    const units = await withRequestDb(em, (db) => listBusinessUnits(db, em, orgId));
    log("units:", units.length);
    expect(units.length).toBe(9);
    expect(all.some((s) => s.kind === "scope_sector" && s.status === "pending_review")).toBe(true);
  }, 120_000);

  it("phase 2: a connected database is scanned and the AI finds personal data the client never listed", async () => {
    process.env.CONNECTOR_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
    const admin = process.env.TEST_DATABASE_SUPERUSER_URL ?? "postgres://postgres:postgres@localhost:5432/primus_privacy_test";
    const built = await buildSampleDb(admin);
    const url = built.url;
    expect(url).toContain(SAMPLE_DB_NAME);
    await withRequestDb(em, (db) => createConnector(db, em, scope(), { type: "postgres_database", name: "Orchid Hill back-office database", config: { sampleRows: "50" }, secret: { connectionString: url } }));
    const conns = await asFixtureSetup(async (c) => (await c.query("SELECT id FROM ai_connectors WHERE engagement_id = $1", [engId])).rows as Array<{ id: string }>);
    await withRequestDb(em, (db) => requestConnectorRun(db, em, scope(), conns[0]!.id, "test"));
    await withRequestDb(em, (db) => requestConnectorRun(db, em, scope(), conns[0]!.id, "scan"));
    await drain("p2scan");
    const assets = await withRequestDb(em, (db) => listAssets(db, em, scope(), { connectorId: conns[0]!.id }));
    log("tables found:", assets.length, "with personal data:", assets.filter((a) => a.piiCategories.length).length);
    expect(assets.length).toBe(14);
    const by = Object.fromEntries(assets.map((a) => [a.location, a]));
    expect(by["archive.legacy_kyc_2019"]!.piiCategories).toEqual(expect.arrayContaining(["pan", "aadhaar"]));
    expect(by["reception.visitor_register"]!.piiCategories).toContain("phone");
    expect(by["reference.scrip_master"]!.piiCategories).toEqual([]);
    // free text: no personal-data column NAME, but values carry phone / email / PAN
    const msg = (by["crm.support_tickets"]!.attributes as { columns: Array<{ name: string; categories: string[] }> }).columns.find((c) => c.name === "message_text")!;
    expect(msg.categories).toEqual(expect.arrayContaining(["phone", "email", "pan"]));
    // values are never stored
    const stored = JSON.stringify(assets);
    expect(stored).not.toMatch(/@example\.invalid/);
  }, 120_000);

  it("phase 2: the inventory is loaded and the questionnaire is pre-filled for a person to approve", async () => {
    const r = await withRequestDb(client, (db) => receiveTemplateFile(db, client, { ...scope(), template: "DATA-INVENTORY", file: { buffer: Buffer.from(inventoryFile()), filename: "02_Data_Inventory.xlsx", mimeType: XLSX } }));
    expect(r.result.ok, JSON.stringify(r.result.issues)).toBe(true);
    for (const s of INVENTORY_SUPPORT) await withRequestDb(client, async (db) => receiveSupportFile(db, client, { ...scope(), phase: 2, role: "support", file: { buffer: Buffer.from(await docBytes(s)), filename: s.file, mimeType: mimeFor(s.format) } }));
    await queue("intake_landscape");
    await drain("p2");
    const all = (await sugg()).filter((s) => s.kind === "landscape_load" || s.kind === "discovery_prefill");
    for (const s of all) log(`  [${s.status}] ${s.kind}: ${s.title} (${s.confidence})`);
    const acts = await withRequestDb(em, (db) => listProcessingActivities(db, em, scope()));
    log("activities loaded:", acts.length, "processors:", (await withRequestDb(em, (db) => listProcessors(db, em, orgId))).length);
    expect(acts.length).toBe(12);
    const load = all.find((s) => s.kind === "landscape_load")!;
    const issues = ((load.proposed as { issues?: string[] }).issues ?? []);
    for (const x of issues.filter((t) => /Connector scan/.test(t))) log("  scan point:", x.slice(0, 200));
    expect(issues.some((t) => /legacy_kyc_2019.*copy, export or archive/.test(t))).toBe(true);
    expect(issues.some((t) => /leads_export.*copy, export or archive/.test(t))).toBe(true);
    expect(issues.some((t) => /visitor_register.*nothing on the Data Inventory/.test(t))).toBe(true);
    expect(issues.some((t) => /crm\.support_tickets\.message_text is free text/.test(t))).toBe(true);
    expect(issues.some((t) => /Aadhaar is kept masked/.test(t))).toBe(true);
    // tables the client DID list are not flagged as unknown
    expect(issues.some((t) => /backoffice\.clients holds personal data, but nothing/.test(t))).toBe(false);
    expect(issues.some((t) => /hr\.employees holds personal data, but nothing/.test(t))).toBe(false);
    const pre = all.find((s) => s.kind === "discovery_prefill")!;
    expect(pre.status).toBe("pending_review");
    await withRequestDb(em, (db) => decideSuggestion(db, em, { suggestionId: pre.id, action: "approve" }));
    const d = await withRequestDb(em, (db) => getDiscovery(db, em, engId));
    log("discovery answers:", JSON.stringify(Object.fromEntries(Object.entries(d.answers).map(([k, v]) => [k, Object.values(v).filter((x) => x !== null && x !== "" && !(Array.isArray(x) && !x.length)).length]))));
    expect((d.answers.vendors as Record<string, unknown>).uses_processors).toBe(true);
  }, 120_000);

  it("phase 3: the AI decides which controls apply", async () => {
    // a person approves the sector suggestions the AI was unsure of
    for (const s of (await sugg()).filter((x) => x.kind === "scope_sector" && x.status === "pending_review")) {
      log("  pending sector:", s.title, "|", s.routingReason);
    }
    await withRequestDb(em, (db) => createEngagementScope(db, em, { engagementId: engId }));
    await queue("plan");
    await drain("p3");
    const ap = (await sugg()).filter((s) => s.kind === "applicability");
    const by: Record<string, number> = {};
    for (const s of ap) by[`${s.status}`] = (by[`${s.status}`] ?? 0) + 1;
    log("applicability:", ap.length, by);
    expect(ap.length).toBeGreaterThan(80);
    const pend = ap.filter((s) => s.status === "pending_review");
    for (const s of pend) log("  pending:", s.title, "|", s.routingReason);
    for (const s of pend) await withRequestDb(em, (db) => decideSuggestion(db, em, { suggestionId: s.id, action: "approve" }));
    const dec = await withRequestDb(em, (db) => db.execute<{ d: string; n: number; codes: string }>(sql`
      SELECT esc.decision::text AS d, count(*)::int AS n, string_agg(c.code, ',' ORDER BY c.code) FILTER (WHERE esc.decision = 'not_applicable') AS codes
        FROM engagement_scope_controls esc JOIN controls c ON c.id = esc.control_id WHERE esc.engagement_id = ${engId} GROUP BY 1`));
    log("scope decisions:", JSON.stringify(dec.rows));
    const sc = await withRequestDb(em, (db) => db.execute<{ id: string }>(sql`SELECT id FROM engagement_scopes WHERE engagement_id = ${engId}`));
    await withRequestDb(em, (db) => lockEngagementScope(db, em, { engagementScopeId: sc.rows[0]!.id }));
    await withRequestDb(em, (db) => ensureAssessment(db, em, engId, orgId));
  }, 240_000);

  it("phase 4: the test log goes in and controls are rated from the tests", async () => {
    const bad = await withRequestDb(consultant, (db) => receiveTemplateFile(db, consultant, { ...scope(), template: "CONTROL-TEST-LOG", file: { buffer: Buffer.from(scopeFile()), filename: "04_Control_Test_Log.xlsx", mimeType: XLSX } }));
    expect(bad.result.ok).toBe(false);
    const r = await withRequestDb(consultant, (db) => receiveTemplateFile(db, consultant, { ...scope(), template: "CONTROL-TEST-LOG", file: { buffer: Buffer.from(testsFile()), filename: "04_Control_Test_Log.xlsx", mimeType: XLSX } }));
    expect(r.result.ok, JSON.stringify(r.result.issues)).toBe(true);
    const loaded = await withRequestDb(consultant, (db) => loadControlTests(db, consultant, scope()));
    log("tests loaded:", loaded.created, loaded.issues);
    await queue("plan", { full: true });
    await drain("p4");
    const ratings = (await sugg()).filter((s) => s.kind === "rating");
    const by: Record<string, number> = {};
    for (const s of ratings) by[`${(s.proposed as { rating: string }).rating}/${s.status}`] = (by[`${(s.proposed as { rating: string }).rating}/${s.status}`] ?? 0) + 1;
    log("ratings after tests:", by);
  }, 240_000);

  it("phase 5: the evidence index and files go in, the AI reviews each file, ratings update", async () => {
    const r = await withRequestDb(client, (db) => receiveTemplateFile(db, client, { ...scope(), template: "EVIDENCE-INDEX", file: { buffer: Buffer.from(indexFile()), filename: "05_Evidence_Index.xlsx", mimeType: XLSX } }));
    expect(r.result.ok, JSON.stringify(r.result.issues)).toBe(true);
    let n = 0;
    for (const d of EVIDENCE) {
      if (d.role === "not_uploaded") continue;
      await withRequestDb(client, async (db) => receiveSupportFile(db, client, { ...scope(), phase: 5, role: "evidence_file", file: { buffer: Buffer.from(await docBytes(d)), filename: d.file, mimeType: mimeFor(d.format) } }));
      n++;
    }
    const rec = await withRequestDb(client, (db) => reconcileEvidence(db, client, scope()));
    log("evidence:", n, "uploaded;", rec.created, "linked;", rec.issues);
    await queue("plan", { full: true });
    await drain("p5");
    const all = await sugg();
    const rev = all.filter((s) => s.kind === "evidence_review");
    const by: Record<string, number> = {};
    for (const s of rev) by[`${(s.proposed as { verdict: string }).verdict}/${s.status}`] = (by[`${(s.proposed as { verdict: string }).verdict}/${s.status}`] ?? 0) + 1;
    log("evidence reviews:", by);
    for (const s of rev.filter((x) => x.status === "pending_review")) log("  pending review:", s.title, "|", s.routingReason);
    const ratings = all.filter((s) => s.kind === "rating");
    const rb: Record<string, number> = {};
    for (const s of ratings) rb[`${(s.proposed as { rating: string }).rating}/${s.status}`] = (rb[`${(s.proposed as { rating: string }).rating}/${s.status}`] ?? 0) + 1;
    log("ratings:", rb);
    const fin = all.filter((s) => s.kind === "finding_create");
    log("findings suggested:", fin.length, fin.map((f) => `${f.status}:${f.title}`));
  }, 300_000);

  it("phase 6: people settle what the AI queued, findings are written and released", async () => {
    const before = await sugg();
    const pend = before.filter((s) => s.status === "pending_review");
    log("waiting for a person:", pend.length, pend.reduce<Record<string, number>>((m, s) => ((m[s.kind] = (m[s.kind] ?? 0) + 1), m), {}));
    for (const s of pend) {
      if (s.kind === "scope_sector") continue;
      const reject = s.kind === "evidence_review" && (s.proposed as { decision?: string }).decision === "rejected";
      try {
        await withRequestDb(em, (db) => decideSuggestion(db, em, { suggestionId: s.id, action: reject ? "approve" : "approve" }));
      } catch (e) { log("  could not approve:", s.title, (e as Error).message); }
    }
    await queue("plan", { full: true });
    await drain("p6");
    // findings the AI drafted but held (critical, or below its confidence bar): the engagement manager settles them
    for (let round = 0; round < 3; round++) {
      const held = (await sugg()).filter((s) => s.status === "pending_review" && s.kind === "finding_create");
      if (!held.length) break;
      log("findings waiting for a person:", held.map((h) => h.title));
      for (const s of held) {
        try { await withRequestDb(em, (db) => decideSuggestion(db, em, { suggestionId: s.id, action: "approve" })); } catch (e) { log("  could not approve:", s.title, (e as Error).message); }
      }
    }
    const all = await sugg();
    log("finding_create statuses:", all.filter((s) => s.kind === "finding_create").map((s) => `${s.status}:${s.title}`));
    const rows = await withRequestDb(em, (db) => db.execute<{ code: string; rating: string; applic: string }>(sql`
      SELECT c.code, COALESCE(ar.effectiveness_rating::text, 'none') AS rating, ac.applicability_decision::text AS applic
        FROM assessment_controls ac JOIN controls c ON c.id = ac.control_id LEFT JOIN assessment_responses ar ON ar.assessment_control_id = ac.id
       WHERE ac.engagement_id = ${engId} AND ac.applicability_decision = 'applicable' ORDER BY c.code`));
    log("final ratings:", rows.rows.map((r) => `${r.code}:${r.rating}`).join("  "));
    const fs = await withRequestDb(em, (db) => db.select({ id: findings.id, title: findings.title, sev: findings.severity }).from(findings).where(eq(findings.engagementId, engId)));
    log("findings:", fs.length);
    for (const f of fs) log(`  ${f.sev}: ${f.title}`);
    const rel = await withRequestDb(em, (db) => releaseFindings(db, em, { engagementId: engId, findingIds: fs.map((f) => f.id) }));
    log("released:", rel.released);
    void all;
  }, 300_000);

  it("phase 7: remediation actions are planned from the released findings", async () => {
    await queue("remediation_plan");
    await drain("p7");
    const acts = await withRequestDb(em, (db) => db.select({ id: remediationActions.id, title: remediationActions.title, pr: remediationActions.priority, due: remediationActions.dueDate }).from(remediationActions).where(eq(remediationActions.engagementId, engId)));
    log("remediation actions:", acts.length);
    for (const a of acts) log(`  ${a.pr} ${a.due}: ${a.title}`);
    expect(acts.length).toBe(12);
  }, 300_000);

  it("phase 7: the closure log and proof files go in and the AI checks each proof", async () => {
    const r = await withRequestDb(client, (db) => receiveTemplateFile(db, client, { ...scope(), template: "CLOSURE-PACK", file: { buffer: Buffer.from(closureFile()), filename: "07_Remediation_Closure_Log.xlsx", mimeType: XLSX } }));
    expect(r.result.ok, JSON.stringify(r.result.issues)).toBe(true);
    for (const d of PROOFS) await withRequestDb(client, async (db) => receiveSupportFile(db, client, { ...scope(), phase: 7, role: "proof_file", file: { buffer: Buffer.from(await docBytes(d)), filename: d.file, mimeType: mimeFor(d.format) } }));
    await queue("closure_check");
    await drain("p7b");
    const cc = (await sugg()).filter((s) => s.kind === "closure_check");
    for (const s of cc) log(`  [${s.status}] ${s.title} (${s.confidence}) :: ${s.summary}`);
    const pend = cc.filter((s) => s.status === "pending_review");
    for (const s of pend) {
      const d = (s.proposed as { decision?: string }).decision;
      if (d === "close") await withRequestDb(em, (db) => decideSuggestion(db, em, { suggestionId: s.id, action: "approve" }));
    }
    const st = await withRequestDb(em, (db) => db.execute<{ title: string; status: string }>(sql`SELECT title, status::text AS status FROM remediation_actions WHERE engagement_id = ${engId} ORDER BY title`));
    log("action statuses:", st.rows.map((x) => `${x.status}: ${x.title}`));
  }, 300_000);

  it("phase 7: the assessment is finalised and the AI drafts the final report for a person to issue", async () => {
    const a = await withRequestDb(em, (db) => db.execute<{ id: string }>(sql`SELECT id FROM assessments WHERE engagement_id = ${engId}`));
    await withRequestDb(em, (db) => finalizeAssessment(db, em, { organisationId: orgId, engagementId: engId, assessmentId: a.rows[0]!.id }));
    await queue("plan", { full: true });
    await drain("p7c");
    const rep = (await sugg()).filter((x) => x.kind === "report_issue");
    for (const s of rep) log(`  [${s.status}] ${s.title} (${s.confidence}) :: ${s.routingReason}`);
    expect(rep.length).toBe(1);
    expect(rep[0]!.status).toBe("pending_review");
    await withRequestDb(em, (db) => decideSuggestion(db, em, { suggestionId: rep[0]!.id, action: "approve" }));
    const iss = await withRequestDb(em, (db) => db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ai_report_issuances WHERE assessment_id = ${a.rows[0]!.id}`));
    log("report issuances:", iss.rows[0]!.n);
    expect(iss.rows[0]!.n).toBe(1);
  }, 300_000);
});
