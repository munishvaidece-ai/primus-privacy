import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getFindingDetail } from "@/lib/domain/findings";
import { getRiskDetail } from "@/lib/domain/risks";
import { getControlTestsForControl } from "@/lib/domain/assessments";
import { getEvidenceSummaryForControl } from "@/lib/domain/evidence";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, riskRatingTone, findingStatusTone, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateFindingAction } from "../actions";

const SEVERITY_OPTIONS = ["low", "medium", "high", "critical"] as const;
const STATUS_OPTIONS = ["open", "in_progress", "resolved", "accepted"] as const;
const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

// Slice C4 (PHASE C4 instructions §7): Finding detail — identity,
// severity, status, owner, an edit form, source Risk(s), and the full
// Risk → Assessment → Control → AssessmentResponse → Evidence chain,
// resolved by reusing the EXISTING getRiskDetail/getControlTestsForControl/
// getEvidenceSummaryForControl functions the Risk detail page itself
// already calls — one layer deeper composition, never duplicated data.
export default async function FindingDetailPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string; findingId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const finding = await withRequestDb(user.id, async (db) => {
    try {
      return await getFindingDetail(db, user.id, {
        organisationId: params.organisationId,
        engagementId: params.engagementId,
        findingId: params.findingId,
      });
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });

  if (!finding) notFound();

  const primaryRisk = finding.sourceRisks[0] ?? null;

  const risk = primaryRisk
    ? await withRequestDb(user.id, async (db) => {
        try {
          return await getRiskDetail(db, user.id, {
            organisationId: params.organisationId,
            engagementId: params.engagementId,
            riskId: primaryRisk.id,
          });
        } catch (err) {
          if (err instanceof NotFoundOrForbiddenError) return null;
          throw err;
        }
      })
    : null;

  const primaryControl = risk?.sourceControls[0] ?? null;

  const [controlTestRows, evidenceRows] =
    risk?.sourceAssessment && primaryControl
      ? await withRequestDb(user.id, async (db) => {
          const tests = await getControlTestsForControl(db, risk.sourceAssessment!.id, primaryControl.id);
          const ev = await getEvidenceSummaryForControl(db, risk.sourceAssessmentResponse?.id ?? null, tests.map((t) => t.id));
          return [tests, ev] as const;
        })
      : ([[], []] as const);

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/findings`} className="hover:underline">
          Back to findings
        </Link>
      </p>
      <div className="mt-1 flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold text-slate-900">{finding.title}</h1>
        <div className="flex shrink-0 gap-2">
          <Badge tone={riskRatingTone(finding.severity)}>{finding.severity}</Badge>
          <Badge tone={findingStatusTone(finding.status)}>{finding.status}</Badge>
        </div>
      </div>
      {finding.description ? <p className="mt-2 text-sm text-slate-700">{finding.description}</p> : null}

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

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Edit finding</h2>
          <form action={updateFindingAction} className="mt-2 space-y-2">
            <input type="hidden" name="organisationId" value={params.organisationId} />
            <input type="hidden" name="engagementId" value={params.engagementId} />
            <input type="hidden" name="findingId" value={finding.id} />

            <div>
              <label htmlFor="title" className="block text-xs font-medium text-slate-700">
                Title
              </label>
              <input id="title" name="title" type="text" required maxLength={200} defaultValue={finding.title} className={INPUT_CLASS} />
            </div>
            <div>
              <label htmlFor="description" className="block text-xs font-medium text-slate-700">
                Description
              </label>
              <textarea id="description" name="description" rows={2} defaultValue={finding.description ?? ""} className={INPUT_CLASS} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="severity" className="block text-xs font-medium text-slate-700">
                  Severity
                </label>
                <select id="severity" name="severity" defaultValue={finding.severity} className={INPUT_CLASS}>
                  {SEVERITY_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="status" className="block text-xs font-medium text-slate-700">
                  Status
                </label>
                <select id="status" name="status" defaultValue={finding.status} className={INPUT_CLASS}>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="ownerAction" className="block text-xs font-medium text-slate-700">
                Owner
              </label>
              <select id="ownerAction" name="ownerAction" defaultValue="keep" className={INPUT_CLASS}>
                <option value="keep">Keep current ({finding.ownerEmail ?? "unassigned"})</option>
                <option value="assign_self">Assign to me</option>
                <option value="unassign">Unassign</option>
              </select>
            </div>
            <Button type="submit" size="sm">
              Save finding
            </Button>
          </form>
          <dl className="mt-4 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-600">Recorded</dt>
              <dd>{new Date(finding.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-600">Last updated</dt>
              <dd>{new Date(finding.updatedAt).toLocaleString()}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Source traceability</h2>
          <p className="mt-1 text-xs text-slate-500">Finding → Risk → Assessment → Control → Assessment Response.</p>
          <dl className="mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-slate-600">Source risk(s)</dt>
              <dd className="text-slate-900">
                {finding.sourceRisks.length === 0
                  ? "Not linked to a specific risk."
                  : finding.sourceRisks.map((r) => (
                      <span key={r.id} className="mr-2 inline-block">
                        <Link
                          href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/risks/${r.id}`}
                          className="underline"
                        >
                          {r.title}
                        </Link>{" "}
                        <Badge tone={riskRatingTone(r.inherentRating)}>{r.inherentRating}</Badge>
                      </span>
                    ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Source assessment</dt>
              <dd className="text-slate-900">
                {risk?.sourceAssessment && primaryControl ? (
                  <Link
                    href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/assessments/${risk.sourceAssessment.id}?control=${primaryControl.id}`}
                    className="underline"
                  >
                    {risk.sourceAssessment.periodLabel}
                  </Link>
                ) : (
                  "No assessment context recorded yet for this finding's source risk."
                )}
              </dd>
            </div>
            {risk?.sourceAssessmentResponse ? (
              <div>
                <dt className="text-xs font-medium text-slate-600">Assessment response</dt>
                <dd className="text-slate-900">{risk.sourceAssessmentResponse.effectivenessRating}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Relevant control tests</h2>
          {controlTestRows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              {primaryControl ? "No control tests recorded for the source control yet." : "No source control to trace control tests from."}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {controlTestRows.map((t) => (
                <li key={t.id} className="rounded border border-slate-100 p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <Badge tone={statusTone(t.result)}>{t.result}</Badge>
                    <span className="text-xs text-slate-500">{t.testedAt ? new Date(t.testedAt).toLocaleDateString() : "date not recorded"}</span>
                  </div>
                  <p className="mt-1 text-slate-700">{t.methodology}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Relevant evidence</h2>
          <p className="mt-1 text-xs text-slate-500">
            Evidence linked to the source assessment response / control tests above — this finding references the same
            authoritative Evidence records shown in the Assessment workspace and the source Risk, not a copy.
          </p>
          {evidenceRows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No evidence linked yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {evidenceRows.map((e) => (
                <li key={e.evidenceLinkId} className="rounded border border-slate-100 p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">{e.title}</p>
                    <Badge tone={statusTone(e.reviewStatus)}>{e.reviewStatus}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    {e.evidenceType} · {e.originalFilename}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Remediation and validation for this finding are not yet part of this application (Slice C4 is Findings only).
      </p>
    </div>
  );
}
