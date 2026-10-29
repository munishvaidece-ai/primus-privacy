"use server";

import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { act, formString, friendlyError, uuidOr, withFlag } from "@/lib/workspace/page";
import { WorkspaceInputError } from "@/lib/workspace/common";
import { cancelTask, completeTask, createTask } from "@/lib/workspace/tasks";
import { closeClarification, raiseClarification, replyToClarification } from "@/lib/workspace/clarifications";
import { cancelEvidenceRequest, fulfilEvidenceRequest, requestEvidence } from "@/lib/workspace/evidence-requests";
import { releaseFindings, returnAssessment, submitAssessment, validateAnswers } from "@/lib/workspace/review";
import { approveDiscovery, returnDiscovery, saveDiscoverySection, submitDiscovery } from "@/lib/workspace/discovery";
import { releaseReport } from "@/lib/workspace/reports";
import { deleteConsultation, setConsultationStatus, submitConsultation } from "@/lib/workspace/consultation";
import { logRightsRequest, setRightsStatus } from "@/lib/workspace/rights";
import { markAllRead, markRead } from "@/lib/workspace/notifications";
import { updateOrganisationProfile } from "@/lib/workspace/organisation-profile";
import { reviewEvidence, uploadEvidence } from "@/lib/domain/evidence";
import { actorName, emit } from "@/lib/workspace/emit";
import { connectionRequestText } from "@/lib/workspace/data-connections";

/** Where to go back to: a path on this site only. */
function back(fd: FormData, fallback: string): string {
  const v = formString(fd, "back");
  return /^\/[A-Za-z0-9/_\-.?=&%]*$/.test(v) && !v.startsWith("//") ? v : fallback;
}
function need(id: string | null, what = "record"): string {
  if (!id) throw new WorkspaceInputError(`That ${what} could not be found.`);
  return id;
}

// ---- tasks ---------------------------------------------------------------
export async function createTaskAction(fd: FormData): Promise<void> {
  return act(back(fd, "/tasks"), async ({ db, user }) => {
    await createTask(db, user.id, {
      engagementId: need(uuidOr(fd.get("engagementId")), "engagement"),
      title: fd.get("title"),
      description: fd.get("description"),
      assigneeSide: fd.get("assigneeSide"),
      dueDate: fd.get("dueDate"),
      kind: fd.get("kind") === "milestone" ? "milestone" : "task",
    });
    return fd.get("kind") === "milestone" ? "Milestone added." : "Task added.";
  });
}
export async function completeTaskAction(fd: FormData): Promise<void> {
  return act(back(fd, "/tasks"), async ({ db, user }) => {
    await completeTask(db, user.id, need(uuidOr(fd.get("taskId")), "task"));
    return "Marked done.";
  });
}
export async function cancelTaskAction(fd: FormData): Promise<void> {
  return act(back(fd, "/tasks"), async ({ db, user }) => {
    await cancelTask(db, user.id, need(uuidOr(fd.get("taskId")), "task"));
    return "Removed.";
  });
}

// ---- clarifications -------------------------------------------------------
export async function raiseClarificationAction(fd: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const fallback = "/clarifications";
  let id = "";
  let error: string | null = null;
  try {
    id = (
      await withRequestDb(user.id, (db) =>
        raiseClarification(db, user.id, { engagementId: need(uuidOr(fd.get("engagementId")), "engagement"), subject: fd.get("subject"), question: fd.get("question"), dueDate: fd.get("dueDate") }),
      )
    ).id;
  } catch (err) {
    error = friendlyError(err);
  }
  const to = back(fd, fallback);
  if (error) redirect(`${to}${to.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`);
  const detail = to.startsWith("/portal") ? `/portal/clarifications/${id}` : `/clarifications/${id}`;
  redirect(`${detail}${to.includes("e=") ? "?" + to.split("?")[1] : ""}`);
}
/** A client asks Primus to connect one of their systems. It is a clarification, so it lands in Primus's inbox and has a thread; no credentials are taken here. */
export async function requestConnectionAction(fd: FormData): Promise<void> {
  return act(back(fd, "/portal/data-connections"), async ({ db, user }) => {
    let text;
    try {
      text = connectionRequestText({ type: fd.get("type"), systemName: fd.get("systemName"), hostedWhere: fd.get("hostedWhere"), contactName: fd.get("contactName"), notes: fd.get("notes") });
    } catch (e) {
      throw new WorkspaceInputError(e instanceof Error ? e.message : "Please check the form.");
    }
    await raiseClarification(db, user.id, { engagementId: need(uuidOr(fd.get("engagementId")), "engagement"), subject: text.subject, question: text.question });
    return "Sent to Primus. They will reply under Clarifications, and no password or connection detail is needed until you agree how to share it.";
  });
}
export async function replyClarificationAction(fd: FormData): Promise<void> {
  return act(back(fd, "/clarifications"), async ({ db, user }) => {
    await replyToClarification(db, user.id, { clarificationId: need(uuidOr(fd.get("clarificationId")), "clarification"), body: fd.get("body") });
    return "Reply sent.";
  });
}
export async function closeClarificationAction(fd: FormData): Promise<void> {
  return act(back(fd, "/clarifications"), async ({ db, user }) => {
    await closeClarification(db, user.id, need(uuidOr(fd.get("clarificationId")), "clarification"));
    return "Closed.";
  });
}

// ---- evidence -------------------------------------------------------------
export async function requestEvidenceAction(fd: FormData): Promise<void> {
  return act(back(fd, "/evidence-review"), async ({ db, user }) => {
    await requestEvidence(db, user.id, { engagementId: need(uuidOr(fd.get("engagementId")), "engagement"), title: fd.get("title"), description: fd.get("description"), questionRef: fd.get("questionRef"), dueDate: fd.get("dueDate") });
    return "Evidence requested. The client has been notified.";
  });
}
export async function cancelEvidenceRequestAction(fd: FormData): Promise<void> {
  return act(back(fd, "/evidence-review"), async ({ db, user }) => {
    await cancelEvidenceRequest(db, user.id, need(uuidOr(fd.get("requestId")), "request"));
    return "Request cancelled.";
  });
}
/** The client uploads a document (tied to an assessment answer) and, if it answers a request, closes that request. */
export async function provideEvidenceAction(fd: FormData): Promise<void> {
  return act(back(fd, "/portal/evidence"), async ({ db, user }) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new WorkspaceInputError("Choose a file to upload.");
    const responseId = need(uuidOr(fd.get("assessmentResponseId")), "assessment question");
    const title = formString(fd, "title").trim();
    if (title.length < 2 || title.length > 200) throw new WorkspaceInputError("Give the document a title (2 to 200 characters).");
    const types = ["policy_document", "screenshot", "system_configuration_export", "signed_agreement", "certificate", "other"] as const;
    const type = types.find((t) => t === fd.get("evidenceType")) ?? "other";
    const out = await uploadEvidence(db, user.id, {
      organisationId: need(uuidOr(fd.get("organisationId")), "organisation"),
      engagementId: need(uuidOr(fd.get("engagementId")), "engagement"),
      title,
      evidenceType: type,
      linkTo: { type: "assessment_response", assessmentResponseId: responseId },
      file: { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, mimeType: file.type || "application/octet-stream" },
    });
    const requestId = uuidOr(fd.get("requestId"));
    if (requestId) await fulfilEvidenceRequest(db, user.id, { requestId, evidenceId: out.evidenceId });
    return requestId ? "Uploaded. The request is now answered and Primus has been told." : "Uploaded. Primus will review it.";
  });
}

// ---- findings, assessment review -----------------------------------------
export async function releaseFindingsAction(fd: FormData): Promise<void> {
  return act(back(fd, "/findings"), async ({ db, user }) => {
    const ids = fd.getAll("findingIds").map(String).filter((x) => uuidOr(x));
    const r = await releaseFindings(db, user.id, { engagementId: need(uuidOr(fd.get("engagementId")), "engagement"), findingIds: ids });
    return `Released ${r.released} finding${r.released === 1 ? "" : "s"} to the client.`;
  });
}
export async function submitAssessmentAction(fd: FormData): Promise<void> {
  return act(back(fd, "/portal/assessment"), async ({ db, user }) => {
    await submitAssessment(db, user.id, need(uuidOr(fd.get("assessmentId")), "assessment"));
    return "Submitted to Primus for review. Your answers are now locked.";
  });
}
export async function validateAnswersAction(fd: FormData): Promise<void> {
  return act(back(fd, "/assessments"), async ({ db, user }) => {
    const r = await validateAnswers(db, user.id, { assessmentId: need(uuidOr(fd.get("assessmentId")), "assessment") });
    return r.validated === 0 ? "Nothing new to validate." : `Validated ${r.validated} answer${r.validated === 1 ? "" : "s"}.`;
  });
}
export async function returnAssessmentAction(fd: FormData): Promise<void> {
  return act(back(fd, "/assessments"), async ({ db, user }) => {
    await returnAssessment(db, user.id, { assessmentId: need(uuidOr(fd.get("assessmentId")), "assessment"), note: formString(fd, "note") });
    return "Returned to the client for changes.";
  });
}

// ---- discovery ------------------------------------------------------------
function answersFrom(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("a_") || typeof v !== "string") continue;
    const key = k.slice(2);
    out[key] = key in out ? ([] as unknown[]).concat(out[key] as never, v) : v;
  }
  // A multi-choice with one tick arrives as a string; the server cleans it into a list.
  return out;
}
export async function saveDiscoveryAction(fd: FormData): Promise<void> {
  const complete = fd.get("intent") === "complete";
  return act(back(fd, "/portal/discovery"), async ({ db, user }) => {
    await saveDiscoverySection(db, user.id, { engagementId: need(uuidOr(fd.get("engagementId")), "engagement"), sectionKey: formString(fd, "sectionKey"), answers: answersFrom(fd), complete });
    return complete ? "Step completed." : "Saved.";
  });
}
/** Background save while typing. Returns a result instead of redirecting. */
export async function autosaveDiscoveryAction(fd: FormData): Promise<{ ok: boolean; message: string }> {
  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) => saveDiscoverySection(db, user.id, { engagementId: need(uuidOr(fd.get("engagementId")), "engagement"), sectionKey: formString(fd, "sectionKey"), answers: answersFrom(fd), complete: false }));
    return { ok: true, message: "Draft saved" };
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
}
export async function submitDiscoveryAction(fd: FormData): Promise<void> {
  return act(back(fd, "/portal/discovery"), async ({ db, user }) => {
    await submitDiscovery(db, user.id, need(uuidOr(fd.get("engagementId")), "engagement"));
    return "Submitted to Primus for review.";
  });
}
export async function approveDiscoveryAction(fd: FormData): Promise<void> {
  return act(back(fd, "/discovery"), async ({ db, user }) => {
    await approveDiscovery(db, user.id, need(uuidOr(fd.get("engagementId")), "engagement"));
    return "Scope approved. The questionnaire is now read-only.";
  });
}
export async function returnDiscoveryAction(fd: FormData): Promise<void> {
  return act(back(fd, "/discovery"), async ({ db, user }) => {
    await returnDiscovery(db, user.id, need(uuidOr(fd.get("engagementId")), "engagement"));
    return "Returned to the client for changes.";
  });
}

// ---- reports, rights, notifications, profile -------------------------------
export async function releaseReportAction(fd: FormData): Promise<void> {
  return act(back(fd, "/engagements"), async ({ db, user }) => {
    const r = await releaseReport(db, user.id, { organisationId: need(uuidOr(fd.get("organisationId")), "organisation"), engagementId: need(uuidOr(fd.get("engagementId")), "engagement"), userEmail: user.email, title: formString(fd, "title") || undefined });
    return `Report version ${r.version} released to the client.`;
  });
}
export async function logRightsAction(fd: FormData): Promise<void> {
  return act(back(fd, "/portal/rights"), async ({ db, user }) => {
    const r = await logRightsRequest(db, user.id, {
      engagementId: need(uuidOr(fd.get("engagementId")), "engagement"),
      title: formString(fd, "title"),
      requestType: formString(fd, "requestType"),
      channel: formString(fd, "channel"),
      receivedOn: formString(fd, "receivedOn"),
      dueOn: formString(fd, "dueOn"),
    });
    return `Logged as ${r.reference}.`;
  });
}
export async function setRightsStatusAction(fd: FormData): Promise<void> {
  return act(back(fd, "/portal/rights"), async ({ db, user }) => {
    const status = fd.get("status") === "closed" ? "closed" : "in_progress";
    await setRightsStatus(db, user.id, { caseId: need(uuidOr(fd.get("caseId")), "request"), engagementId: need(uuidOr(fd.get("engagementId")), "engagement"), status });
    return status === "closed" ? "Request closed." : "Marked in progress.";
  });
}
export async function markReadAction(fd: FormData): Promise<void> {
  return act(back(fd, "/notifications"), async ({ db, user }) => {
    await markRead(db, user.id, need(uuidOr(fd.get("id")), "notification"));
    return "Marked as read.";
  });
}
export async function markAllReadAction(fd: FormData): Promise<void> {
  return act(back(fd, "/notifications"), async ({ db, user }) => {
    const n = await markAllRead(db, user.id);
    return n ? `Marked ${n} as read.` : "Nothing to mark.";
  });
}
export async function updateOrganisationProfileAction(fd: FormData): Promise<void> {
  return act(back(fd, "/organisations"), async ({ db, user }) => {
    await updateOrganisationProfile(db, user.id, { organisationId: need(uuidOr(fd.get("organisationId")), "organisation"), industry: fd.get("industry"), hqLocation: fd.get("hqLocation") });
    return "Profile saved.";
  });
}

/** Accept or reject an evidence item from the review queue, and tell the client. */
export async function reviewEvidenceQueueAction(fd: FormData): Promise<void> {
  return act(back(fd, "/evidence-review"), async ({ db, user }) => {
    const organisationId = need(uuidOr(fd.get("organisationId")), "organisation");
    const engagementId = need(uuidOr(fd.get("engagementId")), "engagement");
    const status = fd.get("reviewStatus") === "rejected" ? "rejected" : "accepted";
    const rationale = formString(fd, "reviewRationale").trim();
    await reviewEvidence(db, user.id, { organisationId, engagementId, evidenceId: need(uuidOr(fd.get("evidenceId")), "evidence"), reviewStatus: status, reviewRationale: rationale || null });
    const title = formString(fd, "title").slice(0, 120);
    const who = await actorName(db, user.id);
    await emit(db, {
      engagementId,
      kind: status === "accepted" ? "evidence_accepted" : "evidence_rejected",
      summary: `${who} ${status} the evidence "${title}"`,
      subjectType: "evidence",
      subjectId: need(uuidOr(fd.get("evidenceId")), "evidence"),
      clientVisible: true,
      notify: { audience: "client", title: status === "accepted" ? `Evidence accepted: ${title}` : `Evidence rejected: ${title}`, body: rationale ? rationale.slice(0, 300) : undefined, link: "/portal/evidence" },
    });
    return status === "accepted" ? "Evidence accepted." : "Evidence rejected. The client has been told why.";
  });
}

// ---- consultation requests ("Connect with us") ------------------------------
/** The client sends the form. On success the person lands on the thank-you view; on a problem they return to the form with a message. */
export async function submitConsultationAction(fd: FormData): Promise<void> {
  const formPath = back(fd, "/portal/dpo-mate/connect");
  const user = await requireAuthenticatedUser();
  let error: string | null = null;
  let sent: { id: string; emailStatus: string } | null = null;
  try {
    sent = await withRequestDb(user.id, (db) =>
      submitConsultation(db, user.id, {
        engagementId: need(uuidOr(fd.get("engagementId")), "engagement"),
        form: {
          organisationName: fd.get("organisationName"),
          sectorKey: fd.get("sectorKey"),
          employeeBand: fd.get("employeeBand"),
          website: fd.get("website"),
          contactName: fd.get("contactName"),
          contactDesignation: fd.get("contactDesignation"),
          contactEmail: fd.get("contactEmail"),
          contactMobile: fd.get("contactMobile"),
          topics: fd.getAll("topics").map(String),
          preferredTime: fd.get("preferredTime"),
          note: fd.get("note"),
          submitterIsContact: fd.get("submitterIsContact") === "yes" ? true : fd.get("submitterIsContact") === "no" ? false : null,
          consent: fd.get("consent") === "yes",
        },
      }),
    );
  } catch (err) {
    error = friendlyError(err);
  }
  if (error || !sent) redirect(withFlag(formPath, "error", error ?? "Something went wrong. Please try again."));
  const base = formPath.split("?")[0]!;
  const e = formPath.match(/[?&]e=([0-9a-f-]{36})/i)?.[1];
  redirect(`${base}?${e ? `e=${e}&` : ""}sent=${sent.id}`);
}
export async function updateConsultationAction(fd: FormData): Promise<void> {
  return act(back(fd, "/consultations"), async ({ db, user }) => {
    await setConsultationStatus(db, user.id, { id: need(uuidOr(fd.get("id")), "request"), status: formString(fd, "status"), note: formString(fd, "note") });
    return "Saved.";
  });
}
export async function deleteConsultationAction(fd: FormData): Promise<void> {
  return act(back(fd, "/consultations"), async ({ db, user }) => {
    await deleteConsultation(db, user.id, need(uuidOr(fd.get("id")), "request"));
    return "The request was deleted.";
  });
}
