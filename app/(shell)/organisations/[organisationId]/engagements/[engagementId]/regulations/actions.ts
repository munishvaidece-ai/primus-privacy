"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { setEngagementSectors } from "@/lib/domain/sectors";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

const schema = z.object({ organisationId: z.string().uuid(), engagementId: z.string().uuid() });

export async function saveSectorsAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const ids = schema.safeParse({ organisationId: formData.get("organisationId"), engagementId: formData.get("engagementId") });
  if (!ids.success) redirect("/engagements");
  const path = `/organisations/${ids.data.organisationId}/engagements/${ids.data.engagementId}/regulations`;
  const sectors = formData.getAll("sector").map(String);
  let msg: string | null = null;
  try {
    await withRequestDb(user.id, (db) => setEngagementSectors(db, user.id, { ...ids.data, sectors }));
  } catch (err) {
    if (err instanceof NotFoundOrForbiddenError) msg = "You do not have access to change the sectors of this engagement.";
    else if (err instanceof Error && /row-level security|permission denied/i.test(err.message)) msg = "Only the Primus team can change the sectors.";
    else if (err instanceof Error && /^Unknown sector/.test(err.message)) msg = err.message;
    else throw err;
  }
  revalidatePath(path);
  redirect(msg ? `${path}?error=${encodeURIComponent(msg)}` : `${path}?saved=1`);
}
