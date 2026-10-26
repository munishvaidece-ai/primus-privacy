"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { DecisionNoteRequiredError, SuggestionApplyError, SuggestionNotPendingError, approveMany, decideSuggestion } from "@/lib/ai/suggestions";
import { aiBase, withFlag } from "@/components/ai/shell";

const ids = z.object({ organisationId: z.string().uuid(), engagementId: z.string().uuid() });

function target(formData: FormData) {
  const p = ids.safeParse({ organisationId: formData.get("organisationId"), engagementId: formData.get("engagementId") });
  if (!p.success) redirect("/organisations");
  return { scope: p.data, path: `${aiBase(p.data.organisationId, p.data.engagementId)}/queue` };
}

export async function decideSuggestionAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { path } = target(formData);
  const suggestionId = z.string().uuid().safeParse(formData.get("suggestionId"));
  const action = z.enum(["approve", "override", "reject"]).safeParse(formData.get("action"));
  if (!suggestionId.success || !action.success) redirect(withFlag(path, "error", "Unknown request."));

  const finalValue: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("f_") && typeof v === "string" && v.trim()) finalValue[k.slice(2)] = v.trim();

  let message: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      decideSuggestion(db, user.id, { suggestionId: suggestionId.data, action: action.data, note: String(formData.get("note") ?? ""), finalValue: action.data === "override" ? finalValue : null }),
    );
  } catch (err) {
    if (err instanceof DecisionNoteRequiredError || err instanceof SuggestionNotPendingError) message = err.message;
    else if (err instanceof SuggestionApplyError) message = `It could not be applied: ${err.message}`;
    else if (err instanceof NotFoundOrForbiddenError) message = "You do not have permission to decide this. Gated items need an Engagement Manager.";
    else {
      console.error("decideSuggestionAction failed", err);
      message = "Something went wrong. Please try again.";
    }
  }
  revalidatePath(path);
  redirect(message ? withFlag(path, "error", message) : withFlag(path, "saved", action.data === "approve" ? "Approved and applied." : action.data === "override" ? "Changed and applied." : "Rejected."));
}

export async function approveSelectedAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { path } = target(formData);
  const chosen = formData.getAll("ids").map(String).filter((x) => z.string().uuid().safeParse(x).success);
  if (chosen.length === 0) redirect(withFlag(path, "error", "Tick at least one item first."));
  let message: string | null = null;
  let ok = "";
  try {
    const r = await withRequestDb(user.id, (db) => approveMany(db, user.id, chosen));
    ok = `Approved ${r.approved} item(s).${r.failed.length ? ` ${r.failed.length} could not be applied: ${r.failed[0]!.error}` : ""}`;
  } catch (err) {
    console.error("approveSelectedAction failed", err);
    message = err instanceof NotFoundOrForbiddenError ? "You do not have permission to do that." : "Something went wrong. Please try again.";
  }
  revalidatePath(path);
  redirect(message ? withFlag(path, "error", message) : withFlag(path, "saved", ok));
}
