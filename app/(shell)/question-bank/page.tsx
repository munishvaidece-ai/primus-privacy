import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPage, uuidOr } from "@/lib/workspace/page";
import { engagementMetrics } from "@/lib/workspace/portfolio";
import { getSectorQuestions } from "@/lib/workspace/discovery";
import { BANK_KEYS, BANK_TOTAL, bankTitle, questionsFor, type BankSetKey } from "@/lib/workspace/question-bank";
import { DPDP_DUTIES } from "@/lib/workspace/question-bank-extra";
import { SELECTABLE_SECTORS, sectorByKey } from "@/lib/regulation";
import { Badge } from "@/components/ui/badge";
import { CARD, PageHeader, TD, TH } from "@/components/ui/kit";

export const metadata = { title: "Question bank — PRIMUS PRIVACY" };

const OPTION_LABEL: Record<string, string> = { choice: "Yes / Partly / No / Not sure", text: "Free text", yesno: "Yes / No", multi: "Pick several", line: "Short answer" };
const chip = (active: boolean) => `rounded-full px-3 py-1 text-sm ring-1 ring-inset ${active ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`;

/**
 * The question bank, two ways. "By sector" is the whole bank, filtered by sector. "By client" is exactly what one
 * client is asked (the common set and the set for their sector), with their answers, so you can see what they see.
 */
export default async function QuestionBankPage({ searchParams }: { searchParams: { view?: string; sector?: string; q?: string; e?: string } }) {
  const byClient = searchParams.view === "client";
  const { viewer, data } = await loadPage(async ({ db, user }) => {
    if (!byClient) return { engagements: [], current: null, state: null };
    const engagements = await engagementMetrics(db);
    const wanted = uuidOr(searchParams.e);
    const current = engagements.find((e) => e.id === wanted) ?? engagements.find((e) => e.status === "active") ?? engagements[0] ?? null;
    return { engagements, current, state: current ? await getSectorQuestions(db, user.id, current.id) : null };
  });
  if (viewer.isClient) redirect("/portal/questions");

  const tabs = (
    <nav aria-label="View" className="mb-5 flex flex-wrap gap-2">
      <Link href="/question-bank" className={chip(!byClient)} aria-current={!byClient ? "page" : undefined}>By sector: the whole bank</Link>
      <Link href="/question-bank?view=client" className={chip(byClient)} aria-current={byClient ? "page" : undefined}>By client: what they answer</Link>
    </nav>
  );

  if (byClient) {
    const { engagements, current, state } = data;
    return (
      <div>
        <PageHeader title="Question bank" subtitle="Choose a client to see the exact questions they answer: Part 1 for every organisation, then Part 2 for their sector, with their answers so far." />
        {tabs}
        {engagements.length === 0 || !current || !state ? <p className={CARD}>There are no engagements yet.</p> : (
          <>
            <nav aria-label="Client" className="mb-4 flex flex-wrap gap-2">
              {engagements.map((e) => <Link key={e.id} href={`/question-bank?view=client&e=${e.id}`} aria-current={e.id === current.id ? "page" : undefined} className={chip(e.id === current.id)}>{e.organisationName}: {e.name}</Link>)}
            </nav>
            <p className="mb-4 text-sm text-slate-600">
              {state.declared || state.setByPrimus.length
                ? <>{current.organisationName}&rsquo;s sector{[...new Set([...state.setByPrimus, ...(state.declared ? [state.declared] : [])])].length > 1 ? "s are" : " is"} <strong>{[...new Set([...state.setByPrimus, ...(state.declared ? [state.declared] : [])])].map((k) => sectorByKey(k)?.label ?? k).join(" and ")}</strong>, so they see Part 1 and the matching Part 2. </>
                : <>{current.organisationName} has not chosen a sector yet, so they see only Part 1. Set it on the engagement or ask them to choose it in Discovery step 1. </>}
              Answers are read-only here.
            </p>
            <div className="space-y-8">
              {state.sets.map((s, i) => (
                <section key={s.key} aria-labelledby={`c-${s.key}`}>
                  <h2 id={`c-${s.key}`} className="font-display text-lg font-semibold text-slate-900">{i === 0 ? "Part 1: " : "Part 2: "}{bankTitle(s.key)} <Badge>{s.answered} of {s.section.fields.length} answered</Badge> {s.complete ? <Badge tone="positive">Complete</Badge> : null}</h2>
                  <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50"><tr><th scope="col" className={TH}>#</th><th scope="col" className={TH}>Topic</th><th scope="col" className={TH}>Question</th><th scope="col" className={TH}>Their answer</th><th scope="col" className={TH}>Their note</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {s.section.fields.map((f) => {
                          const a = s.answers[f.key];
                          const label = typeof a === "string" ? f.options?.find((o) => o.value === a)?.label ?? a : null;
                          return (
                            <tr key={f.key}>
                              <td className={`${TD} whitespace-nowrap text-slate-500`}>{f.key.replace("q", "")}</td>
                              <td className={`${TD} whitespace-nowrap text-slate-600`}>{(questionsFor(s.key).find((x) => x.key === f.key)?.topic) ?? ""}</td>
                              <td className={`${TD} text-slate-900`}>{f.label}</td>
                              <td className={`${TD} whitespace-nowrap`}>{label ? <Badge tone={label === "Yes" ? "positive" : label === "No" ? "critical" : "neutral"}>{label}</Badge> : <span className="text-slate-400">Not answered</span>}</td>
                              <td className={`${TD} text-xs text-slate-700`}>{String(s.answers[`${f.key}_note`] ?? "")}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  const key: BankSetKey | "all" = (BANK_KEYS as string[]).includes(searchParams.sector ?? "") ? (searchParams.sector as BankSetKey) : "all";
  const needle = (searchParams.q ?? "").trim().toLowerCase();
  const shown = (key === "all" ? BANK_KEYS : [key]).map((k) => ({ k, qs: questionsFor(k).filter((x) => !needle || x.label.toLowerCase().includes(needle) || x.topic.toLowerCase().includes(needle) || (x.ref ?? "").toLowerCase().includes(needle)) })).filter((g) => g.qs.length > 0);
  const count = shown.reduce((n, g) => n + g.qs.length, 0);
  const link = (s: string) => `/question-bank?sector=${s}${needle ? `&q=${encodeURIComponent(needle)}` : ""}`;
  const common = questionsFor("common");
  const coverage = DPDP_DUTIES.map((d) => ({ ...d, n: common.filter((x) => (x.ref ?? "").split(";").map((r) => r.trim()).includes(d.ref)).length }));
  return (
    <div>
      <PageHeader title="Question bank" subtitle={`${BANK_TOTAL} questions: a common set for every organisation, plus a set for each of ${SELECTABLE_SECTORS.length} sectors. Choose a sector to see the questions a client in that sector is asked.`} />
      {tabs}
      <nav aria-label="Sector" className="flex flex-wrap gap-2">
        <Link href={link("all")} className={chip(key === "all")} aria-current={key === "all" ? "page" : undefined}>Whole bank</Link>
        <Link href={link("common")} className={chip(key === "common")} aria-current={key === "common" ? "page" : undefined}>Every sector (common)</Link>
        {SELECTABLE_SECTORS.map((s) => <Link key={s.key} href={link(s.key)} className={chip(key === s.key)} aria-current={key === s.key ? "page" : undefined}>{s.label}</Link>)}
      </nav>
      <form method="get" className="mt-4 flex max-w-md items-end gap-2">
        {key !== "all" ? <input type="hidden" name="sector" value={key} /> : null}
        <label className="block flex-1 text-xs font-medium text-slate-700">Search the questions
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="for example: vendors, consent, children, Rule 7" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 hover:border-slate-400">Search</button>
      </form>
      <p className="mt-3 text-sm text-slate-600">{count} question{count === 1 ? "" : "s"} shown. Clients answer these in the portal under &ldquo;Question sets&rdquo;; the set they see follows the sector they choose in Discovery or the sector you set on their engagement. <Link href="/resources" className="font-medium text-brand-700 hover:underline">Read the laws behind them →</Link></p>

      {key === "all" || key === "common" ? (
        <details className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Coverage of the DPDP Act and Rules ({coverage.filter((c) => c.n > 0).length} of {coverage.length} duties have a question)</summary>
          <div className="mt-3 overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50"><tr><th scope="col" className={TH}>Part of the law</th><th scope="col" className={TH}>Duty</th><th scope="col" className={TH}>Questions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{coverage.map((c) => <tr key={c.ref}><td className={`${TD} whitespace-nowrap font-medium text-slate-900`}>{c.ref}</td><td className={TD}>{c.duty}</td><td className={TD}>{c.n}</td></tr>)}</tbody>
          </table></div>
          <p className="mt-2 text-xs text-slate-500">Sector questions check the sector rules on top of this. Each sector&rsquo;s laws are on the Resources page.</p>
        </details>
      ) : null}

      <div className="mt-6 space-y-8">
        {shown.length === 0 ? <p className={CARD}>No question matches that search.</p> : shown.map((g) => (
          <section key={g.k} aria-labelledby={`b-${g.k}`}>
            <h2 id={`b-${g.k}`} className="font-display text-lg font-semibold text-slate-900">{bankTitle(g.k)} <Badge>{g.qs.length}</Badge></h2>
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50"><tr><th scope="col" className={TH}>#</th><th scope="col" className={TH}>Topic</th><th scope="col" className={TH}>Question</th>{g.k === "common" ? <th scope="col" className={TH}>DPDP reference</th> : null}<th scope="col" className={TH}>Answer type</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {g.qs.map((x) => (
                    <tr key={x.key}><td className={`${TD} whitespace-nowrap text-slate-500`}>{x.key.replace("q", "")}</td><td className={`${TD} whitespace-nowrap text-slate-600`}>{x.topic}</td><td className={`${TD} text-slate-900`}>{x.label}</td>{g.k === "common" ? <td className={`${TD} whitespace-nowrap text-xs text-slate-600`}>{x.ref ?? ""}</td> : null}<td className={`${TD} whitespace-nowrap text-xs text-slate-600`}>{OPTION_LABEL[x.type] ?? x.type}{x.options?.some((o) => o.value === "na") ? " + Not applicable" : ""}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
