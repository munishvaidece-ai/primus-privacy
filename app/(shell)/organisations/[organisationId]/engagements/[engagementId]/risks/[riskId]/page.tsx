import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getRiskDetail } from "@/lib/domain/risks";
import { getControlTestsForControl } from "@/lib/domain/assessments";
import { getEvidenceSummaryForControl } from "@/lib/domain/evidence";
import { listFindingsForRisk } from "@/lib/domain/findings";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, riskRatingTone, riskStatusTone, findingStatusTone, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateRiskStatusAction, createFindingAction } from "../actions";

const STATUS_OPTIONS = ["open", "mitigating", "accepted", "closed"] as const;
const SEVERITY_OPTIONS = ["low", "medium", "high", "critical"] as const;
const FORM_INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

// Slice C3 (PHASE C3 instructions §8): Risk detail — identity, source
// Assessment/Control/AssessmentResponse, scoring, status, owner, and
// (instructions §17) Evidence traceability resolved through the
// EXISTING assessment-workspace read functions, never duplicated or
// copied onto the Risk itself.
export default async function RiskDetailPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string; riskId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const risk = await withRequestDb(user.id, async (db) => {
    try {
      return await getRiskDetail(db, user.id, {
        organisationId: params.organisationId,
        engagementId: params.engagementId,
        riskId: params.riskId,
      });
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });

  if (!risk) notFound();

  const primaryControl = risk.sourceControls[0] ?? null;

  const [controlTestRows, evidenceRows] =
    risk.sourceAssessment && primaryControl
      ? await withRequestDb(user.id, async (db) => {
          const tests = await getControlTestsForControl(db, risk.sourceAssessment!.id, primaryControl.id);
          const ev = await getEvidenceSummaryForControl(db, risk.sourceAssessmentResponse?.id ?? null, tests.map((t) => t.id));
          return [tests, ev] as const;
        })
      : ([[], []] as const);

  const findingRows = await withRequestDb(user.id, (db) => listFindingsForRisk(db, risk.id));

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/risks`} className="hover:underline">
          Back to risks
        </Link>
      </p>
      <div className="mt-1 flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold text-slate-900">{risk.title}</h1>
        <div className="flex shrink-0 gap-2">
          <Badge tone={riskRatingTone(risk.inherentRating)}>{risk.inherentRating}</Badge>
          <Badge tone={riskStatusTone(risk.status)}>{risk.status}</Badge>
        </div>
      </div>
      {risk.description ? <p className="mt-2 text-sm text-slate-700">{risk.description}</p> : null}

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
        <section className="rounded-md border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Scoring</h2>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-slate-600">Likelihood</dt>
              <dd className="text-slate-900">{risk.likelihood} / 5</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Impact</dt>
              <dd className="text-slate-900">{risk.impact} / 5</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Inherent rating</dt>
              <dd>
                <Badge tone={riskRatingTone(risk.inherentRating)}>{risk.inherentRating}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Scoring methodology</dt>
              <dd className="text-slate-900">
                {risk.scoringModel.name} ({risk.scoringModel.version})
              </dd>
            </div>
            {risk.residualRating ? (
              <>
                <div>
                  <dt className="text-xs font-medium text-slate-600">Residual likelihood</dt>
                  <dd className="text-slate-900">{risk.residualLikelihood} / 5</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-600">Residual impact</dt>
                  <dd className="text-slate-900">{risk.residualImpact} / 5</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-600">Residual rating</dt>
                  <dd>
                    <Badge tone={riskRatingTone(risk.residualRating)}>{risk.residualRating}</Badge>
                  </dd>
                </div>
              </>
            ) : (
              <div>
                <dt className="text-xs font-medium text-slate-600">Residual scoring</dt>
                <dd className="text-slate-500">Not yet recorded</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Recorded by the assessing consultant against the pinned scoring methodology above — not automatically computed
            from likelihood × impact (no scoring calculator exists yet; see PROGRESS.md).
          </p>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Status &amp; ownership</h2>
          <form action={updateRiskStatusAction} className="mt-2 flex items-end gap-2">
            <input type="hidden" name="organisationId" value={params.organisationId} />
            <input type="hidden" name="engagementId" value={params.engagementId} />
            <input type="hidden" name="riskId" value={risk.id} />
            <div>
              <label htmlFor="status" className="block text-xs font-medium text-slate-700">
                Status
              </label>
              <select
                id="status"
                name="status"
                defaultValue={risk.status}
                className="mt-1 block rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Save status
            </Button>
          </form>
          <dl className="mt-4 space-y-2 text-sm">
            <div>
              <dt className="text-xs font-medium text-slate-600">Owner</dt>
              <dd className="text-slate-900">{risk.ownerEmail ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Recorded</dt>
              <dd className="text-slate-900">{new Date(risk.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Last updated</dt>
              <dd className="text-slate-900">{new Date(risk.updatedAt).toLocaleString()}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Source traceability</h2>
          <p className="mt-1 text-xs text-slate-500">Where this risk came from — the assessment context that identified it.</p>
          <dl className="mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-slate-600">Source control(s)</dt>
              <dd className="text-slate-900">
                {risk.sourceControls.length === 0
                  ? "Not linked to a specific control."
                  : risk.sourceControls.map((c) => (
                      <span key={c.id} className="mr-2 inline-block">
                        <span className="font-mono text-xs">{c.code}</span> {c.title}
                      </span>
                    ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Source assessment</dt>
              <dd className="text-slate-900">
                {risk.sourceAssessment && primaryControl ? (
                  <Link
                    href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/assessments/${risk.sourceAssessment.id}?control=${primaryControl.id}`}
                    className="underline"
                  >
                    {risk.sourceAssessment.periodLabel}
                  </Link>
                ) : (
                  "No assessment response recorded yet."
                )}
              </dd>
            </div>
            {risk.sourceAssessmentResponse ? (
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
            Evidence linked to the source assessment response / control tests above — this risk references the same
            authoritative Evidence records shown in the Assessment workspace, not a copy.
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
        <section className="rounded-md border border-slate-200 bg-white p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Findings</h2>
            <Link
              href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/findings`}
              className="text-xs font-medium text-slate-900 underline"
            >
              View all engagement findings
            </Link>
          </div>
          {findingRows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No findings recorded from this risk yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {findingRows.map((f) => (
                <li key={f.id} className="rounded border border-slate-100 p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/findings/${f.id}`}
                      className="font-medium text-slate-900 underline"
                    >
                      {f.title}
                    </Link>
                    <div className="flex items-center gap-2">
                      <Badge tone={riskRatingTone(f.severity)}>{f.severity}</Badge>
                      <Badge tone={findingStatusTone(f.status)}>{f.status}</Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Owner: {f.ownerEmail ?? "unassigned"}</p>
                </li>
              ))}
            </ul>
          )}

          <form action={createFindingAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            <input type="hidden" name="organisationId" value={params.organisationId} />
            <input type="hidden" name="engagementId" value={params.engagementId} />
            <input type="hidden" name="riskId" value={risk.id} />

            <div>
              <label htmlFor="findingTitle" className="block text-xs font-medium text-slate-700">
                Finding title
              </label>
              <input id="findingTitle" name="title" type="text" required maxLength={200} className={FORM_INPUT_CLASS} />
            </div>
            <div>
              <label htmlFor="findingDescription" className="block text-xs font-medium text-slate-700">
                Description
              </label>
              <textarea id="findingDescription" name="description" rows={2} className={FORM_INPUT_CLASS} />
            </div>
            <div>
              <label htmlFor="findingSeverity" className="block text-xs font-medium text-slate-700">
                Severity
              </label>
              <select id="findingSeverity" name="severity" defaultValue={risk.inherentRating} className={FORM_INPUT_CLASS}>
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">Defaults to this risk&rsquo;s inherent rating — not automatically linked; change as needed.</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" name="assignOwnerToSelf" />
              Assign this finding to me
            </label>
            <Button type="submit" variant="secondary" size="sm">
              Create finding
            </Button>
          </form>
        </section>
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Remediation and validation for this finding are not yet part of this application — this is the Risk Engine plus
        Findings only (Slices C3/C4).
      </p>
    </div>
  );
}
