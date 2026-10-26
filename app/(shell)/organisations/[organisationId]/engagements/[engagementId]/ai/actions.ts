"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { AgentNotProvisionedError, InvalidAiSettingsError, pauseAi, resumeAi, saveAiSettings } from "@/lib/ai/settings";
import { retryJob, runNow } from "@/lib/ai/control";
import { aiBase, withFlag } from "@/components/ai/shell";

const ids = z.object({ organisationId: z.string().uuid(), engagementId: z.string().uuid() });

function target(formData: FormData): { base: string; scope: z.infer<typeof ids> } {
  const parsed = ids.safeParse({ organisationId: formData.get("organisationId"), engagementId: formData.get("engagementId") });
  if (!parsed.success) redirect("/organisations");
  return { base: aiBase(parsed.data.organisationId, parsed.data.engagementId), scope: parsed.data };
}

/** Runs an action and turns known failures into a plain message on the page. */
async function guarded(base: string, fn: () => Promise<void>, ok = "1"): Promise<never> {
  let message: string | null = null;
  try {
    await fn();
  } catch (err) {
    if (err instanceof NotFoundOrForbiddenError) message = "You do not have permission to do that on this engagement.";
    else if (err instanceof AgentNotProvisionedError || err instanceof InvalidAiSettingsError) message = err.message;
    else {
      console.error("AI action failed", err);
      message = "Something went wrong. Please try again, or ask your administrator to check the server log.";
    }
  }
  revalidatePath(base);
  redirect(message ? withFlag(base, "error", message) : withFlag(base, "saved", ok));
}

const pct = (v: FormDataEntryValue | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n / 100 : fallback;
};

export async function saveAiSettingsAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { base, scope } = target(formData);
  const level = Number(formData.get("level"));
  await guarded(base, async () => {
    await withRequestDb(user.id, (db) =>
      saveAiSettings(db, user.id, {
        ...scope,
        enabled: formData.get("enabled") === "on",
        level: level as 1 | 2 | 3,
        thresholdSupervised: pct(formData.get("thresholdSupervised"), 0.9),
        thresholdFull: pct(formData.get("thresholdFull"), 0.75),
        gates: {
          rejectCriticalEvidence: formData.get("gateRejectCriticalEvidence") === "on",
          releaseCriticalFindings: formData.get("gateReleaseCriticalFindings") === "on",
          issueFinalReport: formData.get("gateIssueFinalReport") === "on",
          sendBreachNotices: formData.get("gateSendBreachNotices") === "on",
        },
        allowExternalAi: formData.get("allowExternalAi") === "on",
      }),
    );
  }, "Settings saved.");
}

export async function pauseAiAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { base, scope } = target(formData);
  await guarded(base, () => withRequestDb(user.id, (db) => pauseAi(db, user.id, scope)), "The AI is paused. It cannot read or change anything on this engagement until you resume it.");
}

export async function resumeAiAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { base, scope } = target(formData);
  await guarded(base, () => withRequestDb(user.id, (db) => resumeAi(db, user.id, scope)), "The AI is running again.");
}

export async function runNowAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { base, scope } = target(formData);
  await guarded(base, async () => {
    await withRequestDb(user.id, (db) => runNow(db, user.id, scope));
  }, "Asked the AI to look for work now. Results appear in a few moments.");
}

export async function retryJobAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { base, scope } = target(formData);
  const jobId = z.string().uuid().safeParse(formData.get("jobId"));
  if (!jobId.success) redirect(withFlag(base, "error", "Unknown job."));
  await guarded(base, () => withRequestDb(user.id, (db) => retryJob(db, user.id, scope, jobId.data)), "Put back in the queue.");
}
