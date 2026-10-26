import { requireAuthenticatedUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { CONNECTORS, CONNECTOR_CATEGORIES } from "@/lib/connectors/catalog";

export const metadata = { title: "Connectors — PRIMUS PRIVACY" };

// The portal-wide list of every connector, grouped by what it connects to.
// "Available now" means built and tested in this release; "Planned" means
// listed so clients can see the roadmap — it cannot be set up yet.
export default async function ConnectorCataloguePage() {
  await requireAuthenticatedUser();
  const available = CONNECTORS.filter((c) => c.status === "available");
  const planned = CONNECTORS.filter((c) => c.status === "planned");
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Connectors</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        Connectors let the AI look at a client&rsquo;s systems directly instead of waiting for documents. You can always start with uploads and add connectors one by one as the client approves each. Every connector keeps <strong>only metadata</strong> — names, locations and the kinds of personal data found — never the personal data itself. Where a connector runs matters: deploy the worker inside the client&rsquo;s environment and the data never leaves it.
      </p>
      <p className="mt-3 text-sm text-slate-700"><strong>{available.length}</strong> available now · <strong>{planned.length}</strong> planned. “Available” means built <em>and</em> tested in this release. Planned connectors cannot be set up yet, and we say so rather than pretend.</p>

      {CONNECTOR_CATEGORIES.map((cat) => {
        const items = CONNECTORS.filter((c) => c.category === cat);
        if (items.length === 0) return null;
        return (
          <section key={cat} className="mt-8" aria-labelledby={`cat-${cat}`}>
            <h2 id={`cat-${cat}`} className="text-sm font-semibold uppercase tracking-wide text-slate-500">{cat}</h2>
            <ul className="mt-3 grid gap-4 md:grid-cols-2">
              {items.map((c) => (
                <li key={c.type} className="rounded-md border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-slate-900">{c.name}</h3>
                    <Badge tone={c.status === "available" ? "positive" : "neutral"}>{c.native ? "Built in" : c.status === "available" ? "Available now" : "Planned"}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">{c.summary}</p>
                  <dl className="mt-3 space-y-1 text-xs text-slate-600">
                    <div><dt className="inline font-semibold">It reads: </dt><dd className="inline">{c.reads}</dd></div>
                    <div><dt className="inline font-semibold">We keep: </dt><dd className="inline">{c.keeps}</dd></div>
                    <div><dt className="inline font-semibold">Runs: </dt><dd className="inline">{c.runsWhere}</dd></div>
                    <div><dt className="inline font-semibold">{c.status === "available" ? "How it was checked: " : "Status: "}</dt><dd className="inline">{c.verification}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="mt-8 text-sm text-slate-500">To add a connector to an engagement, open the engagement → AI Operations Centre → Connectors.</p>
    </div>
  );
}
