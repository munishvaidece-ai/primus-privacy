import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getOrganisationDetail } from "@/lib/domain/organisations";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";

export default async function OrganisationDetailPage({
  params,
  searchParams,
}: {
  params: { organisationId: string };
  searchParams: { created?: string; name?: string };
}) {
  const user = await requireAuthenticatedUser();

  const organisation = await withRequestDb(user.id, async (db) => {
    try {
      return await getOrganisationDetail(db, user.id, params.organisationId);
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });

  if (!organisation) {
    // Slice B1 discovered a real, by-design consequence of the already-
    // approved authorization model (Slice A1's canAccessOrganisation /
    // migration 0001's organisations_select — see lib/domain/
    // organisations.ts's createOrganisation): a bare TenantMembership is
    // sufficient to CREATE an organisation but not to VIEW one — that
    // requires organisation- or engagement-level membership, which
    // nobody has yet on a row that was just created. Rather than
    // weaken that check (forbidden — instructions §15), a consultant
    // who just created this organisation (searchParams.created, set
    // only by the create Server Action's own redirect) sees an honest
    // confirmation instead of a bare not-found; anyone else hitting an
    // inaccessible/nonexistent id still gets the identical "not found"
    // response SECURITY.md §13 requires (never a distinguishable
    // "exists but forbidden" message).
    if (searchParams.created === "1") {
      return (
        <div className="max-w-lg">
          <h1 className="text-xl font-semibold text-slate-900">Organisation created</h1>
          <p role="status" className="mt-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
            {searchParams.name ? <>“{searchParams.name}” was</> : "The organisation was"} created successfully.
          </p>
          <p className="mt-4 text-sm text-slate-600">
            This detail page isn&apos;t visible to you yet — creating an organisation only requires
            practice-wide (tenant) access, while viewing one requires organisation- or engagement-level
            access, which nobody has on a brand-new organisation until it&apos;s granted (for example, by
            opening an engagement for this client).
          </p>
          <Link href="/organisations" className="mt-6 inline-block text-sm font-medium text-slate-900 underline">
            Back to Organisations
          </Link>
        </div>
      );
    }
    notFound();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{organisation.name}</h1>
        <Badge tone={statusTone(organisation.status)}>{organisation.status}</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Created {new Date(organisation.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Engagements</h2>
        {organisation.engagements.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500">
            No engagements yet for this organisation.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {organisation.engagements.map((engagement) => (
              <li key={engagement.id}>
                <Link
                  href={`/organisations/${organisation.id}/engagements/${engagement.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
                >
                  <div>
                    <span className="text-sm font-medium text-slate-900">{engagement.name}</span>
                    <span className="ml-2 text-xs text-slate-500">{engagement.engagementType}</span>
                  </div>
                  <Badge tone={statusTone(engagement.status)}>{engagement.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
