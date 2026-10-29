import Link from "next/link";
import { loadPortal } from "@/lib/workspace/page";
import { getDiscovery } from "@/lib/workspace/discovery";
import { hasPermission } from "@/lib/workspace/common";
import { SECTIONS, missingFields, sectionComplete } from "@/lib/workspace/discovery-sections";
import { PortalHeader } from "@/components/portal/header";
import { AutosaveForm } from "@/components/portal/discovery-form";
import { FieldInput } from "@/components/portal/field-input";
import { DiscoveryAnswers, ObligationsPreview } from "@/components/workspace/discovery-readonly";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD, Flash, Progress } from "@/components/ui/kit";
import { saveDiscoveryAction, submitDiscoveryAction } from "../../workspace-actions";

export default async function PortalDiscovery({ searchParams }: { searchParams: { e?: string; step?: string; saved?: string; error?: string } }) {
  const { portal, data } = await loadPortal(searchParams, async ({ db, user, current }) => ({
    state: await getDiscovery(db, user.id, current.id),
    canEdit: await hasPermission(db, user.id, current, "client.contribute"),
  }));
  const { state, canEdit } = data;
  const m = portal.current;
  const locked = state.status !== "in_progress";
  const editable = canEdit && !locked;
  const stepNo = Math.min(Math.max(parseInt(searchParams.step ?? "", 10) || (SECTIONS.find((s) => !state.completed[s.key])?.step ?? 1), 1), SECTIONS.length);
  const section = SECTIONS[stepNo - 1]!;
  const sectionAnswers = state.answers[section.key] ?? {};
  const back = `/portal/discovery?${portal.engagements.length > 1 ? `e=${m.id}&` : ""}step=${stepNo}`;
  const stepHref = (n: number) => `/portal/discovery?${portal.engagements.length > 1 ? `e=${m.id}&` : ""}step=${n}`;
  const allComplete = state.completedCount === state.total;
  const stateBadge = state.status === "approved" ? <Badge tone="positive">Approved by Primus</Badge> : state.status === "submitted" ? <Badge tone="warning">Waiting for Primus review</Badge> : <Badge tone="neutral">In progress</Badge>;

  return (
    <div>
      <PortalHeader title="Discovery questionnaire" subtitle="Thirteen short steps that tell Primus how your organisation uses personal data. Your answers decide which obligations apply." engagements={portal.engagements} current={m} actions={stateBadge} />
      <Flash saved={searchParams.saved} error={searchParams.error} />
      {locked ? <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.status === "submitted" ? "You have submitted this questionnaire. It is read-only while Primus reviews it; they can return it to you if changes are needed." : "Primus has approved your answers and the scope is confirmed. The questionnaire is now read-only."}</p> : null}
      {!canEdit && !locked ? <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">Your role can read this questionnaire but not change it.</p> : null}

      <div className="mb-4 max-w-md"><Progress value={(state.completedCount / state.total) * 100} label="Steps complete" /><p className="mt-1 text-xs text-slate-500">{state.completedCount} of {state.total} steps complete</p></div>

      {locked ? (
        <>
          <DiscoveryAnswers state={state} />
          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Indicative obligations</h2>
          <p className="mb-3 max-w-3xl text-sm text-slate-600">Worked out from your answers, your data map and your sector. Primus confirms the final scope.</p>
          <ObligationsPreview href={`/portal/regulations${portal.q}`} />
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <nav aria-label="Questionnaire steps">
            <ol className="space-y-1">
              {SECTIONS.map((s) => (
                <li key={s.key}>
                  <Link href={stepHref(s.step)} aria-current={s.step === stepNo ? "step" : undefined} className={`flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm ${s.step === stepNo ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                    <span>{s.step}. {s.title}</span>
                    {state.completed[s.key] ? <span aria-label="complete" className="text-xs">✓</span> : null}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>
          <section className={CARD} aria-labelledby="step-h">
            <h2 id="step-h" className="text-base font-semibold text-slate-900">Step {section.step}: {section.title}</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">{section.intro}</p>
            {section.key === "business_units" ? <p className="mt-2 text-xs"><Link href="/portal/business-units" className="underline">Open the business units register</Link></p> : null}
            {section.key === "processing_activities" ? <p className="mt-2 text-xs"><Link href="/portal/processing" className="underline">Open the processing activities register</Link></p> : null}
            <AutosaveForm action={saveDiscoveryAction}>
              <input type="hidden" name="engagementId" value={m.id} />
              <input type="hidden" name="sectionKey" value={section.key} />
              <input type="hidden" name="back" value={back} />
              <div className="mt-4 space-y-4">{section.fields.map((f) => <FieldInput key={f.key} f={f} value={sectionAnswers[f.key]} disabled={!editable} />)}</div>
              {editable ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button type="submit" name="intent" value="save" variant="secondary">Save draft</Button>
                  <Button type="submit" name="intent" value="complete">Save and mark complete</Button>
                </div>
              ) : null}
            </AutosaveForm>
            {state.completed[section.key] ? <p className="mt-3 text-xs text-emerald-700">This step is marked complete.</p> : !sectionComplete(section, sectionAnswers) ? <p className="mt-3 text-xs text-slate-500">Still needed: {missingFields(section, sectionAnswers).map((f) => f.label).join("; ") || "confirm the scope"}.</p> : null}
            <div className="mt-6 flex justify-between text-sm">
              {stepNo > 1 ? <Link href={stepHref(stepNo - 1)} className="underline">← Previous</Link> : <span />}
              {stepNo < SECTIONS.length ? <Link href={stepHref(stepNo + 1)} className="underline">Next →</Link> : <span />}
            </div>
          </section>
        </div>
      )}

      {editable ? (
        <section className={`${CARD} mt-6`} aria-labelledby="sub">
          <h2 id="sub" className="text-sm font-semibold text-slate-900">Submit to Primus</h2>
          {allComplete ? (
            <form action={submitDiscoveryAction} className="mt-2 flex flex-wrap items-center gap-4">
              <input type="hidden" name="engagementId" value={m.id} /><input type="hidden" name="back" value={`/portal/discovery${portal.q}`} />
              <p className="max-w-xl text-sm text-slate-600">All thirteen steps are complete. Once you submit, you cannot edit the answers unless Primus returns them.</p>
              <Button type="submit">Submit questionnaire</Button>
            </form>
          ) : <p className="mt-2 text-sm text-slate-600">Complete all {state.total} steps to submit. {state.total - state.completedCount} left.</p>}
        </section>
      ) : null}
    </div>
  );
}
