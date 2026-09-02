import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getControlLibraryVersionDetail, ControlLibraryVersionNotDraftError } from "@/lib/domain/control-library";
import { canManageMethodology, NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Button } from "@/components/ui/button";
import { createControlAction } from "../../actions";

const CONTROL_TYPES: Array<{ value: string; label: string }> = [
  { value: "preventive", label: "Preventive" },
  { value: "detective", label: "Detective" },
  { value: "corrective", label: "Corrective" },
];

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

export default async function NewControlPage({
  params,
  searchParams,
}: {
  params: { versionId: string };
  searchParams: { error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const version = await withRequestDb(user.id, async (db) => {
    try {
      const detail = await getControlLibraryVersionDetail(db, user.id, params.versionId);
      const canManage = await canManageMethodology(db, user.id, detail.tenantId);
      if (!canManage) throw new NotFoundOrForbiddenError();
      if (detail.status !== "draft") throw new ControlLibraryVersionNotDraftError();
      return detail;
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) notFound();
      if (err instanceof ControlLibraryVersionNotDraftError) notFound();
      throw err;
    }
  });

  const versionPath = `/methodology/control-library/${version.id}`;
  const error = searchParams.error;

  return (
    <div className="max-w-lg">
      <p className="text-sm text-slate-500">
        <Link href={versionPath} className="hover:underline">
          Back to {version.versionLabel}
        </Link>
      </p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">Add Control</h1>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <form action={createControlAction} className="mt-6 space-y-4">
        <input type="hidden" name="controlLibraryVersionId" value={version.id} />

        <div>
          <label htmlFor="code" className="block text-sm font-medium text-slate-700">
            Code
          </label>
          <input id="code" name="code" type="text" required maxLength={50} placeholder="e.g. GOV-01" autoComplete="off" className={INPUT_CLASS} />
        </div>

        <div>
          <label htmlFor="title" className="block text-sm font-medium text-slate-700">
            Title
          </label>
          <input id="title" name="title" type="text" required maxLength={300} autoComplete="off" className={INPUT_CLASS} />
        </div>

        <div>
          <label htmlFor="controlType" className="block text-sm font-medium text-slate-700">
            Type
          </label>
          <select id="controlType" name="controlType" required defaultValue="preventive" className={INPUT_CLASS}>
            {CONTROL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-slate-700">
            Description <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea id="description" name="description" rows={4} maxLength={4000} className={INPUT_CLASS} />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit">Add Control</Button>
          <Link href={versionPath} className="text-sm font-medium text-slate-600 hover:underline">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
