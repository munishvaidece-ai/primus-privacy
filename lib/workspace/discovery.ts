import "server-only";
import { eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { discoverySections, engagementDiscovery } from "@/db/schema";
import { NotFoundOrForbiddenError, hasEngagementPermission, hasOrganisationPermission } from "@/lib/authorization/service";
import { WorkspaceInputError, loadEngagement } from "./common";
import { actorName, emit } from "./emit";
import { getEngagementSectors } from "@/lib/domain/sectors";
import { SELECTABLE_SECTORS, type SectorKey } from "@/lib/regulation";
import { bankKeyFromSection, bankSection, type BankSetKey } from "./question-bank";
import {
  SECTIONS,
  isFieldFilled,
  type Section,
  missingFields,
  previewObligations,
  sanitizeAnswers,
  sectionByKey,
  sectionComplete,
  type AllAnswers,
  type Answers,
  type ObligationPreview,
} from "./discovery-sections";

export type DiscoveryStatus = "in_progress" | "submitted" | "approved";

export interface DiscoveryState {
  engagementId: string;
  status: DiscoveryStatus;
  submittedAt: Date | null;
  approvedAt: Date | null;
  answers: AllAnswers;
  completed: Record<string, boolean>;
  completedCount: number;
  total: number;
  preview: ObligationPreview[];
}

export async function getDiscovery(db: RequestDb, userId: string, engagementId: string): Promise<DiscoveryState> {
  await loadEngagement(db, userId, engagementId);
  const [head] = await db.select().from(engagementDiscovery).where(eq(engagementDiscovery.engagementId, engagementId)).limit(1);
  const rows = await db.select().from(discoverySections).where(eq(discoverySections.engagementId, engagementId));
  const answers: AllAnswers = {};
  const completed: Record<string, boolean> = {};
  for (const s of SECTIONS) {
    const row = rows.find((r) => r.sectionKey === s.key);
    answers[s.key] = sanitizeAnswers(s, (row?.answers as Record<string, unknown>) ?? {});
    completed[s.key] = Boolean(row?.completedAt);
  }
  return {
    engagementId,
    status: (head?.status as DiscoveryStatus) ?? "in_progress",
    submittedAt: head?.submittedAt ?? null,
    approvedAt: head?.approvedAt ?? null,
    answers,
    completed,
    completedCount: Object.values(completed).filter(Boolean).length,
    total: SECTIONS.length,
    preview: previewObligations(answers),
  };
}

/** A saved question set (key `sq_<sector>`) as a section, or undefined for anything else. */
function sectionOfBank(sectionKey: string): Section | undefined {
  const k = bankKeyFromSection(sectionKey);
  return k ? bankSection(k) : undefined;
}

export interface QuestionSetState {
  key: BankSetKey;
  section: Section;
  answers: Answers;
  complete: boolean;
  answered: number;
}

export interface SectorQuestionsState {
  engagementId: string;
  /** Sector the client named in step 1, if it is one we have questions for. */
  declared: SectorKey | null;
  /** Sectors Primus has set for this engagement. */
  setByPrimus: SectorKey[];
  /** Everything the client is asked: the common set first, then one set per sector. */
  sets: QuestionSetState[];
}

/** The question sets this client sees: the common set plus those for their own sector(s). */
export async function getSectorQuestions(db: RequestDb, userId: string, engagementId: string): Promise<SectorQuestionsState> {
  const eng = await loadEngagement(db, userId, engagementId);
  const rows = await db.select().from(discoverySections).where(eq(discoverySections.engagementId, engagementId));
  const profile = rows.find((r) => r.sectionKey === "organisation_profile");
  const declaredRaw = sanitizeAnswers(SECTIONS[0]!, (profile?.answers as Record<string, unknown>) ?? {}).sector;
  const valid = new Set<string>(SELECTABLE_SECTORS.map((x) => x.key));
  const declared = typeof declaredRaw === "string" && valid.has(declaredRaw) ? (declaredRaw as SectorKey) : null;
  const setByPrimus = await getEngagementSectors(db, userId, { engagementId, organisationId: eng.organisationId });
  const keys: BankSetKey[] = ["common", ...Array.from(new Set<SectorKey>([...setByPrimus, ...(declared ? [declared] : [])]))];
  const sets = keys.map((key): QuestionSetState => {
    const section = bankSection(key);
    const row = rows.find((r) => r.sectionKey === section.key);
    const answers = sanitizeAnswers(section, (row?.answers as Record<string, unknown>) ?? {});
    return { key, section, answers, complete: Boolean(row?.completedAt), answered: section.fields.filter((f) => isFieldFilled(f, answers)).length };
  });
  return { engagementId, declared, setByPrimus, sets };
}

async function ensureHead(db: RequestDb, eng: { id: string; tenantId: string; organisationId: string }) {
  await db.insert(engagementDiscovery).values({ tenantId: eng.tenantId, organisationId: eng.organisationId, engagementId: eng.id }).onConflictDoNothing();
  const [head] = await db.select().from(engagementDiscovery).where(eq(engagementDiscovery.engagementId, eng.id)).limit(1);
  return head!;
}

/** Saves one step. With `complete`, the step is marked complete only if every required answer is given. */
export async function saveDiscoverySection(
  db: RequestDb,
  userId: string,
  input: { engagementId: string; sectionKey: string; answers: Record<string, unknown>; complete: boolean },
): Promise<{ complete: boolean; missing: string[] }> {
  const eng = await loadEngagement(db, userId, input.engagementId);
  const section = sectionByKey(input.sectionKey) ?? sectionOfBank(input.sectionKey);
  if (!section) throw new WorkspaceInputError("Unknown step.");
  const head = await ensureHead(db, eng);
  const isQuestionSet = bankKeyFromSection(section.key) !== null;
  if (head.status === "approved" && !isQuestionSet) throw new WorkspaceInputError("Scope was approved by Primus. The questionnaire is now read-only.");
  const clean: Answers = sanitizeAnswers(section, input.answers);
  const missing = input.complete ? missingFields(section, clean).map((f) => f.label) : [];
  const isComplete = input.complete && sectionComplete(section, clean);
  if (input.complete && !isComplete) {
    if (missing.length === 0) throw new WorkspaceInputError("Please tick the confirmation before completing this step.");
    throw new WorkspaceInputError(`Please answer: ${missing.slice(0, 3).join("; ")}${missing.length > 3 ? " and more" : ""}.`);
  }
  try {
    await db
      .insert(discoverySections)
      .values({ tenantId: eng.tenantId, organisationId: eng.organisationId, engagementId: eng.id, sectionKey: section.key, answers: clean, completedAt: isComplete ? new Date() : null, updatedBy: userId })
      .onConflictDoUpdate({ target: [discoverySections.engagementId, discoverySections.sectionKey], set: { answers: clean, completedAt: isComplete ? new Date() : null, updatedBy: userId, updatedAt: new Date() } });
  } catch (err) {
    if (err instanceof Error && /row-level security/i.test(err.message)) throw new WorkspaceInputError("The questionnaire is locked while Primus reviews it.");
    throw err;
  }
  return { complete: isComplete, missing: [] };
}

export async function submitDiscovery(db: RequestDb, userId: string, engagementId: string): Promise<void> {
  const eng = await loadEngagement(db, userId, engagementId);
  const canSubmit = (await hasEngagementPermission(db, userId, eng.id, "client.submit")) || (await hasOrganisationPermission(db, userId, eng.organisationId, "client.submit")) || (await hasEngagementPermission(db, userId, eng.id, "discovery.approve"));
  if (!canSubmit) throw new NotFoundOrForbiddenError();
  const state = await getDiscovery(db, userId, engagementId);
  if (state.status !== "in_progress") throw new WorkspaceInputError("The questionnaire was already submitted.");
  if (state.completedCount < state.total) throw new WorkspaceInputError(`${state.total - state.completedCount} step${state.total - state.completedCount === 1 ? " is" : "s are"} not complete yet.`);
  await ensureHead(db, eng);
  await db.update(engagementDiscovery).set({ status: "submitted" }).where(eq(engagementDiscovery.engagementId, eng.id));
  const who = await actorName(db, userId);
  await emit(db, {
    engagementId: eng.id,
    kind: "discovery_submitted",
    summary: `${who} submitted the discovery questionnaire`,
    subjectType: "engagement",
    subjectId: eng.id,
    clientVisible: true,
    notify: { audience: "practice", title: `${eng.organisationName} submitted discovery`, body: "Review the answers and approve the scope.", link: `/discovery` },
  });
}

async function reviewerTransition(db: RequestDb, userId: string, engagementId: string, to: DiscoveryStatus, kind: string, verb: string, notifyTitle: string) {
  const eng = await loadEngagement(db, userId, engagementId);
  if (!(await hasEngagementPermission(db, userId, eng.id, "discovery.approve"))) throw new NotFoundOrForbiddenError();
  const state = await getDiscovery(db, userId, engagementId);
  if (to === "approved" && state.status !== "submitted") throw new WorkspaceInputError("Only a submitted questionnaire can be approved.");
  if (to === "in_progress" && state.status === "in_progress") throw new WorkspaceInputError("The questionnaire is already open for editing.");
  await db.update(engagementDiscovery).set({ status: to }).where(eq(engagementDiscovery.engagementId, eng.id));
  const who = await actorName(db, userId);
  await emit(db, { engagementId: eng.id, kind, summary: `${who} ${verb}`, subjectType: "engagement", subjectId: eng.id, clientVisible: true, notify: { audience: "client", title: notifyTitle, link: "/portal/discovery" } });
}

export const approveDiscovery = (db: RequestDb, userId: string, engagementId: string) =>
  reviewerTransition(db, userId, engagementId, "approved", "discovery_approved", "approved the discovery scope", "Primus approved your scope");

/** Sends a submitted (or approved) questionnaire back to the client for changes. */
export const returnDiscovery = (db: RequestDb, userId: string, engagementId: string) =>
  reviewerTransition(db, userId, engagementId, "in_progress", "discovery_returned", "returned the discovery questionnaire for changes", "Primus returned your questionnaire for changes");
