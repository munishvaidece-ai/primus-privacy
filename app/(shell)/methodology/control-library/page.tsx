import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { listControlLibraryVersions } from "@/lib/domain/control-library";
import { getUserTenantId, canManageMethodology, NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";

/**
 * The Control Library list (instructions §4): every version belonging
 * to the caller's own tenant, with the fields the schema actually
 * carries — label, status, created date, published date, control count.
 * "Create Version" is shown only to a `methodology.manage` holder — the
 * server-computed `canCreate` flag mirrors every other conditional
 * create-button in this application (e.g. `OrganisationsPage`'s own
 * `canCreate`); the real gate is `createControlLibraryVersion`'s own
 * authorization check regardless.
 */
export default async function ControlLibraryPage() {
  const user = await requireAuthenticatedUser();

  const { versions, canCreate } = await withRequestDb(user.id, async (db) => {
    try {
      const list = await listControlLibraryVersions(db, user.id);
      const tenantId = await getUserTenantId(db, user.id);
      const create = tenantId ? await canManageMethodology(db, user.id, tenantId) : false;
      return { versions: list, canCreate: create };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) notFound();
      throw err;
    }
  });

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href="/methodology" className="hover:underline">
          Methodology
        </Link>
      </p>
      <div className="mt-1 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Control Library</h1>
          <p className="mt-1 text-sm text-slate-600">Versions of your practice&rsquo;s control library.</p>
        </div>
        {canCreate ? (
          <Link
            href="/methodology/control-library/new"
            className="inline-flex h-9 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            Create Version
          </Link>
        ) : null}
      </div>

      {versions.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          No control library versions yet.
          {canCreate ? (
            <>
              {" "}
              <Link href="/methodology/control-library/new" className="font-medium text-slate-900 underline">
                Create the first one
              </Link>
              .
            </>
          ) : null}
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {versions.map((v) => (
            <li key={v.id}>
              <Link href={`/methodology/control-library/${v.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{v.versionLabel}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {v.controlCount} control{v.controlCount === 1 ? "" : "s"} · created{" "}
                    {v.createdAt.toISOString().slice(0, 10)}
                    {v.publishedAt ? ` · published ${v.publishedAt.toISOString().slice(0, 10)}` : ""}
                  </p>
                </div>
                <Badge tone={statusTone(v.status)}>{v.status}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
