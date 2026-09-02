import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getEngagementScopeDetail, listRegulatoryReferencesForEngagement } from "@/lib/domain/applicability";
import { NotFoundOrForbiddenError, isActiveEngagementMember, canLockScope } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  reviseEngagementScopeAction,
  lockEngagementScopeAction,
  updateControlApplicabilityAction,
  createApplicabilityDeterminationAction,
} from "../actions";

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

const DECISION_LABEL: Record<string, string> = { undecided: "Undecided", applicable: "Applicable", not_applicable: "Not Applicable" };

/**
 * One Scope version (Slice D3, approved design §11): Framework
 * (RegulatoryReference-level determinations, DATA_MODEL.md §4) and
 * Controls (the operational, Control-level applicability that actually
 * integrates with Assessment — approved architecture §3/§6). Editable
 * only while draft; "Lock Scope" is the one permanent, `scope.lock`-
 * gated transition. Undecided/Applicable/Not Applicable is always shown
 * as an explicit badge — never inferred.
 */
export default async function ScopeDetailPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string; scopeId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const data = await withRequestDb(user.id, async (db) => {
    try {
      const scope = await getEngagementScopeDetail(db, user.id, params.scopeId);
      if (scope.engagementId !== params.engagementId || scope.organisationId !== params.organisationId) return null;
      const [canPropose, canLock, regulatoryReferenceOptions] = await Promise.all([
        isActiveEngagementMember(db, user.id, params.engagementId),
        canLockScope(db, user.id, params.engagementId, params.organisationId),
        listRegulatoryReferencesForEngagement(db, user.id, { engagementId: params.engagementId, organisationId: params.organisationId }),
      ]);
      return { scope, canPropose, canLock, regulatoryReferenceOptions };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });

  if (!data) notFound();
  const { scope, canPropose, canLock, regulatoryReferenceOptions } = data;
  const isDraft = scope.status === "draft";
  const linkedReferenceIds = new Set(scope.determinations.flatMap((d) => d.regulatoryReferences.map((r) => r.id)));

  const decisionCounts = scope.controlRows.reduce(
    (acc, r) => {
      acc[r.decision] = (acc[r.decision] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/scope`} className="hover:underline">
          Applicability &amp; Scope
        </Link>
      </p>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Scope</h1>
        <Badge tone={statusTone(scope.status)}>{scope.status}</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {decisionCounts.applicable ?? 0} applicable · {decisionCounts.not_applicable ?? 0} not applicable ·{" "}
        {decisionCounts.undecided ?? 0} undecided
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

      {!isDraft ? (
        <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          This scope version is locked — every determination below is permanent.
          {canPropose ? (
            <form action={reviseEngagementScopeAction} className="mt-2">
              <input type="hidden" name="organisationId" value={params.organisationId} />
              <input type="hidden" name="engagementId" value={params.engagementId} />
              <input type="hidden" name="previousScopeId" value={scope.id} />
              <Button type="submit" size="sm">
                Create new revision
              </Button>
            </form>
          ) : null}
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Framework Applicability</h2>
        <p className="mt-1 text-xs text-slate-500">
          Which regulatory obligations apply to this engagement, narratively — feeds the engagement report; does not
          by itself change which controls are assessed.
        </p>
        <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {scope.determinations.length === 0 ? (
            <li className="px-6 py-6 text-center text-sm text-slate-500">No determinations recorded yet.</li>
          ) : (
            scope.determinations.map((d) => (
              <li key={d.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-medium text-slate-900">{d.scopeDescription}</p>
                  <Badge tone={statusTone(d.decisionValue)}>{DECISION_LABEL[d.decisionValue]}</Badge>
                </div>
                {d.decisionRationale ? <p className="mt-1 text-sm text-slate-600">{d.decisionRationale}</p> : null}
                {d.regulatoryReferences.length > 0 ? (
                  <p className="mt-1 text-xs text-slate-500">{d.regulatoryReferences.map((r) => `${r.title} (${r.citation})`).join(", ")}</p>
                ) : null}
              </li>
            ))
          )}
        </ul>

        {isDraft && canPropose && regulatoryReferenceOptions.length > 0 ? (
          <form action={createApplicabilityDeterminationAction} className="mt-3 space-y-3 rounded-md border border-slate-200 bg-white p-4">
            <input type="hidden" name="organisationId" value={params.organisationId} />
            <input type="hidden" name="engagementId" value={params.engagementId} />
            <input type="hidden" name="engagementScopeId" value={scope.id} />
            <p className="text-xs font-medium text-slate-700">Add determination</p>
            <input name="scopeDescription" required className={INPUT_CLASS} placeholder="e.g. Cross-border transfer provisions" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <select name="decisionValue" defaultValue="applicable" className={INPUT_CLASS}>
                <option value="applicable">Applicable</option>
                <option value="not_applicable">Not Applicable</option>
              </select>
              <input name="decisionRationale" className={INPUT_CLASS} placeholder="Rationale (required if Not Applicable)" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Regulatory references</label>
              <select name="regulatoryReferenceIds" multiple size={Math.min(4, regulatoryReferenceOptions.length)} className={INPUT_CLASS}>
                {regulatoryReferenceOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} ({r.citation})
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm">
              Add determination
            </Button>
          </form>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Controls ({scope.controlRows.length})</h2>
        <p className="mt-1 text-xs text-slate-500">
          The operational scope — what a new Assessment for this engagement will actually include as applicable.
        </p>
        <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {scope.controlRows.map((row) => (
            <li key={row.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-slate-900">
                  {row.controlCode} — {row.controlTitle}
                </p>
                <Badge tone={statusTone(row.decision)}>{DECISION_LABEL[row.decision]}</Badge>
              </div>
              {row.rationale ? <p className="mt-1 text-sm text-slate-600">{row.rationale}</p> : null}
              {row.decidedByEmail ? (
                <p className="mt-1 text-xs text-slate-500">
                  Decided by {row.decidedByEmail}
                  {row.decidedAt ? ` · ${row.decidedAt.toISOString().slice(0, 10)}` : ""}
                </p>
              ) : null}

              {isDraft && canPropose ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-slate-600">Change decision</summary>
                  <form action={updateControlApplicabilityAction} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                    <input type="hidden" name="organisationId" value={params.organisationId} />
                    <input type="hidden" name="engagementId" value={params.engagementId} />
                    <input type="hidden" name="engagementScopeId" value={scope.id} />
                    <input type="hidden" name="engagementScopeControlId" value={row.id} />
                    <select name="decision" defaultValue={row.decision} className={INPUT_CLASS}>
                      <option value="undecided">Undecided</option>
                      <option value="applicable">Applicable</option>
                      <option value="not_applicable">Not Applicable</option>
                    </select>
                    <input name="rationale" defaultValue={row.rationale ?? ""} className={`sm:col-span-2 ${INPUT_CLASS}`} placeholder="Rationale (required if Not Applicable)" />
                    <Button type="submit" size="sm">
                      Save
                    </Button>
                  </form>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {isDraft && canLock ? (
        <details className="mt-8 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-amber-900">Lock this scope…</summary>
          <div className="mt-2 space-y-3 pb-2">
            <p className="text-sm text-amber-800">
              Locking is permanent. Once locked, every determination and control decision above becomes immutable —
              a correction requires creating a new scope revision. The next Assessment created for this engagement
              will snapshot exactly what is decided here.
            </p>
            <form action={lockEngagementScopeAction}>
              <input type="hidden" name="organisationId" value={params.organisationId} />
              <input type="hidden" name="engagementId" value={params.engagementId} />
              <input type="hidden" name="engagementScopeId" value={scope.id} />
              <Button type="submit" variant="destructive" size="sm">
                Lock scope
              </Button>
            </form>
          </div>
        </details>
      ) : null}
    </div>
  );
}
