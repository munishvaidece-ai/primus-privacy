import "server-only";
import { and, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { intakeFiles, remediationActions } from "@/db/schema";
import {
  createBusinessUnit, createDataPrincipalCategory, createDataStore, createPersonalDataElement, createProcessor, createPurpose, createSystem,
  listBusinessUnits, listDataPrincipalCategories, listDataStores, listPersonalDataElements, listProcessors, listPurposes, listSystems,
} from "@/lib/domain/master-data";
import { createProcessingActivity, linkDataPrincipalCategory, linkPersonalDataElement, linkProcessor, linkPurpose, linkSystem, listProcessingActivities } from "@/lib/domain/processing-activities";
import { getEngagementSectors, setEngagementSectors } from "@/lib/domain/sectors";
import { createRemediationAction, updateRemediationAction } from "@/lib/domain/remediation";
import { uploadEvidence, InvalidFileError } from "@/lib/domain/evidence";
import { getDiscovery, saveDiscoverySection } from "@/lib/workspace/discovery";
import { readEvidenceObject } from "./storage-reader";
import type { ApplyContext } from "./apply";
import type { LandscapeOutput } from "./tasks/landscape";

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const key = (s: string) => s.trim().toLowerCase();

export async function applyScopeSector(db: RequestDb, c: ApplyContext, proposed: Record<string, unknown>) {
  const s = c.suggestion;
  const sector = str(proposed.sector);
  const current = await getEngagementSectors(db, c.actorUserId, { engagementId: s.engagementId, organisationId: s.organisationId });
  const next = await setEngagementSectors(db, c.actorUserId, { engagementId: s.engagementId, organisationId: s.organisationId, sectors: [...new Set([...current, sector])] });
  return { table: "engagement_sectors", sectors: next };
}

export async function applyScopeUnits(db: RequestDb, c: ApplyContext, proposed: Record<string, unknown>) {
  const s = c.suggestion;
  const want = (proposed.units as Array<{ name: string }> | undefined) ?? [];
  const have = new Set((await listBusinessUnits(db, c.actorUserId, s.organisationId)).map((u) => key(u.name)));
  const created: string[] = [];
  for (const u of want) {
    if (have.has(key(u.name))) continue;
    await createBusinessUnit(db, c.actorUserId, s.organisationId, { name: u.name, parentBusinessUnitId: null });
    have.add(key(u.name));
    created.push(u.name);
  }
  return { table: "business_units", created };
}

export async function applyLandscape(db: RequestDb, c: ApplyContext, proposed: Record<string, unknown>) {
  const s = c.suggestion;
  const plan = proposed._plan as Omit<LandscapeOutput, "prefill"> | undefined;
  if (!plan) throw new Error("This suggestion has no plan to apply.");
  const org = s.organisationId;
  const u = c.actorUserId;
  const made = { units: 0, systems: 0, stores: 0, vendors: 0, purposes: 0, elements: 0, principals: 0, activities: 0, links: 0 };

  const units = new Map((await listBusinessUnits(db, u, org)).map((x) => [key(x.name), x.id]));
  const sys = new Map((await listSystems(db, u, org)).map((x) => [key(x.name), x.id]));
  const stores = new Set((await listDataStores(db, u, org)).map((x) => key(x.name)));
  const procs = new Map((await listProcessors(db, u, org)).map((x) => [key(x.name), x.id]));
  const purposes = new Map((await listPurposes(db, u, org)).map((x) => [key(x.name), x.id]));
  const elements = new Map((await listPersonalDataElements(db, u, org)).map((x) => [key(x.name), x.id]));
  const principals = new Map((await listDataPrincipalCategories(db, u, org)).map((x) => [key(x.name), x.id]));
  const acts = new Set((await listProcessingActivities(db, u, { engagementId: s.engagementId, organisationId: org })).map((x) => key(x.name)));

  for (const x of plan.systems) if (!sys.has(key(x.name))) { sys.set(key(x.name), (await createSystem(db, u, org, { name: x.name, owner: x.owner || null, hostingEnvironment: x.hosting || null })).id); made.systems++; }
  for (const x of plan.stores) if (!stores.has(key(x.name))) { stores.add(key(x.name)); await createDataStore(db, u, org, { name: x.name, storageType: null, location: x.location || null, systemId: sys.get(key(x.system)) ?? null }); made.stores++; }
  for (const x of plan.vendors) if (!procs.has(key(x.name))) { procs.set(key(x.name), (await createProcessor(db, u, org, { name: x.name, dpaVersionLabel: x.dpa === "Yes" ? "Contract in place" : x.dpa === "Partly" ? "Partial terms" : "No contract", riskTier: x.riskTier, parentProcessorId: null })).id); made.vendors++; }
  for (const x of plan.purposes) if (!purposes.has(key(x.name))) { purposes.set(key(x.name), (await createPurpose(db, u, org, { name: x.name, description: null })).id); made.purposes++; }
  for (const x of plan.elements) if (!elements.has(key(x.name))) { elements.set(key(x.name), (await createPersonalDataElement(db, u, org, { name: x.name, sensitivityCategory: x.sensitivity })).id); made.elements++; }
  for (const x of plan.principals) if (!principals.has(key(x.name))) { principals.set(key(x.name), (await createDataPrincipalCategory(db, u, org, { name: x.name, isChildrenFlag: x.children, description: null })).id); made.principals++; }

  for (const a of plan.activities) {
    if (acts.has(key(a.name))) continue;
    let unitId = units.get(key(a.unit)) ?? null;
    if (!unitId && a.unit.trim()) { unitId = (await createBusinessUnit(db, u, org, { name: a.unit, parentBusinessUnitId: null })).id; units.set(key(a.unit), unitId); made.units++; }
    const pa = await createProcessingActivity(db, u, {
      engagementId: s.engagementId,
      name: a.name,
      description: `${a.description} Kept: ${a.retention}.${a.abroad ? " Sent or stored outside India." : ""}`,
      businessUnitId: unitId,
      ownerUserId: null,
      lawfulBasis: a.basis,
    });
    acts.add(key(a.name));
    made.activities++;
    const link = async (fn: () => Promise<unknown>) => { try { await fn(); made.links++; } catch (e) { if (!(e instanceof Error) || e.name !== "DuplicateLinkError") throw e; } };
    const pid = purposes.get(key(a.purpose));
    if (pid) await link(() => linkPurpose(db, u, { processingActivityId: pa.id, purposeId: pid }));
    for (const n of a.principals) { const id = principals.get(key(n)); if (id) await link(() => linkDataPrincipalCategory(db, u, { processingActivityId: pa.id, dataPrincipalCategoryId: id })); }
    for (const n of a.elements) { const id = elements.get(key(n)); if (id) await link(() => linkPersonalDataElement(db, u, { processingActivityId: pa.id, personalDataElementId: id, sensitivityNote: null })); }
    for (const n of a.systems) { const id = sys.get(key(n)); if (id) await link(() => linkSystem(db, u, { processingActivityId: pa.id, systemId: id })); }
    for (const n of a.vendors) { const id = procs.get(key(n)); if (id) await link(() => linkProcessor(db, u, { processingActivityId: pa.id, processorId: id, role: "processor" })); }
  }
  return { table: "processing_activities", ...made };
}

export async function applyDiscoveryPrefill(db: RequestDb, c: ApplyContext, proposed: Record<string, unknown>) {
  if (c.actorType !== "human") throw new Error("Questionnaire answers are saved only when a person approves them.");
  const sections = (proposed._sections ?? {}) as Record<string, { answers: Record<string, unknown> }>;
  const state = await getDiscovery(db, c.actorUserId, c.suggestion.engagementId);
  let saved = 0;
  for (const [sectionKey, p] of Object.entries(sections)) {
    const merged = { ...(state.answers[sectionKey] ?? {}) } as Record<string, unknown>;
    for (const [f, v] of Object.entries(p.answers)) {
      const cur = merged[f];
      const empty = cur === null || cur === undefined || cur === "" || (Array.isArray(cur) && cur.length === 0);
      if (empty) { merged[f] = v; saved++; }
    }
    await saveDiscoverySection(db, c.actorUserId, { engagementId: c.suggestion.engagementId, sectionKey, answers: merged, complete: false });
  }
  return { table: "discovery_sections", answersSaved: saved, steps: Object.keys(sections).length };
}

export async function applyRemediationPlan(db: RequestDb, c: ApplyContext, proposed: Record<string, unknown>) {
  const r = await createRemediationAction(db, c.actorUserId, {
    findingId: str(proposed.findingId),
    title: str(proposed.title),
    description: `${str(proposed.description)}\n\n[AI-assisted (${c.suggestion.provider}), ${c.actorType === "ai" ? "applied under autopilot" : "approved by a reviewer"}]`,
    priority: (str(proposed.priority) || "medium") as "low" | "medium" | "high" | "critical",
    dueDate: str(proposed.dueDate) || null,
    assignOwnerToSelf: false,
  });
  return { table: "remediation_actions", id: r.id };
}

export async function applyClosureCheck(db: RequestDb, c: ApplyContext, proposed: Record<string, unknown>) {
  const s = c.suggestion;
  if (!s.subjectId) throw new Error("No remediation action.");
  const [a] = await db.select().from(remediationActions).where(eq(remediationActions.id, s.subjectId)).limit(1);
  if (!a) throw new Error("The remediation action no longer exists.");
  const decision = str(proposed.decision);
  const note = `${str(proposed.rationale)} [AI-assisted (${s.provider}), ${c.actorType === "ai" ? "applied under autopilot" : "approved by a reviewer"}]`;
  let attached = false;
  if (decision === "close") {
    const proofName = str(proposed.proofFile);
    const [f] = await db.select().from(intakeFiles).where(and(eq(intakeFiles.engagementId, s.engagementId), eq(intakeFiles.filename, proofName), eq(intakeFiles.role, "proof_file"))).limit(1);
    if (f) {
      try {
        const buf = await readEvidenceObject(f.storagePath);
        await uploadEvidence(db, c.actorUserId, { organisationId: s.organisationId, engagementId: s.engagementId, title: `Proof: ${a.title}`.slice(0, 200), evidenceType: "other", documentType: "other", linkTo: { type: "remediation_action", remediationActionId: a.id }, file: { buffer: buf, filename: f.filename, mimeType: f.mimeType } });
        attached = true;
      } catch (e) {
        if (!(e instanceof InvalidFileError)) throw e;
      }
    }
  }
  await updateRemediationAction(db, c.actorUserId, {
    organisationId: s.organisationId,
    engagementId: s.engagementId,
    remediationActionId: a.id,
    title: a.title,
    description: `${a.description ?? ""}\n\nProof check: ${note}`.trim(),
    priority: a.priority,
    status: decision === "close" ? "validated" : "in_progress",
    dueDate: a.dueDate,
    ownerAction: "keep",
  });
  return { table: "remediation_actions", id: a.id, status: decision === "close" ? "validated" : "in_progress", evidenceAttached: attached };
}
