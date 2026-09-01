import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getEvidenceDownloadUrl } from "@/lib/domain/evidence";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

export const dynamic = "force-dynamic";

/**
 * Slice C2 (PHASE C2 instructions §17): Authenticated user → server
 * authorization → Evidence authorization → short-lived signed URL →
 * private object — a plain GET so a compact HTML `<a>` link works with
 * no client-side JavaScript, matching every other page in this
 * application. Issues a real HTTP redirect to the signed URL; never
 * returns the URL as JSON for a client to store, never exposes the raw
 * `storage_path`. `requireAuthenticatedUser()`'s own redirect to
 * `/login` works the same way here as in a Server Component — Next.js
 * Route Handlers support `redirect()` from `next/navigation` directly.
 *
 * Once a real Supabase project exists (DECISIONS.md D-03/R-95), the
 * redirect target is a genuine, working signed URL. Until then, the
 * local storage adapter's own `local-evidence-storage://` URI (see
 * lib/storage/evidence-storage.ts) is not a real, browser-fetchable
 * resource — a redirect to it will simply fail in the browser (an
 * unrecognized protocol), which is expected, honestly-documented
 * behavior in an environment with no real Storage reachable, not a bug
 * in this route.
 */
export async function GET(
  _request: Request,
  { params }: { params: { organisationId: string; engagementId: string; assessmentId: string; evidenceId: string } },
) {
  const user = await requireAuthenticatedUser();

  try {
    const { url } = await withRequestDb(user.id, (db) =>
      getEvidenceDownloadUrl(db, user.id, {
        organisationId: params.organisationId,
        engagementId: params.engagementId,
        evidenceId: params.evidenceId,
      }),
    );
    return NextResponse.redirect(url);
  } catch (err) {
    if (err instanceof NotFoundOrForbiddenError) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    // instructions §17/§20: never expose database/storage internals to
    // users — full detail goes to the server log only.
    console.error("Evidence download failed", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
