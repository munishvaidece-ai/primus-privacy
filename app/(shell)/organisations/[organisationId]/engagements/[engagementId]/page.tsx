import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { listEngagementMembers, listEligibleUsersForEngagement, listEngagementRoles } from "@/lib/domain/engagement-memberships";
import { NotFoundOrForbiddenError, canManageEngagementMembership } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addEngagementMemberAction, revokeEngagementMemberAction } from "./actions";

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

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
  searchParams: { saved?: string; error?: string };
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

  const { members, canManageMembers, eligibleUsers, engagementRoles } = await withRequestDb(user.id, async (db) => {
    const memberRows = await listEngagementMembers(db, user.id, { organisationId: params.organisationId, engagementId: params.engagementId });
    const canManage = await canManageEngagementMembership(db, user.id, params.engagementId, params.organisationId);
    const eligible = canManage
      ? await listEligibleUsersForEngagement(db, user.id, { organisationId: params.organisationId, engagementId: params.engagementId })
      : [];
    const engagementRoleOptions = canManage ? await listEngagementRoles(db) : [];
    return { members: memberRows, canManageMembers: canManage, eligibleUsers: eligible, engagementRoles: engagementRoleOptions };
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

      {searchParams.saved === "1" ? (
        <p role="status" className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Saved.
        </p>
      ) : null}
      {searchParams.error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {searchParams.error}
        </p>
      ) : null}

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
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-600">
              Generates a PDF covering this Engagement&rsquo;s most recent Assessment (
              {engagement.assessments[0]!.periodLabel}) and its current Risks, Findings, Remediation, Validation and
              Evidence.
            </p>
            <a
              href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/reports`}
              className="mt-2 inline-block text-sm font-medium text-slate-900 underline"
            >
              Generate Engagement Report (PDF)
            </a>
          </>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Members</h2>
        {members.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No members yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
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
      </section>
    </div>
  );
}
