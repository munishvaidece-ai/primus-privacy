import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getAssessmentDetail, type AssessmentControlRow } from "@/lib/domain/assessments";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateAssessmentResponseAction } from "./actions";

const EFFECTIVENESS_OPTIONS = [
  { value: "not_assessed", label: "Not Assessed" },
  { value: "not_applicable", label: "Not Applicable" },
  { value: "not_implemented", label: "Not Implemented" },
  { value: "partially_implemented", label: "Partially Implemented" },
  { value: "implemented", label: "Implemented" },
] as const;

export default async function AssessmentDetailPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string; assessmentId: string };
  searchParams: { error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const assessment = await withRequestDb(user.id, async (db) => {
    try {
      return await getAssessmentDetail(db, user.id, params.assessmentId);
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) notFound();
      throw err;
    }
  });

  if (assessment.engagementId !== params.engagementId || assessment.organisationId !== params.organisationId) {
    notFound();
  }

  const finalized = assessment.status === "finalized";

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{assessment.periodLabel}</h1>
        <Badge tone={statusTone(assessment.status)}>{assessment.status}</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-600">{assessment.assessmentType}</p>

      {finalized ? (
        <p className="mt-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          This assessment is finalized. Responses are locked and cannot be edited.
        </p>
      ) : null}

      {searchParams.error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {searchParams.error}
        </p>
      ) : null}

      <div className="mt-6 space-y-4">
        {assessment.controlRows.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500">
            No controls are in scope for this assessment.
          </div>
        ) : (
          assessment.controlRows.map((row) => (
            <AssessmentControlCard
              key={row.assessmentControlId}
              row={row}
              organisationId={params.organisationId}
              engagementId={params.engagementId}
              assessmentId={params.assessmentId}
              locked={finalized}
            />
          ))
        )}
      </div>
    </div>
  );
}

function AssessmentControlCard({
  row,
  organisationId,
  engagementId,
  assessmentId,
  locked,
}: {
  row: AssessmentControlRow;
  organisationId: string;
  engagementId: string;
  assessmentId: string;
  locked: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-mono text-slate-500">{row.controlCode}</span>
        <h3 className="text-sm font-medium text-slate-900">{row.controlTitle}</h3>
      </div>

      {locked ? (
        <div className="mt-3 text-sm text-slate-700">
          <p>
            <span className="font-medium">Response:</span>{" "}
            {row.response ? formatEffectiveness(row.response.effectivenessRating) : "Not yet responded."}
          </p>
          {row.response?.decisionRationale ? (
            <p className="mt-1 text-slate-600">{row.response.decisionRationale}</p>
          ) : null}
        </div>
      ) : (
        <form action={updateAssessmentResponseAction} className="mt-3 space-y-2">
          <input type="hidden" name="organisationId" value={organisationId} />
          <input type="hidden" name="engagementId" value={engagementId} />
          <input type="hidden" name="assessmentId" value={assessmentId} />
          <input type="hidden" name="assessmentControlId" value={row.assessmentControlId} />

          <div>
            <label htmlFor={`rating-${row.assessmentControlId}`} className="block text-xs font-medium text-slate-700">
              Effectiveness rating
            </label>
            <select
              id={`rating-${row.assessmentControlId}`}
              name="effectivenessRating"
              defaultValue={row.response?.effectivenessRating ?? "not_assessed"}
              className="mt-1 block w-full max-w-xs rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              {EFFECTIVENESS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`rationale-${row.assessmentControlId}`} className="block text-xs font-medium text-slate-700">
              Rationale
            </label>
            <textarea
              id={`rationale-${row.assessmentControlId}`}
              name="decisionRationale"
              rows={2}
              defaultValue={row.response?.decisionRationale ?? ""}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            />
          </div>

          <Button type="submit" size="sm">
            Save response
          </Button>
        </form>
      )}
    </div>
  );
}

function formatEffectiveness(value: string): string {
  return EFFECTIVENESS_OPTIONS.find((opt) => opt.value === value)?.label ?? value;
}
