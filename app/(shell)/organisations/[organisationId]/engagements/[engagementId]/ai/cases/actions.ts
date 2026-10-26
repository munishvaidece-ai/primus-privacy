"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { CaseInputError, approveCaseResponse, closeCase, createCase, saveDraftResponse, type CaseType } from "@/lib/ai/cases";
import { aiBase, withFlag } from "@/components/ai/shell";

const ids = z.object({ organisationId: z.string().uuid(), engagementId: z.string().uuid() });

function target(formData: FormData) {
  const p = ids.safeParse({ organisationId: formData.get("organisationId"), engagementId: formData.get("engagementId") });
  if (!p.success) redirect("/organisations");
  return { scope: p.data, base: `${aiBase(p.data.organisationId, p.data.engagementId)}/cases` };
}

const csv = (v: FormDataEntryValue | null) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const on = (f: FormData, k: string) => f.get(k) === "on";
const tri = (f: FormData, k: string): boolean | null => (f.get(k) === "yes" ? true : f.get(k) === "no" ? false : null);

function detailsFor(type: CaseType, f: FormData): unknown {
  switch (type) {
    case "rights_request":
      return { requestType: f.get("requestType"), identityVerified: on(f, "identityVerified"), retentionObligation: on(f, "retentionObligation"), notes: String(f.get("notes") ?? "") };
    case "breach": {
      const when = String(f.get("discoveredAt") ?? "");
      const d = new Date(when);
      const n = String(f.get("principalsAffected") ?? "").trim();
      return { discoveredAt: Number.isNaN(d.getTime()) ? when : d.toISOString(), categories: f.getAll("categories").map(String), principalsAffected: n === "" ? null : Number(n), encrypted: on(f, "encrypted"), contained: on(f, "contained"), description: String(f.get("description") ?? "") };
    }
    case "consent_review":
      return { consentText: String(f.get("consentText") ?? ""), languages: csv(f.get("languages")), preTicked: on(f, "preTicked"), bundled: on(f, "bundled"), withdrawalAsEasy: tri(f, "withdrawalAsEasy") };
    case "vendor_review": {
      const h = String(f.get("breachNotificationHours") ?? "").trim();
      return {
        vendorName: String(f.get("vendorName") ?? ""),
        services: String(f.get("services") ?? ""),
        dataCategories: f.getAll("dataCategories").map(String),
        answers: { hasDpa: on(f, "hasDpa"), breachNotificationHours: h === "" ? null : Number(h), certifications: csv(f.get("certifications")), crossBorder: on(f, "crossBorder"), encryptionAtRest: on(f, "encryptionAtRest"), deletionOnExit: on(f, "deletionOnExit"), auditRights: on(f, "auditRights"), subprocessorsDisclosed: on(f, "subprocessorsDisclosed") },
      };
    }
  }
}

async function guarded(path: string, fn: () => Promise<void>, ok: string): Promise<never> {
  let message: string | null = null;
  try {
    await fn();
  } catch (err) {
    if (err instanceof CaseInputError) message = err.message;
    else if (err instanceof NotFoundOrForbiddenError) message = "You do not have permission to do that. Breach responses need an Engagement Manager.";
    else {
      console.error("case action failed", err);
      message = "Something went wrong. Please try again.";
    }
  }
  revalidatePath(path);
  redirect(message ? withFlag(path, "error", message) : withFlag(path, "saved", ok));
}

export async function createCaseAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, base } = target(formData);
  const type = z.enum(["rights_request", "breach", "consent_review", "vendor_review"]).safeParse(formData.get("type"));
  if (!type.success) redirect(withFlag(base, "error", "Unknown case type."));
  await guarded(base, async () => {
    await withRequestDb(user.id, (db) => createCase(db, user.id, scope, { type: type.data, title: String(formData.get("title") ?? ""), details: detailsFor(type.data, formData) }));
  }, "Case opened. The AI will triage it shortly — you will see its proposal under “Needs your review” or on the case itself.");
}

function caseTarget(formData: FormData) {
  const t = target(formData);
  const id = z.string().uuid().safeParse(formData.get("caseId"));
  if (!id.success) redirect(withFlag(t.base, "error", "Unknown case."));
  return { ...t, caseId: id.data, path: `${t.base}/${id.data}` };
}

export async function saveDraftAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, caseId, path } = caseTarget(formData);
  await guarded(path, () => withRequestDb(user.id, (db) => saveDraftResponse(db, user.id, scope, caseId, String(formData.get("draft") ?? ""))), "Draft saved.");
}

export async function approveResponseAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, caseId, path } = caseTarget(formData);
  await guarded(path, () => withRequestDb(user.id, (db) => approveCaseResponse(db, user.id, scope, caseId)), "Response approved. Send it through your normal channel — this platform records the approval; it does not send email.");
}

export async function closeCaseAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, caseId, path } = caseTarget(formData);
  await guarded(path, () => withRequestDb(user.id, (db) => closeCase(db, user.id, scope, caseId)), "Case closed.");
}
