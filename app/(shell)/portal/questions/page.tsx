import Link from "next/link";
import { loadPortal } from "@/lib/workspace/page";
import { getSectorQuestions } from "@/lib/workspace/discovery";
import { hasPermission } from "@/lib/workspace/common";
import { missingFields } from "@/lib/workspace/discovery-sections";
import { sectorByKey } from "@/lib/regulation";
import { PortalHeader } from "@/components/portal/header";
import { AutosaveForm } from "@/components/portal/discovery-form";
import { FieldInput } from "@/components/portal/field-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD, Flash, Progress } from "@/components/ui/kit";
import { saveDiscoveryAction } from "../../workspace-actions";

/** The question sets for this client: the common set, then the set for each of their sectors. The sector comes from their Discovery answer or from Primus. */
export default async function PortalQuestions({ searchParams }: { searchParams: { e?: string; set?: string; saved?: string; error?: string } }) {
  const { portal, data } = await loadPortal(searchParams, async ({ db, user, current }) => ({
    state: await getSectorQuestions(db, user.id, current.id),
    canEdit: await hasPermission(db, user.id, current, "client.contribute"),
  }));
  const { state, canEdit } = data;
  const m = portal.current;
  const sets = state.sets;
  const cur = sets.find((s) => s.key === searchParams.set) ?? sets.find((s) => !s.complete) ?? sets[0]!;
  const editable = canEdit;
  const href = (key: string) => `/portal/questions?${portal.engagements.length > 1 ? `e=${m.id}&` : ""}set=${key}`;
  const total = sets.reduce((n, s) => n + s.section.fields.length, 0);
  const answered = sets.reduce((n, s) => n + s.answered, 0);
  const sectorNames = [...new Set([...state.setByPrimus, ...(state.declared ? [state.declared] : [])])].map((k) => sectorByKey(k)?.label ?? k);

  return (
    <div>
      <PortalHeader title="Your question sets" subtitle={sectorNames.length ? `Your sector${sectorNames.length > 1 ? "s are" : " is"} ${sectorNames.join(" and ")}, so you get the questions that fit ${sectorNames.length > 1 ? "them" : "it"}. Answer when you are ready; you can come back and change your answers at any time.` : "Start with the questions every organisation answers. Choose your sector in the first step of Discovery and the questions for your sector will appear here."} engagements={portal.engagements} current={m} />
      <Flash saved={searchParams.saved} error={searchParams.error} />
      {!canEdit ? <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">Your role can read these questions but not answer them.</p> : null}
      {!state.declared && state.setByPrimus.length === 0 ? <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">You have not told us your sector yet. <Link href={`/portal/discovery${portal.q}`} className="font-medium underline">Pick it in Discovery, step 1</Link>, and your sector questions will show here.</p> : null}

      <div className="mb-4 max-w-md"><Progress value={total ? (answered / total) * 100 : 0} label="Questions answered" /><p className="mt-1 text-xs text-slate-500">{answered} of {total} answered</p></div>

      <ol className="mb-6 grid gap-3 md:grid-cols-2" aria-label="Your two parts">
        {[{ title: "Part 1: Every organisation", sub: "Questions on notice, consent, rights, security, breaches, vendors and the rest of the DPDP Act. Everyone answers these.", set: sets.find((s) => s.key === "common") }, { title: sectorNames.length ? `Part 2: ${sectorNames.join(" and ")}` : "Part 2: Your sector", sub: sectorNames.length ? "Questions that fit the rules of your sector." : "These appear when you choose your sector in Discovery (step 1) or Primus sets it for you.", set: undefined }].map((part, i) => {
          const group = i === 0 ? sets.filter((s) => s.key === "common") : sets.filter((s) => s.key !== "common");
          const n = group.reduce((a, s) => a + s.section.fields.length, 0);
          const done = group.reduce((a, s) => a + s.answered, 0);
          const first = group.find((s) => !s.complete) ?? group[0];
          return (
            <li key={part.title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
              <p className="text-sm font-semibold text-slate-900">{part.title}</p>
              <p className="mt-1 text-xs text-slate-600">{part.sub}</p>
              <p className="mt-2 text-xs text-slate-500">{n ? `${done} of ${n} answered` : "No questions yet"}</p>
              {first ? <Link href={href(first.key)} className="mt-2 inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900 hover:border-slate-400">{done === n && n > 0 ? "Review answers" : done > 0 ? "Continue" : "Start"}</Link> : <Link href={`/portal/discovery${portal.q}`} className="mt-2 inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900 hover:border-slate-400">Choose your sector</Link>}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Question sets">
          <ul className="space-y-1">
            {sets.map((s) => (
              <li key={s.key}>
                <Link href={href(s.key)} aria-current={s.key === cur.key ? "page" : undefined} className={`flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm ${s.key === cur.key ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                  <span>{s.key === "common" ? "For every organisation" : sectorByKey(s.key)?.label ?? s.key}</span>
                  <span className="text-xs">{s.complete ? "✓" : `${s.answered}/${s.section.fields.length}`}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 px-3 text-xs text-slate-500">Read the rules behind these questions in <Link href={`/portal/resources${portal.q}`} className="underline">Resources</Link>.</p>
        </nav>

        <section className={CARD} aria-labelledby="set-h">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="set-h" className="text-base font-semibold text-slate-900">{cur.section.title}</h2>
            {cur.complete ? <Badge tone="positive">Complete</Badge> : <Badge tone="neutral">{cur.answered} of {cur.section.fields.length} answered</Badge>}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">{cur.section.intro}</p>
          <AutosaveForm action={saveDiscoveryAction}>
            <input type="hidden" name="engagementId" value={m.id} />
            <input type="hidden" name="sectionKey" value={cur.section.key} />
            <input type="hidden" name="back" value={href(cur.key)} />
            <div className="mt-4 space-y-4">{cur.section.fields.map((f) => <FieldInput key={f.key} f={f} value={cur.answers[f.key]} disabled={!editable} />)}</div>
            {editable ? (
              <div className="mt-6 flex flex-wrap gap-3">
                <Button type="submit" name="intent" value="save" variant="secondary">Save draft</Button>
                <Button type="submit" name="intent" value="complete">Save and mark complete</Button>
              </div>
            ) : null}
          </AutosaveForm>
          {!cur.complete && missingFields(cur.section, cur.answers).length > 0 ? <p className="mt-3 text-xs text-slate-500">{missingFields(cur.section, cur.answers).length} question{missingFields(cur.section, cur.answers).length === 1 ? "" : "s"} still to answer.</p> : null}
        </section>
      </div>
    </div>
  );
}
