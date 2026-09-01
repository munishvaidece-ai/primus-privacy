import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getUserTenantId, isActiveTenantMember } from "@/lib/authorization/service";
import { Button } from "@/components/ui/button";
import { createOrganisationAction } from "./actions";

// PHASE B instructions §7: authorization uses the existing membership
// model, no new DB roles. A TenantMembership is the narrowest existing
// role/permission that maps to "may create an organisation under this
// tenant" (see lib/authorization/service.ts's requireTenantMembership).
// This page checks the same condition the Server Action itself enforces
// purely for UX — a consultant with no TenantMembership sees a clear
// message instead of a form that would only fail on submit; the actual
// security boundary is still enforced server-side inside the action.
export default async function NewOrganisationPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const user = await requireAuthenticatedUser();
  const error = searchParams.error;

  const canCreate = await withRequestDb(user.id, async (db) => {
    const tenantId = await getUserTenantId(db, user.id);
    if (!tenantId) return false;
    return isActiveTenantMember(db, user.id, tenantId);
  });

  if (!canCreate) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Create Organisation</h1>
        <p role="alert" className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You do not have permission to create an organisation. This requires an active tenant-level
          membership within your practice.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold text-slate-900">Create Organisation</h1>
      <p className="mt-1 text-sm text-slate-600">Add a new client organisation to your practice.</p>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <form action={createOrganisationAction} className="mt-6 space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-700">
            Organisation name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={200}
            autoComplete="off"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          />
        </div>
        <Button type="submit">Create Organisation</Button>
      </form>
    </div>
  );
}
