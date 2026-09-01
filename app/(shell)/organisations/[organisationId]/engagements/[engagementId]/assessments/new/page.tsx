import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Button } from "@/components/ui/button";
import { createAssessmentAction } from "../actions";

const ASSESSMENT_TYPES: Array<{ value: string; label: string }> = [
  { value: "control_readiness", label: "Control Readiness" },
  { value: "annual", label: "Annual" },
  { value: "dpia", label: "DPIA" },
  { value: "sdf_screening", label: "SDF Screening" },
  { value: "third_party", label: "Third-Party" },
];

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

// Slice C7.1 (instructions §12/§13): the Assessment creation form —
// only the two fields the schema actually supports for this
// (`assessment_type`, `period_label`); methodology is never a form
// field here — it comes from the Engagement's own already-pinned
// `control_library_version_id`, never chosen again per-Assessment
// (DATA_MODEL.md §6's own composite-FK invariant). If the Engagement
// has no control library pinned yet, the form is not shown at all —
// the honest empty state instructions §15 requires, not a form that
// would only fail server-side.
export default async function NewAssessmentPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string };
  searchParams: { error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const engagement = await withRequestDb(user.id, async (db) => {
    try {
      return await getEngagementDetail(db, user.id, params.engagementId);
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });

  if (!engagement || engagement.organisationId !== params.organisationId) notFound();

  const error = searchParams.error;
  const assessmentsListPath = `/organisations/${params.organisationId}/engagements/${params.engagementId}/assessments`;

  return (
    <div className="max-w-lg">
      <p className="text-sm text-slate-500">
        <Link href={assessmentsListPath} className="hover:underline">
          Back to assessments
        </Link>
      </p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">Create Assessment</h1>
      <p className="mt-1 text-sm text-slate-600">
        for {engagement.name} — pinned control library:{" "}
        {engagement.controlLibraryVersionLabel ?? "not yet pinned"}
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {!engagement.controlLibraryVersionId ? (
        <p role="alert" className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This engagement has no control library version pinned yet. An Assessment&rsquo;s controls come
          from the engagement&rsquo;s own pinned control library, so one must be pinned before an
          Assessment can be created.
        </p>
      ) : (
        <form action={createAssessmentAction} className="mt-6 space-y-4">
          <input type="hidden" name="organisationId" value={params.organisationId} />
          <input type="hidden" name="engagementId" value={params.engagementId} />

          <div>
            <label htmlFor="assessmentType" className="block text-sm font-medium text-slate-700">
              Assessment type
            </label>
            <select
              id="assessmentType"
              name="assessmentType"
              required
              defaultValue="control_readiness"
              className={INPUT_CLASS}
            >
              {ASSESSMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="periodLabel" className="block text-sm font-medium text-slate-700">
              Period
            </label>
            <input
              id="periodLabel"
              name="periodLabel"
              type="text"
              required
              minLength={1}
              maxLength={100}
              placeholder="e.g. FY2026"
              autoComplete="off"
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit">Create Assessment</Button>
            <Link href={assessmentsListPath} className="text-sm font-medium text-slate-600 hover:underline">
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
