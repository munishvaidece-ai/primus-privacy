import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { BANK_KEYS, BANK_TOTAL, bankTitle, questionsFor, type BankSetKey } from "@/lib/workspace/question-bank";
import { SELECTABLE_SECTORS } from "@/lib/regulation";
import { Badge } from "@/components/ui/badge";
import { CARD, PageHeader, TD, TH } from "@/components/ui/kit";

const OPTION_LABEL: Record<string, string> = { choice: "Yes / Partly / No / Not sure", text: "Free text", yesno: "Yes / No", multi: "Pick several", line: "Short answer" };

/** Every question Primus can ask, by sector. Choose a sector and the questions change to match. */
export default async function QuestionBankPage({ searchParams }: { searchParams: { sector?: string; q?: string } }) {
  const { viewer } = await loadPage(async () => null);
  if (viewer.isClient) redirect("/portal/questions");
  const key: BankSetKey | "all" = (BANK_KEYS as string[]).includes(searchParams.sector ?? "") ? (searchParams.sector as BankSetKey) : "all";
  const needle = (searchParams.q ?? "").trim().toLowerCase();
  const shown = (key === "all" ? BANK_KEYS : [key]).map((k) => ({ k, qs: questionsFor(k).filter((x) => !needle || x.label.toLowerCase().includes(needle) || x.topic.toLowerCase().includes(needle)) })).filter((g) => g.qs.length > 0);
  const count = shown.reduce((n, g) => n + g.qs.length, 0);
  const chip = (active: boolean) => `rounded-full px-3 py-1 text-sm ring-1 ring-inset ${active ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`;
  const link = (s: string) => `/question-bank?sector=${s}${needle ? `&q=${encodeURIComponent(needle)}` : ""}`;
  return (
    <div>
      <PageHeader title="Question bank" subtitle={`${BANK_TOTAL} questions across ${SELECTABLE_SECTORS.length} sectors, plus a common set. Choose a sector to see the questions a client in that sector is asked.`} />
      <nav aria-label="Sector" className="flex flex-wrap gap-2">
        <Link href={link("all")} className={chip(key === "all")} aria-current={key === "all" ? "page" : undefined}>Whole bank</Link>
        <Link href={link("common")} className={chip(key === "common")} aria-current={key === "common" ? "page" : undefined}>Every sector</Link>
        {SELECTABLE_SECTORS.map((s) => <Link key={s.key} href={link(s.key)} className={chip(key === s.key)} aria-current={key === s.key ? "page" : undefined}>{s.label}</Link>)}
      </nav>
      <form method="get" className="mt-4 flex max-w-md items-end gap-2">
        {key !== "all" ? <input type="hidden" name="sector" value={key} /> : null}
        <label className="block flex-1 text-xs font-medium text-slate-700">Search the questions
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="for example: vendors, consent, children" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 hover:border-slate-400">Search</button>
      </form>
      <p className="mt-3 text-sm text-slate-600">{count} question{count === 1 ? "" : "s"} shown. Clients answer these in the portal under &ldquo;Question sets&rdquo;; the set they see follows the sector they choose in Discovery or the sector you set on their engagement. <Link href="/resources" className="font-medium text-brand-700 hover:underline">Read the laws behind them →</Link></p>
      <div className="mt-6 space-y-8">
        {shown.length === 0 ? <p className={CARD}>No question matches that search.</p> : shown.map((g) => (
          <section key={g.k} aria-labelledby={`b-${g.k}`}>
            <h2 id={`b-${g.k}`} className="font-display text-lg font-semibold text-slate-900">{bankTitle(g.k)} <Badge>{g.qs.length}</Badge></h2>
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50"><tr><th scope="col" className={TH}>#</th><th scope="col" className={TH}>Topic</th><th scope="col" className={TH}>Question</th><th scope="col" className={TH}>Answer type</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {g.qs.map((x) => (
                    <tr key={x.key}><td className={`${TD} whitespace-nowrap text-slate-500`}>{x.key.replace("q", "")}</td><td className={`${TD} whitespace-nowrap text-slate-600`}>{x.topic}</td><td className={`${TD} text-slate-900`}>{x.label}</td><td className={`${TD} whitespace-nowrap text-xs text-slate-600`}>{OPTION_LABEL[x.type] ?? x.type}</td></tr>
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
