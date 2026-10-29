import { Badge } from "@/components/ui/badge";
import { EFFECT, type Overlap } from "@/lib/regulation";
import { sectorByKey } from "@/lib/regulation";

/** Where the DPDP Act and a sector's own rules cover the same ground, and which one governs. Every entry is flagged for legal review. */
export function OverlapList({ overlaps, title = "Where DPDP and sector law overlap", showSector = false, you = false }: { overlaps: Overlap[]; title?: string; showSector?: boolean; you?: boolean }) {
  if (overlaps.length === 0) return null;
  const hid = `overlap-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={hid} className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5">
      <h3 id={hid} className="text-sm font-semibold uppercase tracking-wide text-amber-900">{title}</h3>
      <p className="mt-1 max-w-3xl text-xs text-slate-700">The DPDP Act applies in addition to other laws, and it prevails if the two truly conflict (s.38). Some points hand back to another law on purpose. Each one is flagged here so {you ? "you can follow the right rule" : "it is not missed"}. These are working notes, not legal advice.</p>
      <ul className="mt-3 space-y-3">
        {overlaps.map((x) => (
          <li key={x.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">{x.topic}</p>
              <Badge tone={EFFECT[x.effect].tone}>{EFFECT[x.effect].label}</Badge>
              {x.legalReview ? <Badge tone="neutral">Legal review pending</Badge> : null}
              {showSector ? <Badge tone="neutral">{sectorByKey(x.sector)?.label ?? x.sector}</Badge> : null}
            </div>
            <dl className="mt-2 grid gap-1 text-xs text-slate-700 md:grid-cols-2">
              <div><dt className="inline font-semibold">DPDP: </dt><dd className="inline">{x.dpdp}</dd></div>
              <div><dt className="inline font-semibold">Sector rule: </dt><dd className="inline">{x.sectorRule}</dd></div>
            </dl>
            <p className="mt-2 text-sm text-slate-800"><span className="font-semibold">What governs: </span>{EFFECT[x.effect].governs}</p>
            <p className="mt-1 text-sm text-slate-800"><span className="font-semibold">{you ? "What you do: " : "What to do: "}</span>{x.whatToDo}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
