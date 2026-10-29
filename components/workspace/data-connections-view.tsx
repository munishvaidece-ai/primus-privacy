import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD, INPUT, LABEL, TD, TH, fmtDateTime } from "@/components/ui/kit";
import { DOCUMENT_STEPS, OTHER_SYSTEM, PLANNED_NAMES, REQUESTABLE, WHAT_WE_NEED } from "@/lib/workspace/data-connections";
import { requestConnectionAction } from "@/app/(shell)/workspace-actions";

export interface ConnectorRow { id: string; name: string; connectorType: string; status: string; lastTestOk: boolean | null; lastTestMessage: string | null; lastRunAt: Date | null }

interface Props {
  audience: "client" | "primus";
  engagement: { id: string; organisationId: string; name: string };
  /** Page to come back to after a form, with the chosen engagement kept. */
  backPath: string;
  /** Where the client's journey and evidence pages are, with the chosen engagement kept. */
  journeyHref: string;
  clarificationsHref: string;
  canRequest: boolean;
  /** Primus only: the connectors already set up for this engagement. */
  connectors?: ConnectorRow[];
  /** Primus only: where connectors are set up. */
  connectorsHref?: string;
}

/** One page that answers "where do I upload documents, and how do you connect to our systems?" for both sides. */
export function DataConnectionsView(p: Props) {
  const client = p.audience === "client";
  const tpl = (n: number) => `/organisations/${p.engagement.organisationId}/engagements/${p.engagement.id}/live/template?phase=${n}&kind=blank`;
  return (
    <div className="space-y-10">
      <section aria-labelledby="dc-how" className={CARD}>
        <h2 id="dc-how" className="text-base font-semibold text-slate-900">Two ways to give Primus what it needs</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-900">1. Upload documents <Badge tone="positive">Always available</Badge></p>
            <p className="mt-1 text-sm text-slate-600">{client ? "You fill in a short Excel template and upload it, with the supporting files. This works for every client, whatever systems you run." : "The client fills in a short Excel template and uploads it with supporting files. It works for every client and is the default."}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-900">2. Connect a system <Badge tone="neutral">Optional</Badge></p>
            <p className="mt-1 text-sm text-slate-600">{client ? "If you agree, Primus looks at a database, a folder or your website directly, to check what you wrote against what is really there. You decide which systems, and you can say stop at any time." : "With the client's agreement, a connector reads a database, folder or website directly, to check the inventory against the real systems. The client chooses what to connect."}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="dc-docs">
        <h2 id="dc-docs" className="text-base font-semibold text-slate-900">1. Upload your documents</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          {client ? "Four steps of your engagement need a file from you. Each one has a template to download. You upload the filled template, and any supporting files, on the Live journey page. Proof for an individual assessment answer goes in the Evidence centre." : "Four steps need a file from the client. The client downloads the template and uploads it on the Live journey page. Proof for an individual assessment answer goes in the Evidence centre."}
        </p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50"><tr><th scope="col" className={TH}>Step</th><th scope="col" className={TH}>What is sent</th><th scope="col" className={TH}>Supporting files</th><th scope="col" className={TH}>Template</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {DOCUMENT_STEPS.map((d) => (
                <tr key={d.phase}>
                  <td className={`${TD} whitespace-nowrap font-medium text-slate-900`}>{d.phase}. {d.name}</td>
                  <td className={`${TD} text-slate-700`}>{d.send}</td>
                  <td className={`${TD} text-slate-600`}>{d.extra ?? "None"}</td>
                  <td className={TD}>{d.hasTemplate ? <a href={tpl(d.phase)} className="font-medium text-slate-900 underline">Download (.xlsx)</a> : <span className="text-slate-500">No template</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link href={p.journeyHref} className="inline-flex h-9 items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">Open the Live journey to upload</Link>
        </div>
        <p className="mt-2 text-xs text-slate-500">Accepted files: Excel, Word, PDF, text and images. {client ? "Your files are kept in your engagement only, and Primus staff on other engagements cannot see them." : "Files stay inside the engagement they were uploaded to."}</p>
      </section>

      <section aria-labelledby="dc-conn">
        <h2 id="dc-conn" className="text-base font-semibold text-slate-900">2. Connect a system (optional)</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          {client ? "Connections are read-only and keep only metadata: table and column names, file names and the kinds of personal data found, with counts. Primus never keeps a copy of your data. Here is what is available today and what you prepare for each." : "Connections are read-only and keep metadata only: names, locations and the kinds of personal data found, with counts. Here is what is available today and what the client prepares for each."}
        </p>
        <ul className="mt-3 grid gap-4 md:grid-cols-3">
          {REQUESTABLE.map((c) => (
            <li key={c.type} className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
              <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-semibold text-slate-900">{c.name}</h3><Badge tone="positive">Available</Badge></div>
              <p className="mt-2 text-sm text-slate-700">{c.summary}</p>
              <dl className="mt-3 space-y-1 text-xs text-slate-600">
                <div><dt className="inline font-semibold">It reads: </dt><dd className="inline">{c.reads}</dd></div>
                <div><dt className="inline font-semibold">We keep: </dt><dd className="inline">{c.keeps}</dd></div>
                <div><dt className="inline font-semibold">Runs: </dt><dd className="inline">{c.runsWhere}</dd></div>
              </dl>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{client ? "What you prepare" : "What the client prepares"}</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-700">{(WHAT_WE_NEED[c.type] ?? []).map((w) => <li key={w}>{w}</li>)}</ul>
            </li>
          ))}
        </ul>

        <ol className="mt-5 max-w-3xl list-decimal space-y-1 pl-5 text-sm text-slate-700" aria-label="How a connection happens">
          <li>{client ? "You tell Primus which system you would like to connect, using the form below." : "The client tells Primus which system to connect, using the form on their page."}</li>
          <li>{client ? "Primus replies under Clarifications and agrees with you how to share access safely. Please do not send passwords by email or chat." : "Reply under Clarifications and agree a safe way to receive access. Never ask for passwords by email or chat."}</li>
          <li>{client ? "Primus sets up the connection with your read-only account. The password is stored encrypted and is never shown again." : "Set the connection up under Connectors, with the client's read-only account. The password is stored encrypted and is never shown again."}</li>
          <li>{client ? "Primus runs a test, then a scan. The result is compared with what you wrote in your Data Inventory." : "Run a test, then a scan. The result is compared with what the client wrote in the Data Inventory."}</li>
          <li>{client ? "You can switch a connection off at any time by telling Primus. Every setup, test and scan is logged." : "The client can ask to switch a connection off at any time. Every setup, test and scan is logged."}</li>
        </ol>

        {client ? (
          p.canRequest ? (
            <form action={requestConnectionAction} className={`${CARD} mt-5 grid gap-3 md:grid-cols-2`} aria-labelledby="dc-form">
              <h3 id="dc-form" className="text-sm font-semibold text-slate-900 md:col-span-2">Ask Primus to connect a system</h3>
              <input type="hidden" name="engagementId" value={p.engagement.id} />
              <input type="hidden" name="back" value={p.backPath} />
              <label className={LABEL}>Kind of system
                <select name="type" required defaultValue={REQUESTABLE[0]?.type} className={INPUT}>
                  {REQUESTABLE.map((c) => <option key={c.type} value={c.type}>{c.name}</option>)}
                  <option value={OTHER_SYSTEM}>Another kind of system (not built yet)</option>
                </select>
              </label>
              <label className={LABEL}>Name of the system<input name="systemName" required minLength={2} maxLength={120} placeholder="for example: Customer CRM database" className={INPUT} /></label>
              <label className={LABEL}>Where it runs<input name="hostedWhere" maxLength={160} placeholder="for example: our data centre in Pune, or AWS Mumbai" className={INPUT} /></label>
              <label className={LABEL}>Person who looks after it<input name="contactName" required minLength={2} maxLength={120} placeholder="name and role" className={INPUT} /></label>
              <label className={`${LABEL} md:col-span-2`}>Anything Primus should know<textarea name="notes" rows={3} maxLength={1500} className={INPUT} placeholder="for example: it holds customer KYC; our IT team needs two weeks' notice" /></label>
              <p className="text-xs text-slate-500 md:col-span-2">This sends a message to Primus. Do not type a password or connection string here.</p>
              <div className="md:col-span-2"><Button type="submit">Send to Primus</Button></div>
            </form>
          ) : <p className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">Your role can read this page but not ask for a connection. Ask a colleague with contributor access.</p>
        ) : (
          <div className={`${CARD} mt-5`}>
            <h3 className="text-sm font-semibold text-slate-900">Connections for {p.engagement.name}</h3>
            {p.connectors && p.connectors.length > 0 ? (
              <div className="mt-3 overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50"><tr><th scope="col" className={TH}>Name</th><th scope="col" className={TH}>Kind</th><th scope="col" className={TH}>Status</th><th scope="col" className={TH}>Last test</th><th scope="col" className={TH}>Last scan</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{p.connectors.map((c) => (
                  <tr key={c.id}><td className={TD}>{c.name}</td><td className={TD}>{REQUESTABLE.find((r) => r.type === c.connectorType)?.name ?? c.connectorType}</td><td className={TD}><Badge tone={c.status === "disabled" ? "neutral" : "positive"}>{c.status}</Badge></td><td className={TD}>{c.lastTestOk === null ? "Not tested" : c.lastTestOk ? "Passed" : `Failed: ${c.lastTestMessage ?? ""}`}</td><td className={TD}>{c.lastRunAt ? fmtDateTime(c.lastRunAt) : "Not run"}</td></tr>
                ))}</tbody>
              </table></div>
            ) : <p className="mt-2 text-sm text-slate-600">No connections set up for this engagement yet.</p>}
            <div className="mt-4 flex flex-wrap gap-3">
              {p.connectorsHref ? <Link href={p.connectorsHref} className="inline-flex h-9 items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">Set up or manage connections</Link> : null}
              <Link href={p.clarificationsHref} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 hover:border-slate-400">Connection requests from the client (Clarifications)</Link>
              <Link href="/connectors" className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 hover:border-slate-400">Full connector catalogue</Link>
            </div>
          </div>
        )}

        <details className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Not available yet ({PLANNED_NAMES.length} systems on the roadmap)</summary>
          <p className="mt-2 text-sm text-slate-600">These are listed so you can see what is planned. They cannot be connected today. If you use one, upload the document or export instead, or tell us under “Another kind of system”.</p>
          <p className="mt-2 text-xs text-slate-600">{PLANNED_NAMES.join(" · ")}</p>
        </details>
      </section>
    </div>
  );
}
