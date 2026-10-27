"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { hasEngagementPermission } from "@/lib/authorization/service";
import { isDemoAuthActive } from "@/lib/auth/demo-auth";
import { DemoResetRefused, resetDemoFirm } from "@/lib/demo/reset";

const ids = z.object({ organisationId: z.string().uuid(), engagementId: z.string().uuid() });

export async function resetDemoAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const p = ids.safeParse({ organisationId: formData.get("organisationId"), engagementId: formData.get("engagementId") });
  if (!p.success || !isDemoAuthActive()) redirect("/dashboard");
  if (formData.get("sure") !== "yes") redirect("/demo?problem=" + encodeURIComponent("Tick the box to confirm. Nothing was removed."));
  const allowed = await withRequestDb(user.id, (db) => hasEngagementPermission(db, user.id, p.data.engagementId, "ai.configure"));
  if (!allowed) redirect("/demo?problem=" + encodeURIComponent("Only an Engagement Manager can reset the demo."));
  let message: string;
  try {
    const r = await resetDemoFirm(p.data);
    message = `Reset done. ${r.rows} records and ${r.files} uploaded files were removed. The firm is empty again and ready for the next demo.`;
  } catch (err) {
    if (err instanceof DemoResetRefused) redirect("/demo?problem=" + encodeURIComponent(err.message));
    console.error("Demo reset failed", err);
    redirect("/demo?problem=" + encodeURIComponent("The reset could not be completed and nothing was changed. Try again."));
  }
  revalidatePath("/", "layout");
  redirect("/demo?ok=" + encodeURIComponent(message));
}
