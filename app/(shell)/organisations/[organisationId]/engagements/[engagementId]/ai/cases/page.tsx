import Link from "next/link";
import { loadAiContext } from "../load";
import { AiShell, CARD, Flash, INPUT, LABEL, aiBase } from "@/components/ai/shell";
import { Badge, riskRatingTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getQueueCounts } from "@/lib/ai/suggestions";
import { CASE_LABELS, listCases, listDataMapChoices, type CaseType } from "@/lib/ai/cases";
import { isDemoAuthActive } from "@/lib/auth/demo-auth";
import { createCaseAction, createSampleBreachAction } from "./actions";

const DATA_CATS = [["contact", "Contact details"], ["identity", "ID numbers (Aadhaar, PAN…)"], ["financial", "Financial / payment"], ["health", "Health"], ["credentials", "Passwords / credentials"], ["children", "Children's data"], ["other", "Other"]];

function Due({ due, status }: { due: Date | null; status: string }) {
  if (!due) return <span className="text-slate-400">—</span>;
  const days = Math.ceil((due.getTime() - Date.now()) / 86400_000);
  const late = days < 0 && status !== "closed";
  return <span className={late ? "font-medium text-red-700" : "text-slate-700"}>{due.toISOString().slice(0, 10)}{status !== "closed" ? (late ? ` (${-days} day(s) overdue)` : days <= 7 ? ` (${days} day(s) left)` : "") : ""}</span>;
}

export default async function CasesPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const { ctx, data } = await loadAiContext(params, async (db, c) => ({
    cases: await listCases(db, c.userId, params),
    counts: await getQueueCounts(db, params.engagementId),
    map: await listDataMapChoices(db, params.organisationId),
  }));
  const base = aiBase(params.organisationId, params.engagementId);
  const hidden = (t: CaseType) => (
    <>
      <input type="hidden" name="organisationId" value={params.organisationId} />
      <input type="hidden" name="engagementId" value={params.engagementId} />
      <input type="hidden" name="type" value={t} />
    </>
  );
  const Check = ({ name, label }: { name: string; label: string }) => <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name={name} /> {label}</label>;
  const Title = ({ id, ph }: { id: string; ph: string }) => <div><label className={LABEL} htmlFor={id}>Short title *</label><input id={id} name="title" required placeholder={ph} className={INPUT} /></div>;

  return (
    <AiShell {...ctx} active="/cases" badge={{ queue: data.counts.pending }}>
      <Flash saved={searchParams.saved} error={searchParams.error} />
      <p className="max-w-3xl text-sm text-slate-600">
        The day-to-day work after the assessment: people&rsquo;s rights requests, personal data breaches, consent reviews and vendor reviews. Open a case and the AI works out the deadline, assesses it and drafts the reply or notice; a person approves what goes out. Deadlines follow the DPDP Rules 2025 (rights requests: 90 days; breaches: detailed report to the Board within 72 hours). The breach and rights duties are enforceable from 13 May 2027, and the register works the same way before and after. Have your practice confirm the dates against the Gazette.
      </p>

      {isDemoAuthActive() ? (
        <form action={createSampleBreachAction} className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
          {hidden("breach")}
          <Button type="submit" size="sm" variant="secondary">Open a sample incident</Button>
          <span className="text-sm text-slate-600">Demo only: a client list emailed to the wrong address, so you can show the breach flow without typing it in.</span>
        </form>
      ) : null}

      <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label="Open a case">
        <details className={CARD}>
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Rights request <span className="font-normal text-slate-500">— access, correction, erasure, grievance…</span></summary>
          <form action={createCaseAction} className="mt-4 space-y-3">{hidden("rights_request")}
            <Title id="rr-title" ph="Access request from a customer" />
            <div><label className={LABEL} htmlFor="rr-type">Kind of request</label><select id="rr-type" name="requestType" className={INPUT}><option value="access">Access to their data</option><option value="correction">Correction</option><option value="erasure">Erasure</option><option value="grievance">Grievance</option><option value="nomination">Nomination</option><option value="withdraw_consent">Withdraw consent</option></select></div>
            <Check name="identityVerified" label="The requester's identity has been verified" />
            <Check name="retentionObligation" label="A legal duty requires us to keep some of this data" />
            <div><label className={LABEL} htmlFor="rr-notes">Notes</label><textarea id="rr-notes" name="notes" rows={3} className={INPUT} /></div>
            <Button type="submit" size="sm">Open case</Button>
          </form>
        </details>

        <details className={CARD}>
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Personal data breach <span className="font-normal text-slate-500">— starts the 72-hour clock</span></summary>
          <form action={createCaseAction} className="mt-4 space-y-3">{hidden("breach")}
            <Title id="br-title" ph="Customer file emailed to wrong person" />
            <div><label className={LABEL} htmlFor="br-when">When was it discovered? *</label><input id="br-when" name="discoveredAt" type="datetime-local" required className={INPUT} /></div>
            <fieldset><legend className={LABEL}>What kinds of data?</legend><div className="mt-1 grid grid-cols-2 gap-1">{DATA_CATS.map(([v, l]) => <label key={v} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="categories" value={v} /> {l}</label>)}</div></fieldset>
            <div><label className={LABEL} htmlFor="br-n">Roughly how many people? (blank if unknown)</label><input id="br-n" name="principalsAffected" type="number" min={0} className={INPUT} /></div>
            {data.map.systems.length ? <fieldset><legend className={LABEL}>Which systems were affected? (from your data map)</legend><div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">{data.map.systems.map((n) => <label key={n} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="affectedSystems" value={n} /> {n}</label>)}</div></fieldset> : null}
            {data.map.vendors.length ? <fieldset><legend className={LABEL}>Which vendors were involved?</legend><div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">{data.map.vendors.map((n) => <label key={n} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="affectedVendors" value={n} /> {n}</label>)}</div></fieldset> : null}
            <Check name="encrypted" label="The data was encrypted" />
            <Check name="contained" label="The breach has been contained" />
            <div><label className={LABEL} htmlFor="br-d">What happened?</label><textarea id="br-d" name="description" rows={3} className={INPUT} /></div>
            <Button type="submit" size="sm">Open case</Button>
          </form>
        </details>

        <details className={CARD}>
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Consent review <span className="font-normal text-slate-500">— check a consent notice or form</span></summary>
          <form action={createCaseAction} className="mt-4 space-y-3">{hidden("consent_review")}
            <Title id="cr-title" ph="Newsletter sign-up form" />
            <div><label className={LABEL} htmlFor="cr-text">Paste the consent wording</label><textarea id="cr-text" name="consentText" rows={4} className={INPUT} /></div>
            <div><label className={LABEL} htmlFor="cr-lang">Languages offered (comma-separated)</label><input id="cr-lang" name="languages" placeholder="English, Hindi" className={INPUT} /></div>
            <Check name="preTicked" label="The consent box is pre-ticked" />
            <Check name="bundled" label="Consent is bundled with other terms" />
            <div><label className={LABEL} htmlFor="cr-w">Is withdrawing as easy as giving consent?</label><select id="cr-w" name="withdrawalAsEasy" className={INPUT}><option value="unknown">Don&rsquo;t know</option><option value="yes">Yes</option><option value="no">No</option></select></div>
            <Button type="submit" size="sm">Open case</Button>
          </form>
        </details>

        <details className={CARD}>
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Vendor review <span className="font-normal text-slate-500">— a processor handling personal data</span></summary>
          <form action={createCaseAction} className="mt-4 space-y-3">{hidden("vendor_review")}
            <Title id="vr-title" ph="Payroll provider review" />
            <div><label className={LABEL} htmlFor="vr-name">Vendor name *</label><input id="vr-name" name="vendorName" required className={INPUT} /></div>
            <div><label className={LABEL} htmlFor="vr-svc">What do they do for us?</label><input id="vr-svc" name="services" className={INPUT} /></div>
            <fieldset><legend className={LABEL}>Data they handle</legend><div className="mt-1 grid grid-cols-2 gap-1">{DATA_CATS.map(([v, l]) => <label key={v} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="dataCategories" value={v} /> {l}</label>)}</div></fieldset>
            <Check name="hasDpa" label="A data processing agreement is signed" />
            <Check name="crossBorder" label="Data goes outside India" />
            <Check name="encryptionAtRest" label="Data is encrypted at rest" />
            <Check name="deletionOnExit" label="Data is deleted when the contract ends" />
            <Check name="auditRights" label="We have the right to audit them" />
            <Check name="subprocessorsDisclosed" label="Their sub-processors are disclosed" />
            <div><label className={LABEL} htmlFor="vr-h">They must tell us about a breach within (hours, blank if not agreed)</label><input id="vr-h" name="breachNotificationHours" type="number" min={0} className={INPUT} /></div>
            <div><label className={LABEL} htmlFor="vr-c">Certifications (comma-separated)</label><input id="vr-c" name="certifications" placeholder="ISO 27001, SOC 2" className={INPUT} /></div>
            <Button type="submit" size="sm">Open case</Button>
          </form>
        </details>
      </section>

      <section className="mt-8" aria-labelledby="all">
        <h2 id="all" className="text-sm font-semibold uppercase tracking-wide text-slate-500">All cases</h2>
        {data.cases.length === 0 ? <div className="mt-3 rounded-md border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500">No cases yet.</div> : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead><tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500"><th scope="col" className="px-3 py-2">Case</th><th scope="col" className="px-3 py-2">Type</th><th scope="col" className="px-3 py-2">Status</th><th scope="col" className="px-3 py-2">Severity</th><th scope="col" className="px-3 py-2">Due</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.cases.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2"><Link className="font-medium text-slate-900 underline" href={`${base}/cases/${c.id}`}>{c.reference}</Link><br /><span className="text-slate-600">{c.title}</span></td>
                    <td className="px-3 py-2">{CASE_LABELS[c.caseType as CaseType]}</td>
                    <td className="px-3 py-2"><Badge tone={c.status === "closed" ? "positive" : c.status === "new" ? "warning" : "neutral"}>{c.status.replace(/_/g, " ")}</Badge>{c.responseApprovedAt ? <Badge tone="positive" className="ml-1">approved</Badge> : null}</td>
                    <td className="px-3 py-2">{c.severity ? <Badge tone={riskRatingTone(c.severity)}>{c.severity}</Badge> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2"><Due due={c.dueAt} status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AiShell>
  );
}
