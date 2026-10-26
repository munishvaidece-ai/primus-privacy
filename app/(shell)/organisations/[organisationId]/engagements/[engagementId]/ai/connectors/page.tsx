import Link from "next/link";
import { loadAiContext } from "../load";
import { AiShell, CARD, Flash, INPUT, LABEL } from "@/components/ai/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getQueueCounts } from "@/lib/ai/suggestions";
import { listAssets, listConnectorRuns, listConnectors } from "@/lib/connectors/service";
import { CONNECTORS, availableConnectors, connectorByType, type ConnectorDef } from "@/lib/connectors/catalog";
import { addConnectorAction, runConnectorAction, toggleConnectorAction, updateConnectorAction } from "./actions";

const statusTone = (s: string) => (s === "connected" ? "positive" : s === "error" ? "critical" : s === "disabled" ? "neutral" : "warning");
const statusWord: Record<string, string> = { configured: "Not tested yet", connected: "Working", error: "Problem", disabled: "Switched off" };

export default async function EngagementConnectorsPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string };
  searchParams: { saved?: string; error?: string; asset?: string };
}) {
  const { ctx, data } = await loadAiContext(params, async (db, c) => {
    const [connectors, runs, assets, counts] = await Promise.all([
      listConnectors(db, c.userId, params),
      listConnectorRuns(db, c.userId, params, 15),
      listAssets(db, c.userId, params, { limit: 400 }),
      getQueueCounts(db, params.engagementId),
    ]);
    return { connectors, runs, assets, counts };
  });
  const hidden = (
    <>
      <input type="hidden" name="organisationId" value={params.organisationId} />
      <input type="hidden" name="engagementId" value={params.engagementId} />
    </>
  );
  const nameOf = new Map(data.connectors.map((c) => [c.id, c.name]));
  const observations = data.assets.filter((a) => a.assetType === "observation");
  const dataAssets = data.assets.filter((a) => a.assetType !== "observation" && !["web_page", "web_cookie", "web_tracker"].includes(a.assetType));
  const filter = searchParams.asset === "pii" ? dataAssets.filter((a) => a.piiCategories.length) : dataAssets;

  return (
    <AiShell {...ctx} active="/connectors" badge={{ queue: data.counts.pending }}>
      <Flash saved={searchParams.saved} error={searchParams.error} />
      <p className="max-w-3xl text-sm text-slate-600">
        Connectors let the AI look at the client&rsquo;s systems instead of waiting for documents. You can always start with uploads and add connectors as the client approves each one. A scan keeps only <strong>names, locations and the kinds of personal data found</strong> — never the data itself. The full list of connectors, including those still planned, is on the <Link className="underline" href="/connectors">portal catalogue</Link>.
      </p>

      <section className="mt-6" aria-labelledby="mine">
        <h2 id="mine" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Connected to this engagement</h2>
        {data.connectors.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500">No connectors yet. Add one below.</div>
        ) : (
          <ul className="mt-3 space-y-4">
            {data.connectors.map((c) => {
              const def = connectorByType(c.connectorType) as ConnectorDef;
              const cfg = (c.config ?? {}) as Record<string, string>;
              return (
                <li key={c.id} className={CARD}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">{c.name}</h3>
                      <p className="text-xs text-slate-500">{def?.name}</p>
                    </div>
                    <Badge tone={statusTone(c.status)}>{statusWord[c.status] ?? c.status}</Badge>
                  </div>
                  {c.lastTestMessage ? <p className="mt-2 text-sm text-slate-600">{c.lastTestMessage}</p> : null}
                  <p className="mt-1 text-xs text-slate-400">{c.lastTestedAt ? `Last tested ${c.lastTestedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "Never tested"}{c.lastRunAt ? ` · last scan ${c.lastRunAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <form action={runConnectorAction}>{hidden}<input type="hidden" name="connectorId" value={c.id} /><input type="hidden" name="kind" value="test" /><Button type="submit" size="sm" variant="secondary" disabled={c.status === "disabled"}>Test connection</Button></form>
                    <form action={runConnectorAction}>{hidden}<input type="hidden" name="connectorId" value={c.id} /><input type="hidden" name="kind" value="scan" /><Button type="submit" size="sm" disabled={c.status === "disabled"}>Scan now</Button></form>
                    {ctx.canConfigure ? (
                      <form action={toggleConnectorAction}>{hidden}<input type="hidden" name="connectorId" value={c.id} /><input type="hidden" name="enable" value={c.status === "disabled" ? "1" : "0"} /><Button type="submit" size="sm" variant="ghost">{c.status === "disabled" ? "Switch on" : "Switch off"}</Button></form>
                    ) : null}
                  </div>
                  {ctx.canConfigure && def ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-medium text-slate-700">Edit settings…</summary>
                      <form action={updateConnectorAction} className="mt-3 space-y-3">
                        {hidden}<input type="hidden" name="connectorId" value={c.id} />
                        <div><label className={LABEL} htmlFor={`n-${c.id}`}>Name</label><input id={`n-${c.id}`} name="name" defaultValue={c.name} className={INPUT} /></div>
                        {def.configFields.map((f) => <div key={f.key}><label className={LABEL} htmlFor={`${c.id}-${f.key}`}>{f.label}</label><input id={`${c.id}-${f.key}`} name={`c_${f.key}`} defaultValue={cfg[f.key] ?? ""} placeholder={f.placeholder} className={INPUT} /><p className="mt-1 text-xs text-slate-500">{f.help}</p></div>)}
                        {def.secretFields.map((f) => <div key={f.key}><label className={LABEL} htmlFor={`${c.id}-${f.key}`}>{f.label}</label><input id={`${c.id}-${f.key}`} name={`s_${f.key}`} type="password" autoComplete="off" placeholder={c.hasSecret ? "Saved — leave blank to keep" : f.placeholder} className={INPUT} /><p className="mt-1 text-xs text-slate-500">{f.help}</p></div>)}
                        <Button type="submit" size="sm" variant="secondary">Save changes</Button>
                      </form>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {ctx.canConfigure ? (
        <section className="mt-8" aria-labelledby="add">
          <h2 id="add" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Add a connector</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {availableConnectors().map((def) => (
              <details key={def.type} className={CARD}>
                <summary className="cursor-pointer"><span className="text-sm font-semibold text-slate-900">{def.name}</span><span className="mt-1 block text-sm text-slate-600">{def.summary}</span></summary>
                <form action={addConnectorAction} className="mt-4 space-y-3">
                  {hidden}<input type="hidden" name="type" value={def.type} />
                  <div><label className={LABEL} htmlFor={`add-${def.type}-name`}>Name</label><input id={`add-${def.type}-name`} name="name" required placeholder={def.name} className={INPUT} /></div>
                  {def.configFields.map((f) => <div key={f.key}><label className={LABEL} htmlFor={`add-${def.type}-${f.key}`}>{f.label}{f.required ? " *" : ""}</label><input id={`add-${def.type}-${f.key}`} name={`c_${f.key}`} required={f.required} placeholder={f.placeholder} className={INPUT} /><p className="mt-1 text-xs text-slate-500">{f.help}</p></div>)}
                  {def.secretFields.map((f) => <div key={f.key}><label className={LABEL} htmlFor={`add-${def.type}-${f.key}`}>{f.label}{f.required ? " *" : ""}</label><input id={`add-${def.type}-${f.key}`} name={`s_${f.key}`} type="password" autoComplete="off" required={f.required} placeholder={f.placeholder} className={INPUT} /><p className="mt-1 text-xs text-slate-500">{f.help}</p></div>)}
                  <dl className="space-y-1 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                    <div><dt className="inline font-semibold">It reads: </dt><dd className="inline">{def.reads}</dd></div>
                    <div><dt className="inline font-semibold">We keep: </dt><dd className="inline">{def.keeps}</dd></div>
                    <div><dt className="inline font-semibold">Runs: </dt><dd className="inline">{def.runsWhere}</dd></div>
                  </dl>
                  <Button type="submit" size="sm">Add connector</Button>
                </form>
              </details>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">{CONNECTORS.filter((c) => c.status === "planned").length} more connectors are on the roadmap — see the <Link className="underline" href="/connectors">catalogue</Link>.</p>
        </section>
      ) : null}

      {observations.length ? (
        <section className={`${CARD} mt-8`} aria-labelledby="obs">
          <h2 id="obs" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Observations from website scans</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {[...observations].sort((a, b) => ["high", "medium", "low"].indexOf(String((a.attributes as { severity: string }).severity)) - ["high", "medium", "low"].indexOf(String((b.attributes as { severity: string }).severity))).map((o) => {
              const a = o.attributes as { severity: string; message: string };
              return <li key={o.id} className="flex gap-2"><Badge tone={a.severity === "high" ? "critical" : a.severity === "medium" ? "warning" : "neutral"}>{a.severity}</Badge><span>{a.message}</span></li>;
            })}
          </ul>
          <p className="mt-3 text-xs text-slate-500">These are automated checks of what a visitor&rsquo;s browser receives. They point to where a person should look; they are not legal conclusions.</p>
        </section>
      ) : null}

      <section className={`${CARD} mt-8`} aria-labelledby="found">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="found" className="text-sm font-semibold uppercase tracking-wide text-slate-500">What the scans found ({filter.length})</h2>
          <div className="flex gap-3 text-sm">
            <Link href="?" className={searchParams.asset !== "pii" ? "font-medium underline" : "text-slate-500"}>Everything</Link>
            <Link href="?asset=pii" className={searchParams.asset === "pii" ? "font-medium underline" : "text-slate-500"}>Only with personal data</Link>
          </div>
        </div>
        {filter.length === 0 ? <p className="mt-3 text-sm text-slate-500">Nothing yet. Add a connector and press “Scan now”.</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead><tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500"><th scope="col" className="py-2 pr-3">Item</th><th scope="col" className="py-2 pr-3">Where</th><th scope="col" className="py-2 pr-3">Personal data seen</th><th scope="col" className="py-2">Source</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filter.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 pr-3"><span className="text-xs text-slate-500">{a.assetType.replace(/_/g, " ")}</span><br />{a.name}</td>
                    <td className="max-w-xs break-all py-2 pr-3 text-slate-600">{a.location}</td>
                    <td className="py-2 pr-3">{a.piiCategories.length ? <span className="flex flex-wrap gap-1">{a.piiCategories.map((p) => <Badge key={p} tone={a.sensitivity === "sensitive" ? "critical" : "warning"}>{p.replace(/_/g, " ")}</Badge>)}</span> : <span className="text-slate-400">{a.sensitivity === "unclassified" ? "could not be read" : "none found"}</span>}</td>
                    <td className="py-2 text-slate-500">{nameOf.get(a.connectorId) ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.runs.length ? (
        <section className={`${CARD} mt-8`} aria-labelledby="runs">
          <h2 id="runs" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent runs</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {data.runs.map((r) => <li key={r.id}><span className="text-xs text-slate-400">{r.startedAt.toISOString().slice(0, 16).replace("T", " ")}</span> · {nameOf.get(r.connectorId) ?? "connector"} · {r.runType === "scan" ? "scan" : "test"} · <Badge tone={r.status === "succeeded" ? "positive" : r.status === "failed" ? "critical" : "neutral"}>{r.status}</Badge>{r.error ? <span className="ml-2 text-xs text-red-700">{r.error}</span> : null}</li>)}
          </ul>
        </section>
      ) : null}
    </AiShell>
  );
}
