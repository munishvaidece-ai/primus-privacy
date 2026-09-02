import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getControlLibraryVersionDetail } from "@/lib/domain/control-library";
import { canManageMethodology, NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { publishControlLibraryVersionAction, cloneControlLibraryVersionAction } from "./actions";

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

/**
 * The Control Library Version detail page (instructions §4): metadata,
 * every Control in this version, and — depending on status — the
 * write actions a `methodology.manage` holder can take: add controls
 * (draft only), publish (draft only, with a confirmation reveal
 * mirroring the Assessment workspace's own Finalize control), or create
 * a new draft version from this one (published only).
 */
export default async function ControlLibraryVersionPage({
  params,
  searchParams,
}: {
  params: { versionId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const { version, canManage } = await withRequestDb(user.id, async (db) => {
    try {
      const detail = await getControlLibraryVersionDetail(db, user.id, params.versionId);
      const manage = await canManageMethodology(db, user.id, detail.tenantId);
      return { version: detail, canManage: manage };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) notFound();
      throw err;
    }
  });

  const isDraft = version.status === "draft";
  const isPublished = version.status === "published";

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href="/methodology/control-library" className="hover:underline">
          Control Library
        </Link>
      </p>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{version.versionLabel}</h1>
        <Badge tone={statusTone(version.status)}>{version.status}</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Created {version.createdAt.toISOString().slice(0, 10)}
        {version.publishedAt ? ` · Published ${version.publishedAt.toISOString().slice(0, 10)}` : ""}
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
          This version is {version.status} — its controls and requirement associations are immutable.
          {isPublished ? " Corrections require creating a new draft version." : ""}
        </p>
      ) : null}

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Controls ({version.controlRows.length})
          </h2>
          {canManage && isDraft ? (
            <Link
              href={`/methodology/control-library/${version.id}/controls/new`}
              className="text-sm font-medium text-slate-900 underline"
            >
              Add Control
            </Link>
          ) : null}
        </div>

        {version.controlRows.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500">
            No controls yet.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {version.controlRows.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/methodology/control-library/${version.id}/controls/${c.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {c.code} — {c.title}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {c.controlType}
                      {c.requirements.length > 0 ? ` · ${c.requirements.map((r) => r.title).join(", ")}` : " · no requirement associations"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && isDraft ? (
        <details className="mt-8 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-amber-900">Publish this version…</summary>
          <div className="mt-2 space-y-3 pb-2">
            <p className="text-sm text-amber-800">
              Publishing is permanent. Once published, this version&rsquo;s controls and requirement
              associations can never be edited or deleted — corrections require creating a new draft
              version from it.
            </p>
            <form action={publishControlLibraryVersionAction}>
              <input type="hidden" name="versionId" value={version.id} />
              <Button type="submit" variant="destructive" size="sm">
                Publish version
              </Button>
            </form>
          </div>
        </details>
      ) : null}

      {canManage && isPublished ? (
        <section className="mt-8 border-t border-slate-100 pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Create New Version</h2>
          <p className="mt-2 text-sm text-slate-600">
            Copies this version&rsquo;s controls and requirement associations into a new draft you can
            edit. This published version is never modified.
          </p>
          <form action={cloneControlLibraryVersionAction} className="mt-3 flex items-end gap-3">
            <input type="hidden" name="sourceVersionId" value={version.id} />
            <div className="flex-1">
              <label htmlFor="newVersionLabel" className="block text-xs font-medium text-slate-700">
                New version label
              </label>
              <input
                id="newVersionLabel"
                name="newVersionLabel"
                type="text"
                required
                maxLength={200}
                placeholder="e.g. DPDP Control Library v2.0"
                autoComplete="off"
                className={INPUT_CLASS}
              />
            </div>
            <Button type="submit" size="sm">
              Create New Version
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
