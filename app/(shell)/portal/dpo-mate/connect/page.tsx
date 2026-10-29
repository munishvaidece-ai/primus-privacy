import Link from "next/link";
import { loadPortal } from "@/lib/workspace/page";
import { getSectorQuestions } from "@/lib/workspace/discovery";
import { NOTICE_VERSION, BANDS, TIMES, TOPICS, CONSENT_TEXT, noticeFor } from "@/lib/workspace/consultation-notice";
import { privacyContact } from "@/lib/notify/mailer";
import { SELECTABLE_SECTORS } from "@/lib/regulation";
import { PortalHeader } from "@/components/portal/header";
import { Button } from "@/components/ui/button";
import { CARD, Flash, INPUT, LABEL } from "@/components/ui/kit";
import { submitConsultationAction } from "../../../workspace-actions";

/** "Connect with us": a short form to book a 30 minute consultation, with the notice and consent on the same page. */
export default async function Connect({ searchParams }: { searchParams: { e?: string; sent?: string; error?: string } }) {
  const { portal, viewer, data } = await loadPortal(searchParams, async ({ db, user, current }) => ({ q: await getSectorQuestions(db, user.id, current.id) }));
  const m = portal.current;
  const q = portal.engagements.length > 1 ? `?e=${m.id}` : "";
  const notice = noticeFor(privacyContact());
  const sector = data.q.declared ?? data.q.setByPrimus[0] ?? "";

  if (searchParams.sent) {
    return (
      <div>
        <PortalHeader title="Thank you" subtitle="We have your request." engagements={portal.engagements} current={m} />
        <section className={`${CARD} max-w-2xl`} aria-live="polite">
          <h2 className="font-display text-xl font-semibold text-slate-900">Book a 30 minute consultation with our experts</h2>
          <p className="mt-2 text-sm text-slate-700">Someone from Primus will call or write to the contact person within one working day to fix a time that suits you. Until then there is nothing more you need to do.</p>
          <p className="mt-2 text-sm text-slate-600">If you need to change or withdraw your request, {privacyContact() ? `write to ${privacyContact()}` : "tell your Primus contact"} and we will act on it.</p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm"><Link href={`/portal/dpo-mate${q}`} className="font-medium text-brand-700 hover:underline">Back to DPO Mate →</Link><Link href={`/portal${q}`} className="font-medium text-brand-700 hover:underline">Back to your overview →</Link></div>
        </section>
      </div>
    );
  }

  return (
    <div>
      <PortalHeader title="Connect with us" subtitle="Book a 30 minute consultation with our experts. Tell us a little about your organisation and who we should speak to. It takes about two minutes." engagements={portal.engagements} current={m} />
      <Flash error={searchParams.error} />
      <form action={submitConsultationAction} className="grid max-w-4xl gap-6">
        <input type="hidden" name="engagementId" value={m.id} />
        <input type="hidden" name="back" value={`/portal/dpo-mate/connect${q}`} />

        <fieldset className={CARD}>
          <legend className="px-1 font-display text-base font-semibold text-slate-900">About your organisation</legend>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className={LABEL}>Organisation name <span className="text-red-700">*</span><input name="organisationName" required maxLength={200} defaultValue={m.organisationName} className={INPUT} /></label>
            <label className={LABEL}>Your sector
              <select name="sectorKey" defaultValue={sector} className={INPUT}><option value="">Choose…</option>{SELECTABLE_SECTORS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            </label>
            <label className={LABEL}>Number of employees (optional)
              <select name="employeeBand" defaultValue="" className={INPUT}><option value="">Prefer not to say</option>{BANDS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</select>
            </label>
            <label className={LABEL}>Website (optional)<input name="website" maxLength={200} placeholder="www.example.com" className={INPUT} /></label>
          </div>
        </fieldset>

        <fieldset className={CARD}>
          <legend className="px-1 font-display text-base font-semibold text-slate-900">Who should we speak to?</legend>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className={LABEL}>Contact person&rsquo;s name <span className="text-red-700">*</span><input name="contactName" required maxLength={120} defaultValue={viewer.displayName ?? ""} autoComplete="name" className={INPUT} /></label>
            <label className={LABEL}>Designation <span className="text-red-700">*</span><input name="contactDesignation" required maxLength={120} placeholder="for example Head of Compliance" className={INPUT} /></label>
            <label className={LABEL}>Work email <span className="text-red-700">*</span><input name="contactEmail" type="email" required maxLength={254} defaultValue={viewer.email ?? ""} autoComplete="email" className={INPUT} /></label>
            <label className={LABEL}>Mobile number <span className="text-red-700">*</span><input name="contactMobile" type="tel" required inputMode="tel" maxLength={20} placeholder="+91 98XXXXXXXX" autoComplete="tel" className={INPUT} /></label>
          </div>
          <fieldset className="mt-4"><legend className={LABEL}>Who is filling in this form? <span className="text-red-700">*</span></legend>
            <div className="mt-1 space-y-1 text-sm">
              <label className="flex items-start gap-2"><input type="radio" name="submitterIsContact" value="yes" required className="mt-1" /> I am the contact person</label>
              <label className="flex items-start gap-2"><input type="radio" name="submitterIsContact" value="no" required className="mt-1" /> I am filling this in for a colleague, who has agreed to be contacted</label>
            </div>
          </fieldset>
        </fieldset>

        <fieldset className={CARD}>
          <legend className="px-1 font-display text-base font-semibold text-slate-900">What would you like to talk about?</legend>
          <div className="mt-3 grid gap-1 text-sm sm:grid-cols-2">{TOPICS.map((t) => <label key={t.value} className="flex items-center gap-2"><input type="checkbox" name="topics" value={t.value} /> {t.label}</label>)}</div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className={LABEL}>Best time to call
              <select name="preferredTime" defaultValue="" className={INPUT}><option value="">No preference</option>{TIMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
            </label>
            <label className={`${LABEL} sm:col-span-2`}>Anything else we should know? (optional)<textarea name="note" rows={3} maxLength={600} className={INPUT} /></label>
          </div>
        </fieldset>

        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5" aria-labelledby="notice-h">
          <h2 id="notice-h" className="font-display text-base font-semibold text-slate-900">{notice.heading}</h2>
          <p className="mt-0.5 text-xs text-slate-500">Notice version {NOTICE_VERSION}</p>
          <dl className="mt-3 space-y-3 text-sm text-slate-800">
            <div><dt className="font-semibold">What we collect</dt><dd><ul className="mt-1 list-disc space-y-0.5 pl-5">{notice.collected.map((c) => <li key={c}>{c}</li>)}</ul></dd></div>
            <div><dt className="font-semibold">Why we collect it</dt><dd>{notice.purpose}</dd></div>
            <div><dt className="font-semibold">Who sees it</dt><dd>{notice.sharing}</dd></div>
            <div><dt className="font-semibold">How long we keep it</dt><dd>{notice.retention}</dd></div>
            <div><dt className="font-semibold">Your rights</dt><dd>{notice.rights}</dd></div>
            <div><dt className="font-semibold">Taking back your agreement</dt><dd>{notice.withdraw}</dd></div>
            <div><dt className="font-semibold">If you are not happy</dt><dd>{notice.complaint}</dd></div>
          </dl>
          <label className="mt-4 flex items-start gap-3 rounded-lg bg-white p-3 text-sm text-slate-900 ring-1 ring-inset ring-amber-200">
            <input type="checkbox" name="consent" value="yes" required className="mt-1" />
            <span>{CONSENT_TEXT}</span>
          </label>
        </section>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit">Book my 30 minute consultation</Button>
          <Link href={`/portal/dpo-mate${q}`} className="text-sm text-slate-600 underline">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
