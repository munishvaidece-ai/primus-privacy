import "server-only";
import { desc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { consultationRequests, engagements, organisations } from "@/db/schema";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { sendMail, consultationInbox, type MailStatus } from "@/lib/notify/mailer";
import { SELECTABLE_SECTORS } from "@/lib/regulation";
import { WorkspaceInputError, getViewer, loadEngagement } from "./common";
import { actorName, emit } from "./emit";
import { BANDS, TIMES, TOPICS, checkConsultation, type ConsultationInput } from "./consultation-notice";

export const CONSULTATION_STATUSES = ["new", "contacted", "scheduled", "done", "closed"] as const;
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];

const label = (list: ReadonlyArray<{ value: string; label: string }>, v: string | null) => list.find((x) => x.value === v)?.label ?? v ?? "not given";

export interface ConsultationRow {
  id: string;
  engagementId: string;
  organisationId: string;
  organisationName: string;
  engagementName: string;
  sectorKey: string | null;
  employeeBand: string | null;
  website: string | null;
  contactName: string;
  contactDesignation: string;
  contactEmail: string;
  contactMobile: string;
  topics: string[];
  preferredTime: string | null;
  note: string | null;
  submitterIsContact: boolean;
  noticeVersion: string;
  consentText: string;
  consentedAt: Date;
  status: ConsultationStatus;
  handledAt: Date | null;
  internalNote: string | null;
  emailStatus: string;
  createdAt: Date;
}

const columns = {
  id: consultationRequests.id,
  engagementId: consultationRequests.engagementId,
  organisationId: consultationRequests.organisationId,
  organisationName: consultationRequests.organisationName,
  engagementName: engagements.name,
  sectorKey: consultationRequests.sectorKey,
  employeeBand: consultationRequests.employeeBand,
  website: consultationRequests.website,
  contactName: consultationRequests.contactName,
  contactDesignation: consultationRequests.contactDesignation,
  contactEmail: consultationRequests.contactEmail,
  contactMobile: consultationRequests.contactMobile,
  topics: consultationRequests.topics,
  preferredTime: consultationRequests.preferredTime,
  note: consultationRequests.note,
  submitterIsContact: consultationRequests.submitterIsContact,
  noticeVersion: consultationRequests.noticeVersion,
  consentText: consultationRequests.consentText,
  consentedAt: consultationRequests.consentedAt,
  status: consultationRequests.status,
  handledAt: consultationRequests.handledAt,
  internalNote: consultationRequests.internalNote,
  emailStatus: consultationRequests.emailStatus,
  createdAt: consultationRequests.createdAt,
};

function emailBody(r: { id: string; organisationName: string; sectorKey: string | null; employeeBand: string | null; website: string | null; contactName: string; contactDesignation: string; contactEmail: string; contactMobile: string; topics: string[]; preferredTime: string | null; note: string | null; submitterIsContact: boolean; noticeVersion: string; consentedAt: Date }, submittedBy: string): string {
  const sector = SELECTABLE_SECTORS.find((s) => s.key === r.sectorKey)?.label ?? "not given";
  return [
    "A client asked to book a 30 minute consultation.",
    "",
    `Organisation: ${r.organisationName}`,
    `Sector: ${sector}`,
    `Size: ${label(BANDS, r.employeeBand)}`,
    `Website: ${r.website ?? "not given"}`,
    "",
    `Contact person: ${r.contactName}, ${r.contactDesignation}`,
    `Mobile: ${r.contactMobile}`,
    `Email: ${r.contactEmail}`,
    `Preferred time: ${label(TIMES, r.preferredTime)}`,
    `Topics: ${r.topics.length ? r.topics.map((t) => label(TOPICS, t)).join(", ") : "not given"}`,
    `Note: ${r.note ?? "none"}`,
    "",
    `Sent by: ${submittedBy} (${r.submitterIsContact ? "the contact person" : "on behalf of the contact person, who has agreed"})`,
    `Agreed to notice ${r.noticeVersion} on ${r.consentedAt.toISOString()}`,
    `Request id: ${r.id}`,
    "",
    "Please get back to them within one working day. Update the status in the app under Consultation requests.",
  ].join("\n");
}

/** Saves a request, tells the Primus team in the app, and emails the Primus inbox when email is set up. */
export async function submitConsultation(
  db: RequestDb,
  userId: string,
  input: { engagementId: string; form: Partial<Record<keyof ConsultationInput, unknown>> },
): Promise<{ id: string; emailStatus: MailStatus }> {
  const eng = await loadEngagement(db, userId, input.engagementId);
  const checked = checkConsultation(input.form);
  if (!checked.ok) throw new WorkspaceInputError(checked.error);
  const v = checked.value;
  const [row] = await db
    .insert(consultationRequests)
    .values({
      tenantId: eng.tenantId,
      organisationId: eng.organisationId,
      engagementId: eng.id,
      submittedBy: userId,
      organisationName: v.organisationName,
      sectorKey: v.sectorKey,
      employeeBand: v.employeeBand,
      website: v.website,
      contactName: v.contactName,
      contactDesignation: v.contactDesignation,
      contactEmail: v.contactEmail,
      contactMobile: v.contactMobile,
      topics: v.topics,
      preferredTime: v.preferredTime,
      note: v.note,
      submitterIsContact: v.submitterIsContact,
      noticeVersion: v.noticeVersion,
      consentText: v.consentText,
    })
    .returning({ id: consultationRequests.id, consentedAt: consultationRequests.consentedAt });
  const who = await actorName(db, userId);
  await emit(db, {
    engagementId: eng.id,
    kind: "consultation_requested",
    summary: `${who} asked for a 30 minute consultation`,
    subjectType: "consultation",
    subjectId: row!.id,
    clientVisible: false,
    notify: { audience: "practice", title: `${eng.organisationName} asked for a consultation`, body: `${v.contactName}, ${v.contactDesignation}`, link: "/consultations" },
  });
  const inbox = consultationInbox();
  const emailStatus: MailStatus = inbox
    ? await sendMail({ to: inbox, subject: `Consultation request: ${v.organisationName} (${v.contactName})`, text: emailBody({ ...v, id: row!.id, consentedAt: row!.consentedAt }, who), replyTo: v.contactEmail })
    : "not_configured";
  await db.update(consultationRequests).set({ emailStatus, emailedAt: emailStatus === "sent" ? new Date() : null }).where(eq(consultationRequests.id, row!.id));
  return { id: row!.id, emailStatus };
}

function shape(r: Record<string, unknown>): ConsultationRow {
  return { ...(r as unknown as ConsultationRow), topics: Array.isArray(r.topics) ? (r.topics as string[]) : [] };
}

/** Requests the caller may see. Row security gives Primus staff everything on their engagements and a client person only their own. */
export async function listConsultations(db: RequestDb, input: { engagementId?: string } = {}): Promise<ConsultationRow[]> {
  const q = db.select(columns).from(consultationRequests).innerJoin(engagements, eq(engagements.id, consultationRequests.engagementId)).innerJoin(organisations, eq(organisations.id, consultationRequests.organisationId));
  const rows = input.engagementId ? await q.where(eq(consultationRequests.engagementId, input.engagementId)).orderBy(desc(consultationRequests.createdAt)) : await q.orderBy(desc(consultationRequests.createdAt));
  return rows.map(shape);
}

async function requirePractice(db: RequestDb, userId: string): Promise<void> {
  const viewer = await getViewer(db, userId);
  if (viewer.isClient) throw new NotFoundOrForbiddenError();
}

/** A Primus person records progress on a request. */
export async function setConsultationStatus(db: RequestDb, userId: string, input: { id: string; status: string; note: string }): Promise<void> {
  await requirePractice(db, userId);
  if (!(CONSULTATION_STATUSES as readonly string[]).includes(input.status)) throw new WorkspaceInputError("Choose a status from the list.");
  const note = input.note.trim().slice(0, 2000);
  const updated = await db
    .update(consultationRequests)
    .set({ status: input.status, internalNote: note || null, handledBy: userId, handledAt: new Date() })
    .where(eq(consultationRequests.id, input.id))
    .returning({ id: consultationRequests.id });
  if (updated.length === 0) throw new NotFoundOrForbiddenError();
}

/** Erases a request, for when the purpose has ended or the person asks. */
export async function deleteConsultation(db: RequestDb, userId: string, id: string): Promise<void> {
  await requirePractice(db, userId);
  const gone = await db.delete(consultationRequests).where(eq(consultationRequests.id, id)).returning({ id: consultationRequests.id });
  if (gone.length === 0) throw new NotFoundOrForbiddenError();
}
