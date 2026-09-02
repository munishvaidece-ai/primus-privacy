import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { createControlLibraryVersionAction } from "../actions";

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

export default async function NewControlLibraryVersionPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  await requireAuthenticatedUser();
  const error = searchParams.error;

  return (
    <div className="max-w-lg">
      <p className="text-sm text-slate-500">
        <Link href="/methodology/control-library" className="hover:underline">
          Back to Control Library
        </Link>
      </p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">Create Control Library Version</h1>
      <p className="mt-1 text-sm text-slate-600">
        Starts as a draft — add controls and requirement associations, then publish when ready.
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <form action={createControlLibraryVersionAction} className="mt-6 space-y-4">
        <div>
          <label htmlFor="versionLabel" className="block text-sm font-medium text-slate-700">
            Version label
          </label>
          <input
            id="versionLabel"
            name="versionLabel"
            type="text"
            required
            minLength={1}
            maxLength={200}
            placeholder="e.g. DPDP Control Library v1.0"
            autoComplete="off"
            className={INPUT_CLASS}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit">Create Version</Button>
          <Link href="/methodology/control-library" className="text-sm font-medium text-slate-600 hover:underline">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
