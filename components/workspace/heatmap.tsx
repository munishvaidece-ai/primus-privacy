import type { CrossRisk } from "@/lib/workspace/portfolio";

// A 5x5 likelihood x impact grid. Risks without scores are listed beneath it,
// never placed on the grid.
const bg = (l: number, i: number) => {
  const s = l * i;
  return s >= 15 ? "bg-red-100" : s >= 8 ? "bg-amber-100" : s >= 4 ? "bg-yellow-50" : "bg-emerald-50";
};

export function HeatMap({ risks }: { risks: CrossRisk[] }) {
  const grid = (l: number, i: number) => risks.filter((r) => r.likelihood === l && r.impact === i);
  const unscored = risks.filter((r) => !r.likelihood || !r.impact);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1 text-center text-xs" aria-label="Risk heat map: likelihood against impact">
          <caption className="sr-only">Number of risks at each likelihood and impact</caption>
          <thead>
            <tr><th scope="col" className="px-2 text-slate-500">Likelihood ↓ / Impact →</th>{[1, 2, 3, 4, 5].map((i) => <th key={i} scope="col" className="w-14 text-slate-500">{i}</th>)}</tr>
          </thead>
          <tbody>
            {[5, 4, 3, 2, 1].map((l) => (
              <tr key={l}>
                <th scope="row" className="px-2 text-slate-500">{l}</th>
                {[1, 2, 3, 4, 5].map((i) => {
                  const n = grid(l, i).length;
                  return <td key={i} className={`h-12 w-14 rounded ${bg(l, i)} ${n ? "font-semibold text-slate-900" : "text-slate-400"}`} title={n ? grid(l, i).map((r) => r.title).join("; ") : undefined}>{n || "·"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unscored.length > 0 ? <p className="mt-2 text-xs text-slate-500">{unscored.length} risk{unscored.length === 1 ? " has" : "s have"} no likelihood/impact score and {unscored.length === 1 ? "is" : "are"} not on the grid.</p> : null}
    </div>
  );
}
