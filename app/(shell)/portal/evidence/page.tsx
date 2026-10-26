import { loadPortal } from "@/lib/workspace/page";
import { listAllEvidence } from "@/lib/workspace/portfolio";
import { listEvidenceRequests } from "@/lib/workspace/evidence-requests";
import { getAssessmentDetail } from "@/lib/domain/assessments";
import { hasPermission } from "@/lib/workspace/common";
import { PortalHeader } from "@/components/portal/header";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD, Empty, Flash, INPUT, LABEL, Table, TD, fmtDate, titleCase } from "@/components/ui/kit";
import { provideEvidenceAction } from "../../workspace-actions";

export default async function PortalEvidence({ searchParams }: { searchParams: { e?: string; req?: string; saved?: string; error?: string } }) {
  const { portal, data } = await loadPortal(searchParams, async ({ db, user, current }) => {
    const questions = current.assessmentId && current.assessmentStatus === "draft"
      ? (await getAssessmentDetail(db, user.id, current.assessmentId)).controlRows.filter((r) => r.response).map((r) => ({ responseId: r.response!.id, label: `${r.controlCode} — ${r.controlTitle}` }))
      : [];
    return {
      requests: await listEvidenceRequests(db, { engagementId: current.id }),
      evidence: await listAllEvidence(db, { engagementId: current.id, clientOnly: true }),
      questions,
      canUpload: await hasPermission(db, user.id, current, "client.contribute"),
      locked: current.assessmentSubmitted,
    };
  });
  const m = portal.current;
  const open = data.requests.filter((r) => r.status === "requested");
  const closed = data.requests.filter((r) => r.status !== "requested");
  const can = data.canUpload && !data.locked;
  const back = `/portal/evidence${portal.q}`;
  return (
    <div>
      <PortalHeader title="Evidence" subtitle="Documents that support your assessment answers, and what Primus has asked you for." engagements={portal.engagements} current={m} />
      <Flash saved={searchParams.saved} error={searchParams.error} />

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Requested by Primus ({open.length})</h2>
      {open.length === 0 ? <Empty>Nothing is waiting on you.</Empty> : (
        <ul className="space-y-3">
          {open.map((r) => (
            <li key={r.id} className={CARD}>
              <p className="text-sm font-semibold text-slate-900">{r.reference} · {r.title}</p>
              {r.description ? <p className="mt-1 text-sm text-slate-600">{r.description}</p> : null}
              <p className="mt-1 text-xs text-slate-500">Asked {fmtDate(r.requestedAt)}{r.dueAt ? ` · due ${fmtDate(r.dueAt)}` : ""}</p>
              {can && data.questions.length > 0 ? <UploadForm m={m} questions={data.questions} requestId={r.id} defaultTitle={r.title} back={back} /> : <p className="mt-2 text-xs text-slate-500">{data.locked ? "The assessment has been submitted, so uploads are closed." : !data.canUpload ? "Your role cannot upload evidence." : "Answer at least one assessment question first; evidence is attached to a question."}</p>}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Upload evidence</h2>
      {can && data.questions.length > 0 ? <div className={CARD}><UploadForm m={m} questions={data.questions} back={back} /></div> : <Empty>{!data.canUpload ? "Your role cannot upload evidence." : data.locked ? "The assessment has been submitted, so uploads are closed." : "Evidence is attached to an assessment answer. Answer a question on the Assessment page and it will appear here."}</Empty>}

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Documents on file ({data.evidence.length})</h2>
      {data.evidence.length === 0 ? <Empty>No documents yet.</Empty> : (
        <Table label="Documents" head={["Title", "Type", "File", "Uploaded", "Primus review"]}>
          {data.evidence.map((e) => (
            <tr key={e.id}>
              <td className={TD}>{e.title}</td>
              <td className={TD}>{titleCase(e.evidenceType)}</td>
              <td className={TD}>{e.fileName ?? "—"}</td>
              <td className={TD}>{fmtDate(e.collectedAt)}</td>
              <td className={TD}><Badge tone={statusTone(e.reviewStatus)}>{titleCase(e.reviewStatus)}</Badge></td>
            </tr>
          ))}
        </Table>
      )}
      {closed.length > 0 ? (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Closed requests</h2>
          <Table label="Closed requests" head={["Ref", "Request", "Outcome"]}>
            {closed.map((r) => <tr key={r.id}><td className={TD}>{r.reference}</td><td className={TD}>{r.title}</td><td className={TD}>{r.status === "fulfilled" ? "Answered" : "Withdrawn"}</td></tr>)}
          </Table>
        </>
      ) : null}
    </div>
  );
}

function UploadForm({ m, questions, requestId, defaultTitle, back }: { m: { id: string; organisationId: string }; questions: { responseId: string; label: string }[]; requestId?: string; defaultTitle?: string; back: string }) {
  return (
    <form action={provideEvidenceAction} className="mt-3 grid gap-3 md:grid-cols-2">
      <input type="hidden" name="organisationId" value={m.organisationId} />
      <input type="hidden" name="engagementId" value={m.id} />
      <input type="hidden" name="back" value={back} />
      {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
      <label className={LABEL}>Title<input name="title" required minLength={2} maxLength={200} defaultValue={defaultTitle} className={INPUT} /></label>
      <label className={LABEL}>It supports this answer
        <select name="assessmentResponseId" required className={INPUT}>{questions.map((q) => <option key={q.responseId} value={q.responseId}>{q.label}</option>)}</select>
      </label>
      <label className={LABEL}>Kind of document
        <select name="evidenceType" defaultValue="policy_document" className={INPUT}>
          {[["policy_document", "Policy document"], ["screenshot", "Screenshot"], ["system_configuration_export", "System configuration export"], ["signed_agreement", "Signed agreement"], ["certificate", "Certificate"], ["other", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className={LABEL}>File<input name="file" type="file" required className={INPUT} /></label>
      <div className="md:col-span-2"><Button type="submit">Upload{requestId ? " and answer this request" : ""}</Button></div>
    </form>
  );
}
