import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import {
  getAssessmentDetail,
  getControlRequirements,
  getControlTestsForControl,
  getEvidenceSummaryForControl,
} from "@/lib/domain/assessments";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { updateAssessmentResponseAction, createControlTestAction } from "./actions";

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

  const [requirementsList, controlTestRows, evidenceRows] = selected
    ? await withRequestDb(user.id, async (db) => {
        const reqs = await getControlRequirements(db, selected.controlId);
        const tests = await getControlTestsForControl(db, assessment.id, selected.controlId);
        const ev = await getEvidenceSummaryForControl(db, selected.response?.id ?? null, tests.map((t) => t.id));
        return [reqs, tests, ev] as const;
      })
    : ([[], [], []] as const);

  const basePath = `/organisations/${params.organisationId}/engagements/${params.engagementId}/assessments/${params.assessmentId}`;
  const pct = assessment.progress.total > 0 ? Math.round((assessment.progress.completed / assessment.progress.total) * 100) : 0;

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
          This assessment is finalized. Responses, rationale, and control tests are locked and cannot be edited.
        </p>
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
                    <ul className="mt-2 space-y-1">
                      {evidenceRows.map((e) => (
                        <li key={e.id} className="flex items-center justify-between text-sm">
                          <span className="text-slate-900">{e.title}</span>
                          <span className="flex items-center gap-2">
                            <span className="text-xs text-slate-500">{e.evidenceType}</span>
                            <Badge tone={statusTone(e.reviewStatus)}>{e.reviewStatus}</Badge>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
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
