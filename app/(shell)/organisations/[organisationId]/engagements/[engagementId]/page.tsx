import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { listEngagementMembers, listEligibleUsersForEngagement, listEngagementRoles } from "@/lib/domain/engagement-memberships";
import { listInvitationRoleOptions } from "@/lib/domain/invitations";
import { NotFoundOrForbiddenError, canManageEngagementMembership, hasEngagementPermission } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/workspace/common";
import { engagementMetrics } from "@/lib/workspace/portfolio";
import { listReleasedReports } from "@/lib/workspace/reports";
import { listEvidenceRequests } from "@/lib/workspace/evidence-requests";
import { PhaseBadge, Progress, fmtDateTime } from "@/components/ui/kit";
import { releaseReportAction, requestEvidenceAction } from "@/app/(shell)/workspace-actions";
import { addEngagementMemberAction, revokeEngagementMemberAction, createEngagementInvitationAction } from "./actions";

const INPUT_CLASS =
  "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

// Slice C7.2: the "Members" section below is the fix for the C7
// review's own second P0 finding — before this slice, no function
// anywhere in the codebase could add a second user to an Engagement or
// Organisation, so any real multi-person or client-involving engagement
// was impossible without a database script.
export default async function EngagementDetailPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string };
  searchParams: {
    saved?: string;
    error?: string;
    joined?: string;
    invited?: string;
    invitedEmail?: string;
    devInviteUrl?: string;
    inviteError?: string;
  };
}) {
  const user = await requireAuthenticatedUser();

  const engagement = await withRequestDb(user.id, async (db) => {
    try {
      return await getEngagementDetail(db, user.id, params.engagementId);
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) notFound();
      throw err;
    }
  });

  // The engagement genuinely belongs to a different organisation than
  // the URL claims — treat exactly like "not found," never leak which
  // organisation it actually belongs to.
  if (engagement.organisationId !== params.organisationId) notFound();

  const canUseAi = await withRequestDb(user.id, async (db) =>
    (await hasEngagementPermission(db, user.id, params.engagementId, "ai.supervise")) || (await hasEngagementPermission(db, user.id, params.engagementId, "ai.configure")),
  );

  const delivery = await withRequestDb(user.id, async (db) => {
    const viewer = await getViewer(db, user.id);
    const [m] = await engagementMetrics(db, { engagementId: params.engagementId });
    return {
      isClient: viewer.isClient,
      metrics: m ?? null,
      canRelease: !viewer.isClient && (await hasEngagementPermission(db, user.id, params.engagementId, "report.release")),
      canRequestEvidence: !viewer.isClient && (await hasEngagementPermission(db, user.id, params.engagementId, "evidence.review")),
      releases: await listReleasedReports(db, { engagementId: params.engagementId }),
      requests: viewer.isClient ? [] : await listEvidenceRequests(db, { engagementId: params.engagementId, status: "requested" }),
    };
  });
  const enginePath = `/organisations/${params.organisationId}/engagements/${params.engagementId}`;

  const { members, canManageMembers, eligibleUsers, engagementRoles, invitationRoles } = await withRequestDb(user.id, async (db) => {
    const memberRows = await listEngagementMembers(db, user.id, { organisationId: params.organisationId, engagementId: params.engagementId });
    const canManage = await canManageEngagementMembership(db, user.id, params.engagementId, params.organisationId);
    const eligible = canManage
      ? await listEligibleUsersForEngagement(db, user.id, { organisationId: params.organisationId, engagementId: params.engagementId })
      : [];
    const engagementRoleOptions = canManage ? await listEngagementRoles(db) : [];
    // P2B.5.1: the SAME `canManageEngagementMembership` flag already
    // gates "Add member" below also gates "Invite a client user" — both
    // are the engagement's own `membership.manage` permission
    // (`canManageInvitation`'s engagement branch, lib/authorization/
    // service.ts, reuses this exact function). Deliberately NOT
    // `engagementRoles` (that's `listEngagementRoles`'s practice-side
    // scope='engagement' roles — Engagement Manager/Consultant/Auditor,
    // none of which `createInvitation` accepts for an engagement
    // invitation); the invite form's own role list is the client-
    // invitable allowlist from `listInvitationRoleOptions`.
    const invitationRoleOptions = canManage ? await listInvitationRoleOptions(db, params.engagementId) : [];
    return {
      members: memberRows,
      canManageMembers: canManage,
      eligibleUsers: eligible,
      engagementRoles: engagementRoleOptions,
      invitationRoles: invitationRoleOptions,
    };
  });

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${engagement.organisationId}`} className="hover:underline">
          {engagement.organisationName}
        </Link>
      </p>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{engagement.name}</h1>
        <Badge tone={statusTone(engagement.status)}>{engagement.status}</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {engagement.engagementType} · Control library:{" "}
        {engagement.controlLibraryVersionLabel ?? "not yet pinned"}
      </p>
      {engagement.periodStart || engagement.periodEnd ? (
        <p className="mt-1 text-sm text-slate-600">
          Period: {engagement.periodStart ?? "?"} – {engagement.periodEnd ?? "?"}
        </p>
      ) : null}
      <p className="mt-1 text-sm text-slate-500">
        {engagement.currentUserRoleName
          ? <>Your role on this engagement: {engagement.currentUserRoleName}</>
          : "You can view this engagement through your organisation-level access."}
      </p>

      {searchParams.joined === "1" ? (
        <p role="status" className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Welcome — you&rsquo;ve joined {engagement.name}.
        </p>
      ) : null}
      {searchParams.saved ? (
        <p role="status" className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {searchParams.saved === "1" ? "Saved." : searchParams.saved}
        </p>
      ) : null}
      {searchParams.error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {searchParams.error}
        </p>
      ) : null}
      {searchParams.invited === "1" ? (
        <div role="status" className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          <p>
            Invitation created for {searchParams.invitedEmail} on this engagement ({engagement.name}).
          </p>
          {/* See the organisation detail page's own identical comment
              (P2B.5.1 §4, DECISIONS.md R-180) — `devInviteUrl` can only
              ever be populated outside production. */}
          {searchParams.devInviteUrl ? (
            <p className="mt-1 break-all">
              Development invitation link:{" "}
              <a href={searchParams.devInviteUrl} className="font-medium underline">
                {searchParams.devInviteUrl}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
      {searchParams.inviteError ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {searchParams.inviteError}
        </p>
      ) : null}

      {delivery.metrics ? (
        <section className="mt-8 rounded-xl border border-slate-200 bg-white shadow-card p-4" aria-labelledby="delivery-h">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="delivery-h" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Delivery status</h2>
            <PhaseBadge phase={delivery.metrics.phase} />
          </div>
          <div className="mt-3 max-w-md"><Progress value={delivery.metrics.progress} label="Engagement progress" /><p className="mt-1 text-xs text-slate-500">{delivery.metrics.progress}% · worked out from discovery, answers, validation, report release and remediation</p></div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Discovery</dt><dd>{delivery.metrics.discoveryStatus === "none" ? "Not started" : delivery.metrics.discoveryStatus.replace("_", " ")}</dd></div>
            <div><dt className="text-xs text-slate-500">Answers</dt><dd>{delivery.metrics.questionsAnswered}/{delivery.metrics.questionsTotal} answered · {delivery.metrics.questionsValidated} validated</dd></div>
            <div><dt className="text-xs text-slate-500">Findings</dt><dd>{delivery.metrics.findingsOpen} open{!delivery.isClient ? ` · ${delivery.metrics.findingsDraft} draft` : ""}</dd></div>
            <div><dt className="text-xs text-slate-500">Remediation</dt><dd>{delivery.metrics.remediationClosed}/{delivery.metrics.remediationTotal} closed</dd></div>
          </dl>
          {!delivery.isClient ? (
            <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <Link href={`/discovery/${params.engagementId}`} className="font-medium text-slate-900 underline">Discovery answers</Link>
              <Link href="/findings" className="font-medium text-slate-900 underline">Release findings</Link>
              <Link href="/tasks" className="font-medium text-slate-900 underline">Tasks &amp; milestones</Link>
              <Link href="/clarifications" className="font-medium text-slate-900 underline">Clarifications</Link>
            </p>
          ) : null}
        </section>
      ) : null}

      {canUseAi ? (
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">AI Operations Centre</h2>
            <Link
              href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/ai`}
              className="text-sm font-medium text-slate-900 underline"
            >
              Open
            </Link>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Let the AI do the routine work — reading evidence, rating controls, drafting findings and handling rights requests and breaches — while your team supervises, approves and signs off.
          </p>
        </section>
      ) : null}

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Applicability &amp; Scope</h2>
          <Link
            href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/scope`}
            className="text-sm font-medium text-slate-900 underline"
          >
            View Scope
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Which controls apply to this engagement, and why — settled before or alongside the Assessment.
        </p>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Data Landscape</h2>
          <Link
            href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/data-landscape`}
            className="text-sm font-medium text-slate-900 underline"
          >
            View Data Landscape / ROPA
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Processing Activities and how personal data actually flows through this engagement.
        </p>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Assessments</h2>
          <Link
            href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/assessments`}
            className="text-sm font-medium text-slate-900 underline"
          >
            View all ({engagement.assessments.length})
          </Link>
        </div>
        {engagement.assessments.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500">
            <p>No assessments yet for this engagement.</p>
            <Link
              href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/assessments/new`}
              className="mt-2 inline-block text-sm font-medium text-slate-900 underline"
            >
              Create Assessment
            </Link>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            Most recent: {engagement.assessments[0]!.periodLabel} —{" "}
            <Badge tone={statusTone(engagement.assessments[0]!.status)}>{engagement.assessments[0]!.status}</Badge>
          </p>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Risks</h2>
          <Link
            href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/risks`}
            className="text-sm font-medium text-slate-900 underline"
          >
            View risks
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Created from an Assessment control&rsquo;s Assessment Response, in the Assessment workspace.
        </p>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Findings</h2>
          <Link
            href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/findings`}
            className="text-sm font-medium text-slate-900 underline"
          >
            View findings
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-600">Created from a Risk&rsquo;s own detail page.</p>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Remediation</h2>
          <Link
            href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/remediation`}
            className="text-sm font-medium text-slate-900 underline"
          >
            View remediation
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-600">Created from a Finding&rsquo;s own detail page.</p>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Reports</h2>
        {engagement.assessments.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            An Engagement Report requires at least one Assessment. Create an Assessment first.
          </p>
        ) : !delivery.isClient ? (
          <>
            <p className="mt-3 text-sm text-slate-600">
              Generates a PDF covering this Engagement&rsquo;s most recent Assessment (
              {engagement.assessments[0]!.periodLabel}) and its current Risks, Findings, Remediation, Validation and
              Evidence. This working copy includes draft findings and is for the Primus team only.
            </p>
            <a
              href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/reports`}
              className="mt-2 inline-block text-sm font-medium text-slate-900 underline"
            >
              Generate working report (PDF)
            </a>
            {delivery.canRelease ? (
              <form action={releaseReportAction} className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                <input type="hidden" name="organisationId" value={engagement.organisationId} />
                <input type="hidden" name="engagementId" value={engagement.id} />
                <input type="hidden" name="back" value={enginePath} />
                <label className="block text-xs font-medium text-slate-700">Title shown to the client (optional)<input name="title" maxLength={200} className={INPUT_CLASS} /></label>
                <Button type="submit" size="sm">Release report to client</Button>
                <p className="w-full text-xs text-slate-600">Releases a client copy that leaves out draft findings. Each release is kept as its own version and cannot be taken back.</p>
              </form>
            ) : null}
          </>
        ) : null}
        {delivery.releases.length > 0 ? (
          <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-card text-sm">
            {delivery.releases.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>{r.title} · v{r.version} · released {fmtDateTime(r.releasedAt)}</span>
                <a href={`/portal/reports/${r.id}/download`} className="font-medium text-slate-900 underline">Download</a>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-slate-500">No report has been released to the client yet.</p>}
      </section>

      {delivery.canRequestEvidence ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Ask the client for evidence</h2>
          <form action={requestEvidenceAction} className="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-white shadow-card p-4 md:grid-cols-2">
            <input type="hidden" name="engagementId" value={engagement.id} />
            <input type="hidden" name="back" value={enginePath} />
            <label className="block text-xs font-medium text-slate-700">What do you need?<input name="title" required maxLength={200} className={INPUT_CLASS} /></label>
            <label className="block text-xs font-medium text-slate-700">Needed by (optional)<input name="dueDate" type="date" className={INPUT_CLASS} /></label>
            <label className="block text-xs font-medium text-slate-700 md:col-span-2">Details (optional)<textarea name="description" rows={2} maxLength={2000} className={INPUT_CLASS} /></label>
            <div><Button type="submit" size="sm">Send request</Button></div>
          </form>
          {delivery.requests.length > 0 ? <p className="mt-2 text-xs text-slate-500">{delivery.requests.length} open request{delivery.requests.length === 1 ? "" : "s"} on this engagement. <Link href="/evidence-review" className="underline">Manage on the evidence review page</Link>.</p> : null}
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Members</h2>
        {members.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No members yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-card">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{m.displayName ?? m.email}</p>
                  <p className="text-xs text-slate-500">
                    {m.email} · {m.roleName}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge tone={m.status === "active" ? "positive" : "neutral"}>{m.status}</Badge>
                  {canManageMembers && m.status === "active" ? (
                    <form action={revokeEngagementMemberAction}>
                      <input type="hidden" name="organisationId" value={params.organisationId} />
                      <input type="hidden" name="engagementId" value={params.engagementId} />
                      <input type="hidden" name="membershipId" value={m.id} />
                      <Button type="submit" size="sm" variant="destructive">
                        Revoke
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canManageMembers ? (
          <form action={addEngagementMemberAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            <input type="hidden" name="organisationId" value={params.organisationId} />
            <input type="hidden" name="engagementId" value={params.engagementId} />

            <p className="text-xs font-medium text-slate-700">Add member</p>

            {eligibleUsers.length === 0 ? (
              <p className="text-sm text-slate-500">No eligible users are available to add right now.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor="targetUserId" className="block text-xs font-medium text-slate-700">
                    User
                  </label>
                  <select id="targetUserId" name="targetUserId" required defaultValue="" className={INPUT_CLASS}>
                    <option value="" disabled>
                      Select a user
                    </option>
                    {eligibleUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName ? `${u.displayName} (${u.email})` : u.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="roleId" className="block text-xs font-medium text-slate-700">
                    Engagement role
                  </label>
                  <select id="roleId" name="roleId" required defaultValue="" className={INPUT_CLASS}>
                    <option value="" disabled>
                      Select a role
                    </option>
                    {engagementRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {eligibleUsers.length > 0 ? (
              <Button type="submit" size="sm">
                Add member
              </Button>
            ) : null}
          </form>
        ) : null}

        {/* P2B.5.1 (Internal Pilot — Invitation Creation UI): invites a
            client user who may not have a PRIMUS account yet — a sibling
            to "Add member" above (which only offers already-eligible
            existing users), not a replacement for it. Engagement-scoped:
            `createEngagementInvitationAction` (./actions.ts) passes this
            engagement's own id through to `createInvitation`, which is
            what actually resolves and enforces its organisation/tenant
            scope — this form only makes that scope visible to the user
            (the section heading and "on this engagement" banner text
            above). */}
        {canManageMembers ? (
          <form action={createEngagementInvitationAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            <input type="hidden" name="organisationId" value={params.organisationId} />
            <input type="hidden" name="engagementId" value={params.engagementId} />

            <p className="text-xs font-medium text-slate-700">Invite a client user (this engagement)</p>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor="engInvitedEmail" className="block text-xs font-medium text-slate-700">
                  Email
                </label>
                <input
                  id="engInvitedEmail"
                  name="invitedEmail"
                  type="email"
                  required
                  className={INPUT_CLASS}
                  placeholder="client@example.com"
                />
              </div>
              <div>
                <label htmlFor="engInviteRoleId" className="block text-xs font-medium text-slate-700">
                  Engagement role
                </label>
                <select id="engInviteRoleId" name="roleId" required defaultValue="" className={INPUT_CLASS}>
                  <option value="" disabled>
                    Select a role
                  </option>
                  {invitationRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Button type="submit" size="sm">
              Send invitation
            </Button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
