import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPage, uuidOr } from "@/lib/workspace/page";
import { getDiscovery } from "@/lib/workspace/discovery";
import { loadEngagement } from "@/lib/workspace/common";
import { hasEngagementPermission } from "@/lib/authorization/service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD, Flash, PageHeader, fmtDateTime } from "@/components/ui/kit";
import { DiscoveryAnswers, ObligationsPreview } from "@/components/workspace/discovery-readonly";
import { approveDiscoveryAction, returnDiscoveryAction } from "../../workspace-actions";

export default async function DiscoveryReviewPage({ params, searchParams }: { params: { engagementId: string }; searchParams: { saved?: string; error?: string } }) {
  if (!uuidOr(params.engagementId)) notFound();
  const { data } = await loadPage(async ({ db, user }) => {
    const eng = await loadEngagement(db, user.id, params.engagementId);
    return { eng, state: await getDiscovery(db, user.id, eng.id), canApprove: await hasEngagementPermission(db, user.id, eng.id, "discovery.approve") };
  });
  const { eng, state, canApprove } = data;
  const back = `/discovery/${eng.id}`;
  return (
    <div>
      <PageHeader crumb={<Link href="/discovery" className="hover:underline">Discovery</Link>} title={`${eng.organisationName} — discovery`} subtitle={eng.name}
        actions={<Badge tone={state.status === "approved" ? "positive" : state.status === "submitted" ? "warning" : "neutral"}>{state.status === "in_progress" ? "In progress" : state.status === "submitted" ? "Submitted" : "Approved"}</Badge>} />
      <Flash saved={searchParams.saved} error={searchParams.error} />
      {state.status === "submitted" && canApprove ? (
        <div className={`${CARD} mb-6 flex flex-wrap items-end gap-4`}>
          <p className="text-sm text-slate-700">Submitted {fmtDateTime(state.submittedAt)}. Approving freezes the answers and confirms the scope. Returning lets the client change them.</p>
          <form action={approveDiscoveryAction}><input type="hidden" name="engagementId" value={eng.id} /><input type="hidden" name="back" value={back} /><Button type="submit">Approve scope</Button></form>
          <form action={returnDiscoveryAction}><input type="hidden" name="engagementId" value={eng.id} /><input type="hidden" name="back" value={back} /><Button type="submit" variant="secondary">Return for changes</Button></form>
        </div>
      ) : null}
      {state.status === "approved" && canApprove ? (
        <div className={`${CARD} mb-6 flex flex-wrap items-center gap-4`}>
          <p className="text-sm text-slate-700">Approved {fmtDateTime(state.approvedAt)}. The client can no longer change these answers.</p>
          <form action={returnDiscoveryAction}><input type="hidden" name="engagementId" value={eng.id} /><input type="hidden" name="back" value={back} /><Button type="submit" variant="secondary" size="sm">Reopen for changes</Button></form>
        </div>
      ) : null}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Answers</h2>
      <DiscoveryAnswers state={state} />
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Indicative obligations</h2>
      <p className="mb-3 max-w-3xl text-sm text-slate-600">Worked out from the answers above as a starting point. The formal applicability decision is still made on the engagement&rsquo;s Applicability &amp; Scope page.</p>
      <ObligationsPreview items={state.preview} />
    </div>
  );
}
