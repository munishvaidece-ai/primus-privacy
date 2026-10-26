import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { listAllEvidence } from "@/lib/workspace/portfolio";
import { listEvidenceRequests } from "@/lib/workspace/evidence-requests";
import { engagementMetrics } from "@/lib/workspace/portfolio";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD, Empty, Flash, INPUT, LABEL, PageHeader, Table, TD, fmtDate, titleCase } from "@/components/ui/kit";
import { cancelEvidenceRequestAction, requestEvidenceAction, reviewEvidenceQueueAction } from "../workspace-actions";

export default async function EvidenceReviewPage({ searchParams }: { searchParams: { saved?: string; error?: string } }) {
  const { viewer, data } = await loadPage(async ({ db, viewer }) => {
    if (viewer.isClient) return null;
    return { evidence: await listAllEvidence(db), requests: await listEvidenceRequests(db), engagements: await engagementMetrics(db) };
  });
  if (viewer.isClient || !data) redirect("/portal/evidence");
  const pending = data.evidence.filter((e) => e.reviewStatus === "pending_review");
  const reviewed = data.evidence.filter((e) => e.reviewStatus !== "pending_review").slice(0, 30);
  const open = data.requests.filter((r) => r.status === "requested");
  const closed = data.requests.filter((r) => r.status !== "requested").slice(0, 20);
  return (
    <div>
      <PageHeader title="Evidence review" subtitle="Evidence the clients have uploaded, waiting for your decision, and the evidence you have asked them for." />
      <Flash saved={searchParams.saved} error={searchParams.error} />

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Waiting for review ({pending.length})</h2>
      {pending.length === 0 ? <Empty>No evidence is waiting for review.</Empty> : (
        <ul className="space-y-3">
          {pending.map((e) => (
            <li key={e.id} className={CARD}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{e.title}</p>
                  <p className="text-xs text-slate-500">{e.organisationName} · {e.engagementName} · {titleCase(e.evidenceType)} · {e.fileName ?? "file"} · {fmtDate(e.collectedAt)}</p>
                </div>
                {e.assessmentId ? <Link href={`/organisations/${e.organisationId}/engagements/${e.engagementId}/assessments/${e.assessmentId}/evidence/${e.id}/download`} className="text-sm font-medium text-slate-900 hover:underline">Download to read</Link> : null}
              </div>
              <form action={reviewEvidenceQueueAction} className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="organisationId" value={e.organisationId} />
                <input type="hidden" name="engagementId" value={e.engagementId} />
                <input type="hidden" name="evidenceId" value={e.id} />
                <input type="hidden" name="title" value={e.title} />
                <input type="hidden" name="back" value="/evidence-review" />
                <label className={`${LABEL} min-w-64 flex-1`}>Reason (required to reject)<input name="reviewRationale" maxLength={4000} className={INPUT} /></label>
                <Button type="submit" name="reviewStatus" value="accepted" size="sm">Accept</Button>
                <Button type="submit" name="reviewStatus" value="rejected" size="sm" variant="secondary">Reject</Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wide text-slate-500">Requests to clients ({open.length} open)</h2>
      {open.length === 0 ? <Empty>No open requests.</Empty> : (
        <Table label="Open evidence requests" head={["Ref", "Request", "Client", "Due", ""]}>
          {open.map((r) => (
            <tr key={r.id}>
              <td className={TD}>{r.reference}</td>
              <td className={TD}><p className="font-medium text-slate-900">{r.title}</p>{r.description ? <p className="text-xs text-slate-500">{r.description}</p> : null}</td>
              <td className={TD}>{r.organisationName}<br /><span className="text-xs text-slate-500">{r.engagementName}</span></td>
              <td className={TD}>{fmtDate(r.dueAt)}</td>
              <td className={TD}><form action={cancelEvidenceRequestAction}><input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="back" value="/evidence-review" /><Button type="submit" size="sm" variant="ghost">Cancel</Button></form></td>
            </tr>
          ))}
        </Table>
      )}

      <section className={`${CARD} mt-4`} aria-labelledby="req">
        <h3 id="req" className="text-sm font-semibold text-slate-900">Request evidence from a client</h3>
        <form action={requestEvidenceAction} className="mt-3 grid gap-3 md:grid-cols-2">
          <input type="hidden" name="back" value="/evidence-review" />
          <label className={LABEL}>Engagement
            <select name="engagementId" required className={INPUT}>{data.engagements.filter((e) => e.status !== "closed").map((e) => <option key={e.id} value={e.id}>{e.organisationName} · {e.name}</option>)}</select>
          </label>
          <label className={LABEL}>What do you need?<input name="title" required maxLength={200} className={INPUT} placeholder="e.g. Latest signed privacy policy" /></label>
          <label className={`${LABEL} md:col-span-2`}>Details (optional)<textarea name="description" rows={2} maxLength={2000} className={INPUT} /></label>
          <label className={LABEL}>Related question (optional)<input name="questionRef" maxLength={60} className={INPUT} placeholder="e.g. BR-1" /></label>
          <label className={LABEL}>Due date<input name="dueDate" type="date" className={INPUT} /></label>
          <div className="md:col-span-2"><Button type="submit">Send request</Button></div>
        </form>
      </section>

      {closed.length > 0 ? (
        <>
          <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wide text-slate-500">Recently closed requests</h2>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white text-sm">
            {closed.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2 px-4 py-2"><span>{r.reference} · {r.title} <span className="text-slate-500">({r.organisationName})</span></span><Badge tone={r.status === "fulfilled" ? "positive" : "neutral"}>{r.status}</Badge></li>)}
          </ul>
        </>
      ) : null}

      <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wide text-slate-500">Recently reviewed</h2>
      {reviewed.length === 0 ? <Empty>Nothing reviewed yet.</Empty> : (
        <Table label="Reviewed evidence" head={["Evidence", "Client", "Decision"]}>
          {reviewed.map((e) => <tr key={e.id}><td className={TD}>{e.title}</td><td className={TD}>{e.organisationName}</td><td className={TD}><Badge tone={statusTone(e.reviewStatus)}>{titleCase(e.reviewStatus)}</Badge></td></tr>)}
        </Table>
      )}
    </div>
  );
}
