import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getUserTenantId, requireTenantAccess, NotFoundOrForbiddenError } from "@/lib/authorization/service";

// Slice D1 — the Methodology landing page (instructions §10: "the
// smallest coherent methodology administration experience... do not
// create a giant methodology dashboard"). Two links, matching this
// slice's actual scope exactly — Control Library (this slice's real
// authoring capability) and Regulatory Content (the reference content
// Requirements/Controls associate with). Risk Scoring Model and
// Maturity Methodology are real, planned destinations
// (PRODUCT_UX_BLUEPRINT.md §5 rows 22-23) but out of this slice's scope
// per explicit instruction — not linked here, matching this
// application's own established "don't render a link to a page that
// doesn't exist yet" convention (components/shell/nav.tsx).
export default async function MethodologyPage() {
  const user = await requireAuthenticatedUser();

  await withRequestDb(user.id, async (db) => {
    const tenantId = await getUserTenantId(db, user.id);
    try {
      if (!tenantId) throw new NotFoundOrForbiddenError();
      await requireTenantAccess(db, user.id, tenantId);
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) notFound();
      throw err;
    }
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Methodology</h1>
      <p className="mt-1 text-sm text-slate-600">
        Practice-owned reference content and control library — shared across every Engagement in your
        practice, versioned independently of any one client.
      </p>

      <ul className="mt-6 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
        <li>
          <Link href="/methodology/control-library" className="block px-4 py-3 hover:bg-slate-50">
            <span className="text-sm font-medium text-slate-900">Control Library</span>
            <p className="mt-0.5 text-sm text-slate-600">
              Draft, publish, and version the controls Assessments are measured against.
            </p>
          </Link>
        </li>
        <li>
          <Link href="/methodology/regulatory-content" className="block px-4 py-3 hover:bg-slate-50">
            <span className="text-sm font-medium text-slate-900">Regulatory Content</span>
            <p className="mt-0.5 text-sm text-slate-600">
              Regulatory references and requirements Controls associate with.
            </p>
          </Link>
        </li>
      </ul>
    </div>
  );
}
