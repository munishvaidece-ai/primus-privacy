import Link from "next/link";
import { loadAiContext } from "../load";
import { AiShell, CARD } from "@/components/ai/shell";
import { SideBadge } from "@/components/ai/evidence-trail";
import { Badge } from "@/components/ui/badge";
import { getQueueCounts } from "@/lib/ai/suggestions";
import { GROUP_LABELS, loadInventory, type InventoryGroup } from "@/lib/ai/inventory";

const ORDER: InventoryGroup[] = ["documents", "answers", "landscape", "tests", "cases", "connectors"];

export default async function DataPage({ params }: { params: { organisationId: string; engagementId: string } }) {
  const base = `/organisations/${params.organisationId}/engagements/${params.engagementId}`;
  const { ctx, data } = await loadAiContext(params, async (db) => {
    const [items, counts] = await Promise.all([loadInventory(db, params.organisationId, params.engagementId), getQueueCounts(db, params.engagementId)]);
    return { items, counts };
  });
  const fromClient = data.items.filter((i) => i.provider?.side === "client").length;
  const fromPrimus = data.items.filter((i) => i.provider?.side === "primus").length;
  return (
    <AiShell {...ctx} active="/data" badge={{ queue: data.counts.pending }}>
      <p className="max-w-3xl text-sm text-slate-600">
        This is the complete list of what the AI is able to read on this engagement, who put each item there, and which AI outputs have used it. Nothing outside this list reaches the AI. The AI does not search the internet, open files on anyone&rsquo;s computer, or look at any other client&rsquo;s data.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className={CARD}><p className="text-2xl font-semibold text-slate-900">{data.items.length}</p><p className="text-sm text-slate-600">items the AI can read</p></div>
        <div className={CARD}><p className="text-2xl font-semibold text-slate-900">{fromClient}</p><p className="text-sm text-slate-600">supplied by the client organisation</p></div>
        <div className={CARD}><p className="text-2xl font-semibold text-slate-900">{fromPrimus}</p><p className="text-sm text-slate-600">supplied by the Primus team</p></div>
      </div>

      <section className={`${CARD} mt-6`}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">What the AI does not read</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>The discovery questionnaire (the organisation&rsquo;s answers to the opening questions).</li>
          <li>Anything marked private to another firm, other engagements, or other clients.</li>
          <li>Clarification messages between the Primus team and the client.</li>
          <li>Files that have not been uploaded to the platform.</li>
        </ul>
      </section>

      {ORDER.map((g) => {
        const rows = data.items.filter((i) => i.group === g);
        if (rows.length === 0) return null;
        return (
          <section key={g} className="mt-8" aria-labelledby={`g-${g}`}>
            <h2 id={`g-${g}`} className="text-sm font-semibold uppercase tracking-wide text-slate-500">{GROUP_LABELS[g]} ({rows.length})</h2>
            <p className="mt-1 text-xs text-slate-500">{rows[0]!.how}</p>
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50"><tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500"><th scope="col" className="px-3 py-2">Item</th><th scope="col" className="px-3 py-2">Who supplied it</th><th scope="col" className="px-3 py-2">Through which screen</th><th scope="col" className="px-3 py-2">When</th><th scope="col" className="px-3 py-2">Used in</th></tr></thead>
                <tbody className="divide-y divide-slate-100 align-top">
                  {rows.map((r) => (
                    <tr key={r.ref}>
                      <td className="px-3 py-2"><p className="font-medium text-slate-900">{r.title}</p><p className="mt-0.5 text-xs text-slate-600">{r.detail}</p></td>
                      <td className="px-3 py-2">{r.provider ? <SideBadge side={r.provider.side} name={r.provider.name} /> : <span className="text-slate-500">Unknown</span>}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">{r.channel}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{r.at ? r.at.slice(0, 10) : "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.usedIn.length === 0 ? <span className="text-slate-400">Not used yet</span> : <Link href={`${base}/ai/decisions`} className="font-medium text-brand-700 hover:underline"><Badge tone="positive">{r.usedIn.length} AI output{r.usedIn.length === 1 ? "" : "s"}</Badge></Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </AiShell>
  );
}
