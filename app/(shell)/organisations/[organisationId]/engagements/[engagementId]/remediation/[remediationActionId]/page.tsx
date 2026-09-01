import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getRemediationActionDetail } from "@/lib/domain/remediation";
import { getFindingDetail } from "@/lib/domain/findings";
import { getRiskDetail } from "@/lib/domain/risks";
import { getControlTestsForControl } from "@/lib/domain/assessments";
import { getEvidenceSummaryForControl, getEvidenceSummaryForRemediationAction, getEvidenceSummaryForValidationRecords } from "@/lib/domain/evidence";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, riskRatingTone, findingStatusTone, remediationStatusTone, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateRemediationActionAction, uploadRemediationEvidenceAction, createValidationRecordAction, uploadValidationEvidenceAction } from "../actions";

const PRIORITY_OPTIONS = ["low", "medium", "high", "critical"] as const;
const STATUS_OPTIONS = ["open", "in_progress", "evidence_submitted", "validated", "closed"] as const;
const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

// Slice C5 (PHASE C5 instructions §11): RemediationAction detail —
// identity, status, priority, owner, due date, an edit form, source
// Finding(s), the full Finding → Risk → Assessment → Control →
// AssessmentResponse → Evidence chain (composed from EXISTING functions,
// one layer deeper than Finding detail's own composition), and Evidence
// submitted DIRECTLY against this remediation action (the real,
// EvidenceLink `remediation_action` subject type, extended this slice).
//
// Slice C6 (PHASE C — VALIDATION, instructions §13/§14/§15): the
// "Validation" section below is embedded here, not a top-level screen
// (PRODUCT_UX_BLUEPRINT.md row #16) — the full validation history, a
// create-validation form, and per-record evidence upload (the
// EvidenceLink `validation_record` subject type, extended this slice).
export default async function RemediationActionDetailPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string; remediationActionId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const remediation = await withRequestDb(user.id, async (db) => {
    try {
      return await getRemediationActionDetail(db, user.id, {
        organisationId: params.organisationId,
        engagementId: params.engagementId,
        remediationActionId: params.remediationActionId,
      });
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });

  if (!remediation) notFound();

  const primaryFinding = remediation.sourceFindings[0] ?? null;

  const finding = primaryFinding
    ? await withRequestDb(user.id, async (db) => {
        try {
          return await getFindingDetail(db, user.id, {
            organisationId: params.organisationId,
            engagementId: params.engagementId,
            findingId: primaryFinding.id,
          });
        } catch (err) {
          if (err instanceof NotFoundOrForbiddenError) return null;
          throw err;
        }
      })
    : null;

  const primaryRisk = finding?.sourceRisks[0] ?? null;

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

  const [controlTestRows, indirectEvidenceRows, directEvidenceRows, validationEvidenceRows] = await withRequestDb(user.id, async (db) => {
    const tests =
      risk?.sourceAssessment && primaryControl ? await getControlTestsForControl(db, risk.sourceAssessment.id, primaryControl.id) : [];
    const indirect =
      risk?.sourceAssessment && primaryControl
        ? await getEvidenceSummaryForControl(db, risk.sourceAssessmentResponse?.id ?? null, tests.map((t) => t.id))
        : [];
    const direct = await getEvidenceSummaryForRemediationAction(db, remediation.id);
    const validationEvidence = await getEvidenceSummaryForValidationRecords(
      db,
      remediation.validationRecords.map((v) => v.id),
    );
    return [tests, indirect, direct, validationEvidence] as const;
  });

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/remediation`} className="hover:underline">
          Back to remediation
        </Link>
      </p>
      <div className="mt-1 flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold text-slate-900">{remediation.title}</h1>
        <div className="flex shrink-0 gap-2">
          {remediation.priority ? <Badge tone={riskRatingTone(remediation.priority)}>{remediation.priority}</Badge> : null}
          <Badge tone={remediationStatusTone(remediation.status)}>{remediation.status}</Badge>
        </div>
      </div>
      {remediation.description ? <p className="mt-2 text-sm text-slate-700">{remediation.description}</p> : null}

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
          <h2 className="text-sm font-semibold text-slate-900">Edit remediation action</h2>
          <form action={updateRemediationActionAction} className="mt-2 space-y-2">
            <input type="hidden" name="organisationId" value={params.organisationId} />
            <input type="hidden" name="engagementId" value={params.engagementId} />
            <input type="hidden" name="remediationActionId" value={remediation.id} />

            <div>
              <label htmlFor="title" className="block text-xs font-medium text-slate-700">
                Title
              </label>
              <input id="title" name="title" type="text" required maxLength={200} defaultValue={remediation.title} className={INPUT_CLASS} />
            </div>
            <div>
              <label htmlFor="description" className="block text-xs font-medium text-slate-700">
                Description
              </label>
              <textarea id="description" name="description" rows={2} defaultValue={remediation.description ?? ""} className={INPUT_CLASS} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="priority" className="block text-xs font-medium text-slate-700">
                  Priority
                </label>
                <select id="priority" name="priority" defaultValue={remediation.priority ?? ""} className={INPUT_CLASS}>
                  <option value="">Not set</option>
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="status" className="block text-xs font-medium text-slate-700">
                  Status
                </label>
                <select id="status" name="status" defaultValue={remediation.status} className={INPUT_CLASS}>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="dueDate" className="block text-xs font-medium text-slate-700">
                  Due date
                </label>
                <input id="dueDate" name="dueDate" type="date" defaultValue={remediation.dueDate ?? ""} className={INPUT_CLASS} />
              </div>
            </div>
            <div>
              <label htmlFor="ownerAction" className="block text-xs font-medium text-slate-700">
                Owner
              </label>
              <select id="ownerAction" name="ownerAction" defaultValue="keep" className={INPUT_CLASS}>
                <option value="keep">Keep current ({remediation.ownerEmail ?? "unassigned"})</option>
                <option value="assign_self">Assign to me</option>
                <option value="unassign">Unassign</option>
              </select>
            </div>
            <Button type="submit" size="sm">
              Save remediation action
            </Button>
          </form>
          <dl className="mt-4 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 sm:grid-cols-3">
            <div>
              <dt className="font-medium text-slate-600">Recorded</dt>
              <dd>{new Date(remediation.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-600">Last updated</dt>
              <dd>{new Date(remediation.updatedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-600">Completed</dt>
              <dd>{remediation.completedAt ? new Date(remediation.completedAt).toLocaleString() : "Not yet"}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Source traceability</h2>
          <p className="mt-1 text-xs text-slate-500">Remediation → Finding → Risk → Assessment → Control → Assessment Response.</p>
          <dl className="mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-slate-600">Source finding(s)</dt>
              <dd className="text-slate-900">
                {remediation.sourceFindings.length === 0
                  ? "Not linked to a specific finding."
                  : remediation.sourceFindings.map((f) => (
                      <span key={f.id} className="mr-2 inline-block">
                        <Link
                          href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/findings/${f.id}`}
                          className="underline"
                        >
                          {f.title}
                        </Link>{" "}
                        <Badge tone={riskRatingTone(f.severity)}>{f.severity}</Badge>{" "}
                        <Badge tone={findingStatusTone(f.status)}>{f.status}</Badge>
                      </span>
                    ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Source risk</dt>
              <dd className="text-slate-900">
                {primaryRisk ? (
                  <Link
                    href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/risks/${primaryRisk.id}`}
                    className="underline"
                  >
                    {primaryRisk.title}
                  </Link>
                ) : (
                  "No source risk recorded yet."
                )}
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
                  "No assessment context recorded yet."
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
          <h2 className="text-sm font-semibold text-slate-900">Remediation evidence</h2>
          <p className="mt-1 text-xs text-slate-500">
            Evidence submitted directly against this remediation action — the same Evidence/EvidenceLink architecture used
            throughout this application, never a separate attachment system.
          </p>
          {directEvidenceRows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No evidence submitted yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {directEvidenceRows.map((e) => (
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

          <form action={uploadRemediationEvidenceAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4" encType="multipart/form-data">
            <input type="hidden" name="organisationId" value={params.organisationId} />
            <input type="hidden" name="engagementId" value={params.engagementId} />
            <input type="hidden" name="remediationActionId" value={remediation.id} />

            <div>
              <label htmlFor="evidenceTitle" className="block text-xs font-medium text-slate-700">
                Title
              </label>
              <input id="evidenceTitle" name="title" type="text" required maxLength={200} className={INPUT_CLASS} />
            </div>
            <div>
              <label htmlFor="evidenceFile" className="block text-xs font-medium text-slate-700">
                File (PDF, image, Office document, or text — 25MB max)
              </label>
              <input id="evidenceFile" name="file" type="file" required className={INPUT_CLASS} />
            </div>
            <Button type="submit" size="sm">
              Submit evidence
            </Button>
          </form>
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
          <h2 className="text-sm font-semibold text-slate-900">Evidence from the source assessment response</h2>
          <p className="mt-1 text-xs text-slate-500">
            The evidence the original assessment response/control test relied on — this remediation action references the
            same authoritative Evidence records, not a copy.
          </p>
          {indirectEvidenceRows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No evidence linked yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {indirectEvidenceRows.map((e) => (
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
          <h2 className="text-sm font-semibold text-slate-900">Validation</h2>
          <p className="mt-1 text-xs text-slate-500">
            Every validation is a permanent, immutable record — correcting an earlier decision means recording a new
            validation, never editing an existing one. The full history below always includes every past record.
          </p>

          {remediation.validationRecords.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Not yet validated.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {remediation.validationRecords.map((v) => {
                const evidenceForRecord = validationEvidenceRows.filter((e) => e.validationRecordId === v.id);
                return (
                  <li key={v.id} className="rounded border border-slate-100 p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <Badge tone={statusTone(v.outcome)}>{v.outcome}</Badge>
                      <span className="text-xs text-slate-500">{new Date(v.validatedAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">By {v.validatedByEmail ?? "—"}</p>
                    {v.rationale ? <p className="mt-1 text-slate-700">{v.rationale}</p> : null}
                    {v.triggersControlTestId || v.triggersAssessmentResponseId ? (
                      <p className="mt-1 text-xs text-slate-500">Reassessment recorded against this validation.</p>
                    ) : null}

                    {evidenceForRecord.length > 0 ? (
                      <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                        {evidenceForRecord.map((e) => (
                          <li key={e.evidenceLinkId} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-700">
                              {e.title} · {e.originalFilename}
                            </span>
                            <Badge tone={statusTone(e.reviewStatus)}>{e.reviewStatus}</Badge>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-slate-600">Add evidence to this validation</summary>
                      <form
                        action={uploadValidationEvidenceAction}
                        className="mt-2 space-y-2"
                        encType="multipart/form-data"
                      >
                        <input type="hidden" name="organisationId" value={params.organisationId} />
                        <input type="hidden" name="engagementId" value={params.engagementId} />
                        <input type="hidden" name="remediationActionId" value={remediation.id} />
                        <input type="hidden" name="validationRecordId" value={v.id} />
                        <div>
                          <label htmlFor={`validationEvidenceTitle-${v.id}`} className="block text-xs font-medium text-slate-700">
                            Title
                          </label>
                          <input
                            id={`validationEvidenceTitle-${v.id}`}
                            name="title"
                            type="text"
                            required
                            maxLength={200}
                            className={INPUT_CLASS}
                          />
                        </div>
                        <div>
                          <label htmlFor={`validationEvidenceFile-${v.id}`} className="block text-xs font-medium text-slate-700">
                            File (PDF, image, Office document, or text — 25MB max)
                          </label>
                          <input id={`validationEvidenceFile-${v.id}`} name="file" type="file" required className={INPUT_CLASS} />
                        </div>
                        <Button type="submit" size="sm">
                          Submit evidence
                        </Button>
                      </form>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}

          <form action={createValidationRecordAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            <input type="hidden" name="organisationId" value={params.organisationId} />
            <input type="hidden" name="engagementId" value={params.engagementId} />
            <input type="hidden" name="remediationActionId" value={remediation.id} />

            <p className="text-xs font-medium text-slate-700">Record a new validation</p>
            <div>
              <label htmlFor="outcome" className="block text-xs font-medium text-slate-700">
                Outcome
              </label>
              <select id="outcome" name="outcome" required defaultValue="accepted" className={INPUT_CLASS}>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div>
              <label htmlFor="rationale" className="block text-xs font-medium text-slate-700">
                Rationale <span className="font-normal text-slate-500">(required if rejected)</span>
              </label>
              <textarea id="rationale" name="rationale" rows={2} maxLength={4000} className={INPUT_CLASS} />
            </div>
            <Button type="submit" size="sm">
              Record validation
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
