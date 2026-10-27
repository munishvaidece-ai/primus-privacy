import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAiContext } from "../../load";
import { AiShell, CARD, Flash, INPUT, aiBase } from "@/components/ai/shell";
import { Badge, riskRatingTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getQueueCounts, listSuggestions } from "@/lib/ai/suggestions";
import { CASE_LABELS, getCase, type CaseType } from "@/lib/ai/cases";
import { describeProposal } from "@/lib/ai/present";
import { getEngagementSectors } from "@/lib/domain/sectors";
import { incidentDuties, RULE_PHASES } from "@/lib/regulation";
import { approveResponseAction, closeCaseAction, raiseFindingAction, saveDraftAction } from "../actions";

export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string; caseId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const { ctx, data } = await loadAiContext(params, async (db, c) => {
    const row = await getCase(db, c.userId, params, params.caseId).catch(() => null);
    if (!row) return null;
    const waiting = (await listSuggestions(db, params.engagementId, { status: ["pending_review"] })).filter((s) => s.subjectId === row.id);
    const sectors = row.caseType === "breach" ? await getEngagementSectors(db, c.userId, params) : [];
    return { row, waiting, sectors, counts: await getQueueCounts(db, params.engagementId) };
  });
  if (!data) notFound();
  const { row: c, waiting } = data;
  const base = aiBase(params.organisationId, params.engagementId);
  const hidden = (
    <>
      <input type="hidden" name="organisationId" value={params.organisationId} />
      <input type="hidden" name="engagementId" value={params.engagementId} />
      <input type="hidden" name="caseId" value={c.id} />
    </>
  );
  const details = describeProposal("case", c.details as Record<string, unknown>).filter((l) => l.key !== "raised");
  const assessment = c.aiAssessment ? describeProposal("case", c.aiAssessment as Record<string, unknown>) : [];
  const late = c.dueAt && c.dueAt.getTime() < Date.now() && c.status !== "closed";
  const breach = c.caseType === "breach";

  return (
    <AiShell {...ctx} active="/cases" badge={{ queue: data.counts.pending }}>
      <Flash saved={searchParams.saved} error={searchParams.error} />
      <p className="text-sm text-slate-500"><Link href={`${base}/cases`} className="hover:underline">← All cases</Link></p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{c.reference} — {c.title}</h2>
        <Badge>{CASE_LABELS[c.caseType as CaseType]}</Badge>
        <Badge tone={c.status === "closed" ? "positive" : "neutral"}>{c.status.replace(/_/g, " ")}</Badge>
        {c.severity ? <Badge tone={riskRatingTone(c.severity)}>{c.severity} severity</Badge> : null}
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Received {c.receivedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
        {c.dueAt ? <> · <span className={late ? "font-semibold text-red-700" : ""}>{breach ? "Report to the Board due" : "Due"} {c.dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC{late ? " — OVERDUE" : ""}</span></> : null}
      </p>

      {waiting.length ? (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">The AI has {waiting.length} proposal(s) on this case waiting for a person. <Link className="underline" href={`${base}/queue`}>Open the review queue</Link>.</p>
      ) : null}

      <section className={`${CARD} mt-6`} aria-labelledby="det">
        <h3 id="det" className="text-sm font-semibold uppercase tracking-wide text-slate-500">What was reported</h3>
        <dl className="mt-3 space-y-2 text-sm">{details.map((l) => <div key={l.key} className="sm:flex sm:gap-3"><dt className="shrink-0 font-medium text-slate-700 sm:w-56">{l.label}</dt><dd className="whitespace-pre-line text-slate-800">{l.value}</dd></div>)}</dl>
      </section>

      {breach ? (
        <section className={`${CARD} mt-6`} aria-labelledby="who">
          <h3 id="who" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Who may have to be told</h3>
          <p className="mt-2 text-sm text-slate-600">One incident can trigger several separate duties to separate bodies. These come from the sectors on this engagement. A person decides which apply to this incident.</p>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {incidentDuties(data.sectors).map((d) => (
              <li key={d.body + d.asks} className="py-2">
                <p className="font-medium text-slate-900">{d.body}{d.control ? <span className="ml-2 font-mono text-xs font-normal text-slate-500">{d.control}</span> : null}{d.inForce ? <span className="ml-2 text-xs font-normal text-slate-500">enforceable from {d.inForce}</span> : null}{!d.confirmed ? <span className="ml-2 text-xs font-normal text-amber-700">check the source before relying on it</span> : null}</p>
                <p className="text-slate-700">{d.asks}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">The DPDP breach duties are enforceable from {RULE_PHASES["18m"].label.replace("In force from ", "")}. Confirm against the Gazette.</p>
        </section>
      ) : null}

      <section className={`${CARD} mt-6`} aria-labelledby="ai">
        <h3 id="ai" className="text-sm font-semibold uppercase tracking-wide text-slate-500">The AI&rsquo;s assessment</h3>
        {assessment.length === 0 ? <p className="mt-3 text-sm text-slate-500">{c.status === "new" ? "Not triaged yet — the AI picks new cases up within a few moments (or press “Run now” on the Overview)." : "No assessment has been applied yet."}</p> : (
          <dl className="mt-3 space-y-2 text-sm">{assessment.map((l) => <div key={l.key} className={l.long ? "" : "sm:flex sm:gap-3"}><dt className="shrink-0 font-medium text-slate-700 sm:w-56">{l.label}</dt><dd className="whitespace-pre-line text-slate-800">{l.value}</dd></div>)}</dl>
        )}
      </section>

      <section className={`${CARD} mt-6`} aria-labelledby="resp">
        <h3 id="resp" className="text-sm font-semibold uppercase tracking-wide text-slate-500">{breach ? "Notices" : "Response"}</h3>
        {c.responseApprovedAt ? (
          <>
            <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Approved {c.responseApprovedAt.toISOString().slice(0, 16).replace("T", " ")} UTC. The text below is frozen. Send it through your normal channel — this platform records the approval but does not send email.</p>
            <pre className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-800">{c.draftResponse}</pre>
          </>
        ) : c.draftResponse ? (
          <>
            <form action={saveDraftAction} className="mt-3 space-y-3">
              {hidden}
              <label htmlFor="draft" className="block text-xs font-medium text-slate-700">Draft prepared by the AI — edit it as needed</label>
              <textarea id="draft" name="draft" rows={12} defaultValue={c.draftResponse} className={INPUT} />
              <Button type="submit" size="sm" variant="secondary">Save my edits</Button>
            </form>
            <form action={approveResponseAction} className="mt-3">
              {hidden}
              <Button type="submit" size="sm">Approve for sending</Button>
              {breach ? <span className="ml-3 text-xs text-slate-500">Only an Engagement Manager can approve a breach notice.</span> : null}
            </form>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No draft yet.{breach ? " For breaches, the notice appears once the AI has prepared it; it is held for an Engagement Manager's sign-off." : ""}</p>
        )}
      </section>

      {breach ? (
        <section className={`${CARD} mt-6`} aria-labelledby="learn">
          <h3 id="learn" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Learn from this breach</h3>
          {(c.details as { raised?: { findingId: string; remediationActionId: string } }).raised ? (
            <p className="mt-3 text-sm text-slate-700">A finding and a remediation action were raised from this breach. <Link className="underline" href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/findings/${(c.details as { raised: { findingId: string } }).raised.findingId}`}>Open the finding</Link> or <Link className="underline" href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/remediation/${(c.details as { raised: { remediationActionId: string } }).raised.remediationActionId}`}>open the remediation action</Link>.</p>
          ) : (
            <>
              <p className="mt-3 text-sm text-slate-600">Turn the incident into a finding and a remediation action against the breach-response control (BRE-01) in this engagement&rsquo;s assessment. It then follows the normal review, release and closure steps, and counts toward the assessment.</p>
              <form action={raiseFindingAction} className="mt-3">{hidden}<Button type="submit" size="sm" variant="secondary">Raise a finding and remediation action</Button></form>
            </>
          )}
        </section>
      ) : null}

      {c.status !== "closed" ? (
        <form action={closeCaseAction} className="mt-6">{hidden}<Button type="submit" variant="secondary" size="sm">Close this case</Button></form>
      ) : null}
    </AiShell>
  );
}
