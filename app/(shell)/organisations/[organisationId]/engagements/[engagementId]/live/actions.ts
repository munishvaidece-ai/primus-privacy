"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { IntakeInputError } from "@/lib/intake/store";
import { approveMany, decideSuggestion, DecisionNoteRequiredError, SuggestionApplyError, SuggestionNotPendingError } from "@/lib/ai/suggestions";
import { getAiSettings, saveAiSettings } from "@/lib/ai/settings";
import { ConnectorInputError, requestConnectorRun } from "@/lib/connectors/service";
import { finalise, isRunStep, loadUploads, releaseAll, releaseFinalReport, runStep, scopeStep, uploadSupport, uploadTemplate, type StepReport } from "@/lib/live/steps";
import { mimeFor } from "@/lib/live/mime";

const ids = z.object({ organisationId: z.string().uuid(), engagementId: z.string().uuid(), phase: z.coerce.number().int().min(1).max(7) });

function parse(formData: FormData) {
  const p = ids.safeParse({ organisationId: formData.get("organisationId"), engagementId: formData.get("engagementId"), phase: formData.get("phase") ?? 1 });
  if (!p.success) redirect("/organisations");
  // The organisation login does the same steps from its own Journey page, so it says where to come back to.
  const wanted = String(formData.get("returnTo") ?? "");
  const returnTo = /^\/portal\/journey(\?e=[0-9a-f-]{36})?$/i.test(wanted) ? wanted : null;
  const base = returnTo ?? `/organisations/${p.data.organisationId}/engagements/${p.data.engagementId}/live`;
  return { scope: { organisationId: p.data.organisationId, engagementId: p.data.engagementId }, phase: p.data.phase, base };
}

function back(base: string, phase: number, report: StepReport): never {
  const [path, existing] = base.split("?");
  const q = new URLSearchParams(existing ?? "");
  q.set(report.ok ? "ok" : "problem", report.message);
  if (report.details?.length) q.set("details", report.details.join("\n"));
  q.set("phase", String(phase));
  revalidatePath(path!);
  redirect(`${path}?${q.toString()}#phase-${phase}`);
}

async function guarded(base: string, phase: number, fn: () => Promise<StepReport>): Promise<never> {
  let report: StepReport;
  try {
    report = await fn();
  } catch (err) {
    if (err instanceof NotFoundOrForbiddenError) report = { ok: false, message: "You do not have permission to do that on this engagement. Sign in as the right person for this step." };
    else if (err instanceof ConnectorInputError || err instanceof IntakeInputError || err instanceof SuggestionApplyError || err instanceof SuggestionNotPendingError || err instanceof DecisionNoteRequiredError) report = { ok: false, message: err.message };
    else if (err instanceof Error && err.name === "WorkspaceInputError") report = { ok: false, message: err.message };
    else {
      console.error("Live run step failed", err);
      report = { ok: false, message: err instanceof Error ? `That step could not be completed: ${err.message.slice(0, 240)}` : "That step could not be completed." };
    }
  }
  return back(base, phase, report);
}

async function toInput(f: File) {
  return { buffer: Buffer.from(await f.arrayBuffer()), filename: f.name, mimeType: f.type || mimeFor(f.name) };
}

export async function uploadAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, phase, base } = parse(formData);
  const kind = String(formData.get("kind"));
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  await guarded(base, phase, async () => {
    if (!files.length) return { ok: false, message: "Choose a file first." };
    const inputs = await Promise.all(files.map(toInput));
    return withRequestDb(user.id, async (db) => {
      if (kind === "template") {
        const reports: StepReport[] = [];
        for (const f of inputs) reports.push(await uploadTemplate(db, user.id, scope, phase, f));
        return { ok: reports.every((r) => r.ok), message: reports.map((r) => r.message).join(" "), details: reports.flatMap((r) => r.details ?? []) };
      }
      return uploadSupport(db, user.id, scope, phase, inputs);
    });
  });
}

export async function loadAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, phase, base } = parse(formData);
  await guarded(base, phase, () => withRequestDb(user.id, (db) => loadUploads(db, user.id, scope, phase)));
}

export async function runAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, phase, base } = parse(formData);
  const step = String(formData.get("step"));
  await guarded(base, phase, async () => {
    if (!isRunStep(step)) return { ok: false, message: "Unknown step." };
    return withRequestDb(user.id, (db) => runStep(db, user.id, scope, step));
  });
}

export async function decideAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, phase, base } = parse(formData);
  void scope;
  const suggestionId = z.string().uuid().parse(formData.get("suggestionId"));
  const action = formData.get("action") === "reject" ? "reject" : "approve";
  const note = String(formData.get("note") ?? "").trim() || (action === "reject" ? "Rejected on the Live Run screen." : null);
  await guarded(base, phase, async () => {
    await withRequestDb(user.id, (db) => decideSuggestion(db, user.id, { suggestionId, action, note }));
    return { ok: true, message: action === "approve" ? "Approved and applied." : "Rejected." };
  });
}

export async function approveAllAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { phase, base } = parse(formData);
  const list = formData.getAll("suggestionId").map(String).filter((s) => z.string().uuid().safeParse(s).success);
  await guarded(base, phase, async () => {
    const r = await withRequestDb(user.id, (db) => approveMany(db, user.id, list));
    return { ok: r.failed.length === 0, message: `${r.approved} approved and applied${r.failed.length ? `, ${r.failed.length} could not be applied` : ""}.`, details: r.failed.map((f) => `${f.title}: ${f.error}`) };
  });
}

export async function scopeAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, phase, base } = parse(formData);
  const step = formData.get("step") === "lock" ? "lock" : "create";
  await guarded(base, phase, () => withRequestDb(user.id, (db) => scopeStep(db, user.id, scope, step)));
}

export async function releaseAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, phase, base } = parse(formData);
  await guarded(base, phase, () => withRequestDb(user.id, (db) => releaseAll(db, user.id, scope)));
}

export async function releaseReportStepAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, phase, base } = parse(formData);
  await guarded(base, phase, () => withRequestDb(user.id, (db) => releaseFinalReport(db, user.id, user.email ?? null, scope)));
}

export async function finaliseAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, phase, base } = parse(formData);
  await guarded(base, phase, () => withRequestDb(user.id, (db) => finalise(db, user.id, scope)));
}

export async function levelAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, phase, base } = parse(formData);
  const level = Number(formData.get("level"));
  await guarded(base, phase, async () => {
    if (![1, 2, 3].includes(level)) return { ok: false, message: "Choose an autopilot level." };
    await withRequestDb(user.id, async (db) => {
      const s = await getAiSettings(db, scope.engagementId, scope.organisationId);
      await saveAiSettings(db, user.id, {
        ...scope,
        enabled: true,
        level: level as 1 | 2 | 3,
        thresholdSupervised: s.thresholdSupervised,
        thresholdFull: s.thresholdFull,
        gates: s.gates,
        allowExternalAi: s.allowExternalAi,
      });
    });
    return { ok: true, message: `Autopilot level set to ${level}.` };
  });
}


export async function connectorAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, phase, base } = parse(formData);
  const connectorId = z.string().uuid().parse(formData.get("connectorId"));
  const kind = formData.get("kind") === "scan" ? "scan" : "test";
  await guarded(base, phase, async () => {
    const r = await withRequestDb(user.id, (db) => requestConnectorRun(db, user.id, scope, connectorId, kind));
    return { ok: true, message: r.queued ? (kind === "scan" ? "Scan started. Watch the live log: the AI reads the database structure and samples values in memory." : "Connection test started.") : "That is already queued." };
  });
}
