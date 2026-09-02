import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import {
  getAssessmentDetail,
  getControlRequirements,
  getControlTestsForControl,
} from "@/lib/domain/assessments";
import { getEvidenceSummaryForControl } from "@/lib/domain/evidence";
import { listRisksForControl } from "@/lib/domain/risks";
import { getMaturityAssessmentForAssessment } from "@/lib/domain/maturity";
import { NotFoundOrForbiddenError, canFinalizeAssessment, canComputeMaturity, canReviewEvidence, canManageRisk } from "@/lib/authorization/service";
import { Badge, statusTone, riskRatingTone, riskStatusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  updateAssessmentResponseAction,
  createControlTestAction,
  uploadEvidenceAction,
  reviewEvidenceAction,
  unlinkEvidenceAction,
  createRiskAction,
  finalizeAssessmentAction,
  computeMaturityAction,
} from "./actions";

const RATING_OPTIONS = ["low", "medium", "high", "critical"] as const;

const EFFECTIVENESS_OPTIONS = [
  { value: "not_assessed", label: "Not Assessed" },
  { value: "not_applicable", label: "Not Applicable" },
  { value: "not_implemented", label: "Not Implemented" },
  { value: "partially_implemented", label: "Partially Implemented" },
  { value: "implemented", label: "Implemented" },
] as const;

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

// The Assessment workspace (PHASE C instructions §2/§6) — the primary
// consultant screen for this slice, superseding Slice A1's minimal
// one-card-per-control vertical slice at the same URL (that slice was
// explicitly described as a minimal proof, not the final UI). Real
// PostgreSQL data throughout; no mock assessment data anywhere.
export default async function AssessmentWorkspacePage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string; assessmentId: string };
  searchParams: { control?: string; q?: string; status?: string; error?: string; saved?: string };
}) {
  const user = await requireAuthenticatedUser();

  const assessment = await withRequestDb(user.id, async (db) => {
    try {
      return await getAssessmentDetail(db, user.id, params.assessmentId);
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });

  if (!assessment || assessment.engagementId !== params.engagementId || assessment.organisationId !== params.organisationId) {
    notFound();
  }

  const finalized = assessment.status === "finalized";

  // Slice C7.3: the server independently re-decides whether to render
  // the Finalize control at all — never inferred from the client, and
  // re-checked again by finalizeAssessmentAction/finalizeAssessment
  // itself regardless of what this render decided (instructions §4: the
  // browser must not be trusted to submit `status = finalized`).
  const canFinalize = !finalized
    ? await withRequestDb(user.id, (db) => canFinalizeAssessment(db, user.id, assessment.engagementId, assessment.organisationId))
    : false;

  // P2A (Authorization & Confidentiality Hardening): the server independently
  // re-decides whether to render the consultant-only evidence-review and
  // risk-management controls at all — never inferred from the client. This
  // mirrors `canFinalize` above; the domain functions (reviewEvidence,
  // createRisk) re-check the same permission regardless of what this render
  // decided, so hiding the control here is a UX courtesy, not the security
  // boundary.
  const [canReviewEvidenceResult, canManageRiskResult] = await withRequestDb(user.id, async (db) => {
    const [reviewEv, manageRisk] = await Promise.all([
      canReviewEvidence(db, user.id, assessment.engagementId, assessment.organisationId),
      canManageRisk(db, user.id, assessment.engagementId, assessment.organisationId),
    ]);
    return [reviewEv, manageRisk] as const;
  });

  // M2 (Maturity Implementation, approval §25): maturity is only ever
  // relevant once the Assessment is finalized (lib/domain/maturity.ts's
  // own precondition) — no query, no permission check, and no section
  // rendered at all otherwise, exactly mirroring how `canFinalize` above
  // is skipped once already finalized.
  const [maturity, canComputeMaturityResult] = finalized
    ? await withRequestDb(user.id, async (db) => {
        const result = await getMaturityAssessmentForAssessment(db, user.id, {
          assessmentId: assessment.id,
          organisationId: assessment.organisationId,
          engagementId: assessment.engagementId,
        });
        const canCompute = result ? false : await canComputeMaturity(db, user.id, assessment.engagementId, assessment.organisationId);
        return [result, canCompute] as const;
      })
    : ([null, false] as const);

  // Basic PostgreSQL-backed filtering/search (instructions §22) applied
  // over the already-fetched, bounded control list — see
  // lib/domain/assessments.ts's getAssessmentDetail docstring for why
  // this isn't a second SQL query: progress must always reflect the
  // unfiltered whole, and a real Assessment's control count is bounded
  // (tens to a few hundred), not the kind of dataset that needs a
  // dedicated search engine (instructions §20).
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const statusFilter = searchParams.status === "completed" || searchParams.status === "pending" ? searchParams.status : "all";
  const filteredRows = assessment.controlRows.filter((row) => {
    const matchesQuery = !q || row.controlCode.toLowerCase().includes(q) || row.controlTitle.toLowerCase().includes(q);
    const matchesStatus =
      statusFilter === "all" || (statusFilter === "completed" ? row.response !== null : row.response === null);
    return matchesQuery && matchesStatus;
  });

  const selectedId = searchParams.control ?? filteredRows[0]?.assessmentControlId ?? assessment.controlRows[0]?.assessmentControlId;
  const selected = assessment.controlRows.find((r) => r.assessmentControlId === selectedId) ?? null;
  const selectedIndex = selected ? assessment.controlRows.findIndex((r) => r.assessmentControlId === selected.assessmentControlId) : -1;
  const prevControl = selectedIndex > 0 ? assessment.controlRows[selectedIndex - 1]! : null;
  const nextControl =
    selectedIndex >= 0 && selectedIndex < assessment.controlRows.length - 1 ? assessment.controlRows[selectedIndex + 1]! : null;

  const [requirementsList, controlTestRows, evidenceRows, riskRows] = selected
    ? await withRequestDb(user.id, async (db) => {
        const reqs = await getControlRequirements(db, selected.controlId);
        const tests = await getControlTestsForControl(db, assessment.id, selected.controlId);
        const ev = await getEvidenceSummaryForControl(db, selected.response?.id ?? null, tests.map((t) => t.id), canReviewEvidenceResult);
        const risks = await listRisksForControl(db, { engagementId: params.engagementId, controlId: selected.controlId });
        return [reqs, tests, ev, risks] as const;
      })
    : ([[], [], [], []] as const);

  const basePath = `/organisations/${params.organisationId}/engagements/${params.engagementId}/assessments/${params.assessmentId}`;
  const pct = assessment.progress.total > 0 ? Math.round((assessment.progress.completed / assessment.progress.total) * 100) : 0;

  // What a new piece of Evidence for this control can be linked to
  // (PHASE C2 instructions §13) — the control's own AssessmentResponse,
  // if one has been recorded, plus each of its own ControlTests. If
  // neither exists yet, there is nothing a new EvidenceLink could
  // legitimately point at, so the upload form itself is withheld rather
  // than offered and then rejected server-side.
  const linkTargetOptions = selected
    ? [
        ...(selected.response
          ? [{ value: `assessment_response:${selected.response.id}`, label: "This control's assessment response" }]
          : []),
        ...controlTestRows.map((t, i) => ({
          value: `control_test:${t.id}`,
          label: `Control test #${controlTestRows.length - i} (${t.result}, ${new Date(t.createdAt).toLocaleDateString()})`,
        })),
      ]
    : [];

  function controlHref(controlId: string): string {
    const sp = new URLSearchParams();
    sp.set("control", controlId);
    if (q) sp.set("q", q);
    if (statusFilter !== "all") sp.set("status", statusFilter);
    return `${basePath}?${sp.toString()}`;
  }

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${params.organisationId}/engagements/${params.engagementId}`} className="hover:underline">
          Back to engagement
        </Link>
      </p>
      <div className="mt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{assessment.periodLabel}</h1>
          <p className="text-sm text-slate-600">
            {assessment.assessmentType} · {assessment.controlLibraryVersionLabel ?? "no methodology pinned"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Badge tone={statusTone(assessment.status)}>{assessment.status}</Badge>
          <p
            className="mt-1 text-xs text-slate-600"
            aria-label={`${assessment.progress.completed} of ${assessment.progress.total} controls responded, ${pct} percent`}
          >
            {assessment.progress.completed}/{assessment.progress.total} controls ({pct}%)
          </p>
        </div>
      </div>

      {finalized ? (
        <p role="status" className="mt-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          This assessment is finalized. Responses, rationale, control tests, and evidence links are permanently
          locked. A correction is made by creating a new assessment, never by editing this one.
        </p>
      ) : canFinalize ? (
        <details className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-amber-900">Finalize this assessment…</summary>
          <div className="mt-2 space-y-2">
            <p className="text-sm text-amber-800">
              Finalizing is permanent. Responses, rationale, control tests, and evidence links become locked and can
              never be edited again — a correction after this point means starting a new assessment. Risks,
              findings, remediation, and validation are not affected and continue normally.
            </p>
            <form action={finalizeAssessmentAction}>
              <input type="hidden" name="organisationId" value={params.organisationId} />
              <input type="hidden" name="engagementId" value={params.engagementId} />
              <input type="hidden" name="assessmentId" value={params.assessmentId} />
              <Button type="submit" variant="destructive" size="sm">
                Finalize assessment
              </Button>
            </form>
          </div>
        </details>
      ) : null}
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

      {finalized ? (
        <section className="mt-4 rounded-md border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Maturity</h3>
          {maturity ? (
            <div className="mt-2">
              <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
                This is the permanent, finalized maturity result for this Assessment — computed once and immutable.
                A correction is made by creating a new Assessment, never by recomputing this one.
              </p>
              <div className="mt-3 flex items-baseline gap-3">
                <span className="text-2xl font-semibold text-slate-900">
                  {maturity.overallScore ?? "—"}
                  <span className="text-sm font-normal text-slate-500"> / 5</span>
                </span>
                {maturity.overallLevel ? <Badge tone="positive">{maturity.overallLevel}</Badge> : null}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {maturity.methodologyName} {maturity.methodologyVersion}
              </p>
              {maturity.domains.length > 0 ? (
                <table className="mt-3 w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-slate-500">
                      <th className="pb-1 font-medium">Domain</th>
                      <th className="pb-1 font-medium">Score</th>
                      <th className="pb-1 font-medium">Level</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {maturity.domains.map((d) => (
                      <tr key={d.maturityDomainId}>
                        <td className="py-1.5 text-slate-900">{d.domainName}</td>
                        <td className="py-1.5 text-slate-700">{d.score} / 5</td>
                        <td className="py-1.5">{d.level ? <Badge tone="positive">{d.level}</Badge> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : canComputeMaturityResult ? (
            <div className="mt-2">
              <p className="text-sm text-slate-600">
                Maturity has not yet been computed for this Assessment. Computing is a one-time, permanent action —
                it requires every eligible control across every scorable domain to have a real rating; any
                unanswered eligible control will block computation and be reported here.
              </p>
              <form action={computeMaturityAction} className="mt-3">
                <input type="hidden" name="organisationId" value={params.organisationId} />
                <input type="hidden" name="engagementId" value={params.engagementId} />
                <input type="hidden" name="assessmentId" value={params.assessmentId} />
                <Button type="submit" size="sm">
                  Compute maturity
                </Button>
              </form>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Maturity has not yet been computed for this Assessment.</p>
          )}
        </section>
      ) : null}

      {assessment.controlRows.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          No controls are in scope for this assessment.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
          <aside>
            <form method="GET" className="space-y-2">
              <div>
                <label htmlFor="q" className="sr-only">
                  Search controls by code or title
                </label>
                <input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={searchParams.q ?? ""}
                  placeholder="Search code or title…"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="status" className="sr-only">
                  Filter by completion status
                </label>
                <select id="status" name="status" defaultValue={statusFilter} className={INPUT_CLASS}>
                  <option value="all">All controls</option>
                  <option value="completed">Responded</option>
                  <option value="pending">Not yet responded</option>
                </select>
              </div>
              <Button type="submit" variant="secondary" size="sm">
                Filter
              </Button>
            </form>

            <nav aria-label="Assessment controls" className="mt-4 max-h-[65vh] overflow-y-auto rounded-md border border-slate-200 bg-white">
              {filteredRows.length === 0 ? (
                <p className="px-3 py-4 text-sm text-slate-500">No controls match this filter.</p>
              ) : (
                <ul className="divide-y divide-slate-200">
                  {filteredRows.map((row) => {
                    const isSelected = row.assessmentControlId === selected?.assessmentControlId;
                    return (
                      <li key={row.assessmentControlId}>
                        <Link
                          href={controlHref(row.assessmentControlId)}
                          aria-current={isSelected ? "true" : undefined}
                          className={cn("block px-3 py-2 text-sm hover:bg-slate-50", isSelected && "bg-slate-100")}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs text-slate-500">{row.controlCode}</span>
                            <span aria-hidden="true" className={row.response ? "text-emerald-600" : "text-slate-400"}>
                              {row.response ? "✓" : "—"}
                            </span>
                            <span className="sr-only">{row.response ? "Responded" : "Not yet responded"}</span>
                          </div>
                          <p className="mt-0.5 truncate text-slate-900">{row.controlTitle}</p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </nav>
          </aside>

          <main>
            {!selected ? (
              <div className="rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
                Select a control from the list.
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center gap-4 text-sm">
                  {prevControl ? (
                    <Link href={controlHref(prevControl.assessmentControlId)} className="text-slate-700 hover:underline">
                      ← Previous control
                    </Link>
                  ) : (
                    <span className="text-slate-300">← Previous control</span>
                  )}
                  {nextControl ? (
                    <Link href={controlHref(nextControl.assessmentControlId)} className="text-slate-700 hover:underline">
                      Next control →
                    </Link>
                  ) : (
                    <span className="text-slate-300">Next control →</span>
                  )}
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-4">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-slate-500">{selected.controlCode}</span>
                    <h2 className="text-base font-semibold text-slate-900">{selected.controlTitle}</h2>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{selected.controlType}</p>
                  {selected.controlDescription ? (
                    <p className="mt-2 text-sm text-slate-700">{selected.controlDescription}</p>
                  ) : null}
                </div>

                <section className="rounded-md border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Mapped Requirements</h3>
                  {requirementsList.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">No requirements mapped to this control.</p>
                  ) : (
                    <ul className="mt-2 space-y-3">
                      {requirementsList.map((r) => (
                        <li key={r.id} className="text-sm">
                          <p className="font-medium text-slate-900">{r.title}</p>
                          {r.description ? <p className="text-slate-600">{r.description}</p> : null}
                          {r.regulatoryReference ? (
                            <p className="mt-0.5 text-xs text-slate-500">
                              {r.regulatoryReference.frameworkName} — {r.regulatoryReference.citation}: {r.regulatoryReference.title}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-md border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Assessment Response</h3>
                  {finalized ? (
                    <div className="mt-2 text-sm text-slate-700">
                      <p>
                        <span className="font-medium">Rating:</span>{" "}
                        {selected.response ? formatEffectiveness(selected.response.effectivenessRating) : "Not yet responded."}
                      </p>
                      {selected.response?.decisionRationale ? (
                        <p className="mt-1 text-slate-600">{selected.response.decisionRationale}</p>
                      ) : null}
                    </div>
                  ) : (
                    <form action={updateAssessmentResponseAction} className="mt-2 space-y-2">
                      <input type="hidden" name="organisationId" value={params.organisationId} />
                      <input type="hidden" name="engagementId" value={params.engagementId} />
                      <input type="hidden" name="assessmentId" value={params.assessmentId} />
                      <input type="hidden" name="assessmentControlId" value={selected.assessmentControlId} />
                      <input type="hidden" name="returnTo" value={controlHref(selected.assessmentControlId)} />

                      <div>
                        <label htmlFor="rating" className="block text-xs font-medium text-slate-700">
                          Effectiveness rating
                        </label>
                        <select
                          id="rating"
                          name="effectivenessRating"
                          defaultValue={selected.response?.effectivenessRating ?? "not_assessed"}
                          className={cn(INPUT_CLASS, "max-w-xs")}
                        >
                          {EFFECTIVENESS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="rationale" className="block text-xs font-medium text-slate-700">
                          Decision rationale
                        </label>
                        <textarea
                          id="rationale"
                          name="decisionRationale"
                          rows={3}
                          defaultValue={selected.response?.decisionRationale ?? ""}
                          className={INPUT_CLASS}
                        />
                      </div>
                      <Button type="submit" size="sm">
                        Save response
                      </Button>
                    </form>
                  )}

                  <dl className="mt-4 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 sm:grid-cols-3">
                    <div>
                      <dt className="font-medium text-slate-600">System-suggested rating</dt>
                      <dd>{selected.response?.systemSuggestedRating ? formatEffectiveness(selected.response.systemSuggestedRating) : "Not yet available"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-600">Respondent</dt>
                      <dd>{selected.response?.respondentEmail ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-600">Submitted</dt>
                      <dd>{selected.response?.submittedAt ? new Date(selected.response.submittedAt).toLocaleString() : "—"}</dd>
                    </div>
                  </dl>
                </section>

                <section className="rounded-md border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Control Tests</h3>
                  {controlTestRows.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">No control tests recorded yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {controlTestRows.map((t) => (
                        <li key={t.id} className="rounded border border-slate-100 p-2 text-sm">
                          <div className="flex items-center justify-between">
                            <Badge tone={statusTone(t.result)}>{t.result}</Badge>
                            <span className="text-xs text-slate-500">
                              {t.testedAt ? new Date(t.testedAt).toLocaleDateString() : "date not recorded"}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-700">{t.methodology}</p>
                          {t.sampleDescription ? <p className="text-slate-600">{t.sampleDescription}</p> : null}
                          <p className="mt-1 text-xs text-slate-500">Tester: {t.testerEmail ?? "—"}</p>
                        </li>
                      ))}
                    </ul>
                  )}

                  {!finalized ? (
                    <form action={createControlTestAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                      <input type="hidden" name="organisationId" value={params.organisationId} />
                      <input type="hidden" name="engagementId" value={params.engagementId} />
                      <input type="hidden" name="assessmentId" value={params.assessmentId} />
                      <input type="hidden" name="controlId" value={selected.controlId} />
                      <input type="hidden" name="returnTo" value={controlHref(selected.assessmentControlId)} />

                      <div>
                        <label htmlFor="methodology" className="block text-xs font-medium text-slate-700">
                          Methodology
                        </label>
                        <textarea id="methodology" name="methodology" required rows={2} className={INPUT_CLASS} />
                      </div>
                      <div>
                        <label htmlFor="sampleDescription" className="block text-xs font-medium text-slate-700">
                          Sample description
                        </label>
                        <textarea id="sampleDescription" name="sampleDescription" rows={2} className={INPUT_CLASS} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label htmlFor="result" className="block text-xs font-medium text-slate-700">
                            Result
                          </label>
                          <select id="result" name="result" defaultValue="pass" className={INPUT_CLASS}>
                            <option value="pass">Pass</option>
                            <option value="fail">Fail</option>
                            <option value="exception_noted">Exception noted</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor="testedAt" className="block text-xs font-medium text-slate-700">
                            Tested on
                          </label>
                          <input id="testedAt" name="testedAt" type="date" className={INPUT_CLASS} />
                        </div>
                      </div>
                      <Button type="submit" variant="secondary" size="sm">
                        Record control test
                      </Button>
                    </form>
                  ) : null}
                </section>

                <section className="rounded-md border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Evidence</h3>
                  {evidenceRows.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">No evidence linked yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-3">
                      {evidenceRows.map((e) => (
                        <li key={e.evidenceLinkId} className="rounded border border-slate-100 p-2 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-slate-900">{e.title}</p>
                              <p className="text-xs text-slate-500">
                                {e.evidenceType} · {e.originalFilename}
                                {e.qualityRating ? <> · quality: {e.qualityRating}</> : null}
                              </p>
                            </div>
                            <Badge tone={statusTone(e.reviewStatus)}>{e.reviewStatus}</Badge>
                          </div>

                          {e.reviewStatus !== "pending_review" ? (
                            <p className="mt-1 text-xs text-slate-500">
                              Reviewed by {e.reviewedByEmail ?? "—"}
                              {e.reviewedAt ? <> on {new Date(e.reviewedAt).toLocaleDateString()}</> : null}
                              {e.reviewRationale ? <>: {e.reviewRationale}</> : null}
                            </p>
                          ) : null}
                          {e.validUntil ? (
                            <p className="mt-0.5 text-xs text-slate-500">Valid until {new Date(e.validUntil).toLocaleDateString()}</p>
                          ) : null}

                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <a
                              href={`${basePath}/evidence/${e.id}/download`}
                              className="text-xs font-medium text-slate-900 underline"
                            >
                              View / download
                            </a>

                            {!finalized && e.reviewStatus === "pending_review" && canReviewEvidenceResult ? (
                              <>
                                <form action={reviewEvidenceAction}>
                                  <input type="hidden" name="organisationId" value={params.organisationId} />
                                  <input type="hidden" name="engagementId" value={params.engagementId} />
                                  <input type="hidden" name="assessmentId" value={params.assessmentId} />
                                  <input type="hidden" name="evidenceId" value={e.id} />
                                  <input type="hidden" name="reviewStatus" value="accepted" />
                                  <input type="hidden" name="returnTo" value={controlHref(selected.assessmentControlId)} />
                                  <Button type="submit" variant="secondary" size="sm">
                                    Accept
                                  </Button>
                                </form>
                                <details className="inline-block">
                                  <summary className="cursor-pointer text-xs font-medium text-red-700">Reject…</summary>
                                  <form action={reviewEvidenceAction} className="mt-2 space-y-2">
                                    <input type="hidden" name="organisationId" value={params.organisationId} />
                                    <input type="hidden" name="engagementId" value={params.engagementId} />
                                    <input type="hidden" name="assessmentId" value={params.assessmentId} />
                                    <input type="hidden" name="evidenceId" value={e.id} />
                                    <input type="hidden" name="reviewStatus" value="rejected" />
                                    <input type="hidden" name="returnTo" value={controlHref(selected.assessmentControlId)} />
                                    <label htmlFor={`reject-rationale-${e.id}`} className="block text-xs font-medium text-slate-700">
                                      Reason for rejection
                                    </label>
                                    <textarea
                                      id={`reject-rationale-${e.id}`}
                                      name="reviewRationale"
                                      required
                                      rows={2}
                                      className={INPUT_CLASS}
                                    />
                                    <Button type="submit" variant="destructive" size="sm">
                                      Reject
                                    </Button>
                                  </form>
                                </details>
                              </>
                            ) : null}

                            {!finalized ? (
                              <form action={unlinkEvidenceAction}>
                                <input type="hidden" name="organisationId" value={params.organisationId} />
                                <input type="hidden" name="engagementId" value={params.engagementId} />
                                <input type="hidden" name="assessmentId" value={params.assessmentId} />
                                <input type="hidden" name="evidenceLinkId" value={e.evidenceLinkId} />
                                <input type="hidden" name="returnTo" value={controlHref(selected.assessmentControlId)} />
                                <Button type="submit" variant="ghost" size="sm">
                                  Unlink
                                </Button>
                              </form>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {!finalized ? (
                    linkTargetOptions.length === 0 ? (
                      <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-500">
                        Record a response or control test for this control before attaching evidence.
                      </p>
                    ) : (
                      <form action={uploadEvidenceAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4" encType="multipart/form-data">
                        <input type="hidden" name="organisationId" value={params.organisationId} />
                        <input type="hidden" name="engagementId" value={params.engagementId} />
                        <input type="hidden" name="assessmentId" value={params.assessmentId} />
                        <input type="hidden" name="returnTo" value={controlHref(selected.assessmentControlId)} />

                        <div>
                          <label htmlFor="evidenceTitle" className="block text-xs font-medium text-slate-700">
                            Title
                          </label>
                          <input id="evidenceTitle" name="title" type="text" required maxLength={200} className={INPUT_CLASS} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label htmlFor="evidenceType" className="block text-xs font-medium text-slate-700">
                              Evidence type
                            </label>
                            <select id="evidenceType" name="evidenceType" defaultValue="policy_document" className={INPUT_CLASS}>
                              <option value="policy_document">Policy document</option>
                              <option value="screenshot">Screenshot</option>
                              <option value="system_configuration_export">System configuration export</option>
                              <option value="signed_agreement">Signed agreement</option>
                              <option value="certificate">Certificate</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                          <div>
                            <label htmlFor="linkTarget" className="block text-xs font-medium text-slate-700">
                              Supports
                            </label>
                            <select id="linkTarget" name="linkTarget" defaultValue={linkTargetOptions[0]?.value} className={INPUT_CLASS}>
                              {linkTargetOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label htmlFor="evidenceFile" className="block text-xs font-medium text-slate-700">
                            File (PDF, image, Office document, or text — 25MB max)
                          </label>
                          <input id="evidenceFile" name="file" type="file" required className={INPUT_CLASS} />
                        </div>
                        <Button type="submit" size="sm">
                          Upload evidence
                        </Button>
                      </form>
                    )
                  ) : null}
                </section>

                <section className="rounded-md border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">Risks</h3>
                    <Link
                      href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/risks`}
                      className="text-xs font-medium text-slate-900 underline"
                    >
                      View all engagement risks
                    </Link>
                  </div>
                  {riskRows.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">No risks recorded from this control yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {riskRows.map((r) => (
                        <li key={r.id} className="rounded border border-slate-100 p-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <Link
                              href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/risks/${r.id}`}
                              className="font-medium text-slate-900 underline"
                            >
                              {r.title}
                            </Link>
                            <div className="flex items-center gap-2">
                              <Badge tone={riskRatingTone(r.inherentRating)}>{r.inherentRating}</Badge>
                              <Badge tone={riskStatusTone(r.status)}>{r.status}</Badge>
                            </div>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {r.residualRating ? <>Residual: {r.residualRating} · </> : null}
                            Owner: {r.ownerEmail ?? "unassigned"}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}

                  {canManageRiskResult ? (
                  <form action={createRiskAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                    <input type="hidden" name="organisationId" value={params.organisationId} />
                    <input type="hidden" name="engagementId" value={params.engagementId} />
                    <input type="hidden" name="assessmentId" value={params.assessmentId} />
                    <input type="hidden" name="controlId" value={selected.controlId} />
                    <input type="hidden" name="returnTo" value={controlHref(selected.assessmentControlId)} />

                    <div>
                      <label htmlFor="riskTitle" className="block text-xs font-medium text-slate-700">
                        Risk title
                      </label>
                      <input id="riskTitle" name="title" type="text" required maxLength={200} className={INPUT_CLASS} />
                    </div>
                    <div>
                      <label htmlFor="riskDescription" className="block text-xs font-medium text-slate-700">
                        Description
                      </label>
                      <textarea id="riskDescription" name="description" rows={2} className={INPUT_CLASS} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label htmlFor="likelihood" className="block text-xs font-medium text-slate-700">
                          Likelihood (1–5)
                        </label>
                        <select id="likelihood" name="likelihood" defaultValue="3" className={INPUT_CLASS}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="impact" className="block text-xs font-medium text-slate-700">
                          Impact (1–5)
                        </label>
                        <select id="impact" name="impact" defaultValue="3" className={INPUT_CLASS}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="inherentRating" className="block text-xs font-medium text-slate-700">
                          Inherent rating
                        </label>
                        <select id="inherentRating" name="inherentRating" defaultValue="medium" className={INPUT_CLASS}>
                          {RATING_OPTIONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <details>
                      <summary className="cursor-pointer text-xs font-medium text-slate-700">
                        Residual scoring (optional)
                      </summary>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <div>
                          <label htmlFor="residualLikelihood" className="block text-xs font-medium text-slate-700">
                            Residual likelihood
                          </label>
                          <select id="residualLikelihood" name="residualLikelihood" defaultValue="" className={INPUT_CLASS}>
                            <option value="">—</option>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="residualImpact" className="block text-xs font-medium text-slate-700">
                            Residual impact
                          </label>
                          <select id="residualImpact" name="residualImpact" defaultValue="" className={INPUT_CLASS}>
                            <option value="">—</option>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="residualRating" className="block text-xs font-medium text-slate-700">
                            Residual rating
                          </label>
                          <select id="residualRating" name="residualRating" defaultValue="" className={INPUT_CLASS}>
                            <option value="">—</option>
                            {RATING_OPTIONS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </details>

                    <label className="flex items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" name="assignOwnerToSelf" />
                      Assign this risk to me
                    </label>

                    <Button type="submit" variant="secondary" size="sm">
                      Create risk
                    </Button>
                  </form>
                  ) : null}
                </section>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function formatEffectiveness(value: string): string {
  return EFFECTIVENESS_OPTIONS.find((opt) => opt.value === value)?.label ?? value;
}
