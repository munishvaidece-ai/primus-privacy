import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Check, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm, type Resolver } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { AI_STAGES, ASSESSMENT_PERIODS, FOOTPRINTS, FUNCTIONS, ORG_TYPES, REGULATORY_CONTEXT, REVENUE_BANDS, SECTORS, SIZE_CATEGORIES, WORKFORCE_BANDS } from '../data/options';
import { Button, Callout, Card, ChipToggle, NumberField, PageHeader, SelectField, TextArea, TextField, useDocumentTitle, useToast } from '../components/ui';
import { SAMPLE_PROFILES } from '../store/seed/profiles';
import { useStore } from '../store/store';
import { blankProfile } from '../domain/factory';
import type { Profile } from '../domain/schema';
import { formatInr } from '../scoring/indicators';

const nonNegative = z.number().min(0, 'Cannot be negative').finite().nullable();

const formSchema = z
  .object({
    assessmentName: z.string().trim().min(2, 'Give the assessment a name'),
    organizationName: z.string().trim().min(2, 'Enter the organization name'),
    industry: z.string().min(1, 'Select an industry or sector'),
    subSector: z.string(),
    orgType: z.string().min(1, 'Select an organization type'),
    orgTypeOther: z.string(),
    sizeCategory: z.string().min(1, 'Select an organization size'),
    workforceBand: z.string().min(1, 'Select a workforce band'),
    employeeCount: z.number().int('Whole number of employees').min(0, 'Cannot be negative').nullable(),
    revenueBand: z.string().min(1, 'Select a revenue or budget band'),
    headquarters: z.string().trim().min(1, 'Enter the headquarters or primary location'),
    footprint: z.string().min(1, 'Select an operating footprint'),
    footprintNotes: z.string(),
    itExpenditureLakh: nonNegative,
    aiExpenditureLakh: nonNegative,
    aiStage: z.string().min(1, 'Select the current AI stage'),
    periodLabel: z.string().min(1, 'Select an assessment period'),
    periodStart: z.string().min(1, 'Start date required'),
    periodEnd: z.string().min(1, 'End date required'),
    assessmentOwner: z.string().trim().min(1, 'Enter the assessment owner'),
    ownerRole: z.string(),
    team: z.array(z.object({ name: z.string(), role: z.string() })),
    participatingFunctions: z.array(z.string()).min(1, 'Select at least one participating function'),
    regulatoryContext: z.array(z.string()),
    regulatoryNotes: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.orgType === 'other' && !v.orgTypeOther.trim()) ctx.addIssue({ code: 'custom', path: ['orgTypeOther'], message: 'Describe the organization type' });
    if (v.periodStart && v.periodEnd && v.periodEnd < v.periodStart) ctx.addIssue({ code: 'custom', path: ['periodEnd'], message: 'End date must not be before the start date' });
  });
type FormValues = z.infer<typeof formSchema>;

const STEPS: { title: string; fields: (keyof FormValues)[] }[] = [
  { title: 'Organization', fields: ['organizationName', 'industry', 'orgType', 'orgTypeOther'] },
  { title: 'Size & finances', fields: ['sizeCategory', 'workforceBand', 'employeeCount', 'revenueBand', 'itExpenditureLakh', 'aiExpenditureLakh', 'aiStage'] },
  { title: 'Footprint & context', fields: ['headquarters', 'footprint', 'regulatoryContext'] },
  { title: 'Assessment setup', fields: ['assessmentName', 'periodLabel', 'periodStart', 'periodEnd', 'assessmentOwner', 'participatingFunctions'] },
  { title: 'Review', fields: [] },
];

const PERIOD_DATES: Record<string, [string, string]> = {
  'FY2024-25': ['2024-04-01', '2025-03-31'],
  'FY2025-26': ['2025-04-01', '2026-03-31'],
  'FY2026-27': ['2026-04-01', '2027-03-31'],
};

function toForm(p: Profile, name: string): FormValues {
  return { ...p, assessmentName: name } as FormValues;
}

export default function Wizard() {
  useDocumentTitle('New assessment');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const st = useStore.getState;
  const resumeId = params.get('id');
  const existing = useStore((s) => (resumeId ? s.assessments[resumeId] : undefined));
  const [step, setStep] = useState(existing?.wizardStep ?? 0);
  const idRef = useRef<string | null>(existing?.id ?? null);
  const [maxStep, setMaxStep] = useState(existing?.wizardStep ?? 0);

  const defaults = useMemo(() => toForm(existing?.profile ?? blankProfile(), existing?.name ?? ''), [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const form = useForm<FormValues>({ defaultValues: defaults, resolver: zodResolver(formSchema) as Resolver<FormValues>, mode: 'onTouched' });
  const { register, control, handleSubmit, trigger, getValues, reset, watch, setValue, formState: { errors } } = form;
  const team = useFieldArray({ control, name: 'team' });
  const orgType = watch('orgType');
  const periodLabel = watch('periodLabel');
  const it = watch('itExpenditureLakh');
  const ai = watch('aiExpenditureLakh');

  useEffect(() => { if (existing) { setStep(existing.wizardStep); setMaxStep(existing.wizardStep); } }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Persist whatever is entered so far (drafts are intentionally lenient). */
  const persist = (nextStep: number): string => {
    const v = getValues();
    const { assessmentName, ...profile } = v;
    const name = assessmentName.trim() || (profile.organizationName ? `${profile.organizationName} — AI maturity assessment` : 'Untitled draft');
    if (!idRef.current) {
      idRef.current = st().createDraft(profile as Partial<Profile>, name);
      st().updateDraft(idRef.current, { wizardStep: nextStep });
    } else {
      st().updateDraft(idRef.current, { profile: profile as Partial<Profile>, name, wizardStep: nextStep });
    }
    return idRef.current;
  };

  const saveDraft = () => { persist(step); toast('Draft saved — resume it any time from Assessments'); };

  const next = async () => {
    const ok = await trigger(STEPS[step].fields as never);
    if (!ok) return;
    const n = Math.min(step + 1, STEPS.length - 1);
    if (n === 3 && !getValues('assessmentName').trim()) setValue('assessmentName', `${getValues('organizationName').trim()} — AI maturity assessment`);
    persist(n);
    setStep(n);
    setMaxStep((m) => Math.max(m, n));
  };
  const back = () => { const n = Math.max(0, step - 1); persist(n); setStep(n); };

  const create = handleSubmit(
    () => {
      const id = persist(STEPS.length - 1);
      st().completeWizard(id);
      st().selectAssessment(id);
      toast('Assessment created');
      navigate('/questionnaire');
    },
    (errs) => {
      const first = STEPS.findIndex((s) => s.fields.some((f) => errs[f]));
      if (first >= 0) setStep(first);
      toast('Some required fields need attention', 'bad');
    },
  );

  const applySample = (id: string) => {
    const s = SAMPLE_PROFILES.find((x) => x.id === id);
    if (!s) return;
    const cur = getValues();
    reset({ ...cur, ...toForm({ ...blankProfile(), ...s.profile } as Profile, cur.assessmentName), team: cur.team });
    toast(`Loaded ${s.label}. Edit any field before continuing.`, 'info');
  };

  useEffect(() => {
    if (periodLabel && PERIOD_DATES[periodLabel]) {
      setValue('periodStart', PERIOD_DATES[periodLabel][0], { shouldValidate: false });
      setValue('periodEnd', PERIOD_DATES[periodLabel][1], { shouldValidate: false });
    }
  }, [periodLabel, setValue]);

  const e = (k: keyof FormValues) => errors[k]?.message as string | undefined;
  const v = watch();

  return (
    <>
      <PageHeader
        title={existing ? 'Resume assessment setup' : 'New assessment'}
        description="Capture the organization profile that frames the assessment. Nothing sensitive or personal is required — team members can be entered by role."
      />
      <nav aria-label="Setup steps" className="mb-5">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button
                type="button" disabled={i > maxStep} onClick={() => { persist(i); setStep(i); }} aria-current={i === step ? 'step' : undefined}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${i === step ? 'border-teal-600 bg-teal-50 text-teal-800 font-medium' : i < step ? 'border-navy-200 bg-white text-ink' : 'border-line bg-white text-muted'} disabled:opacity-50`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${i < step ? 'bg-teal-600 text-white' : 'bg-navy-100'}`}>{i < step ? <Check className="h-3 w-3" aria-hidden /> : i + 1}</span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <form onSubmit={(ev) => ev.preventDefault()} noValidate>
        <Card className="max-w-4xl">
          {step === 0 && (
            <div className="space-y-4">
              <div className="rounded-lg bg-navy-50 p-3">
                <div className="text-sm font-medium">Start from a sample profile (fictional)</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SAMPLE_PROFILES.map((s) => <Button key={s.id} size="sm" onClick={() => applySample(s.id)} title={s.blurb}>{s.label}</Button>)}
                </div>
                <p className="hint">Sample profiles only pre-fill this form; they never create answers.</p>
              </div>
              <TextField label="Organization name" required {...register('organizationName')} error={e('organizationName')} autoComplete="off" />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label="Industry / sector" required placeholder="Select…" options={SECTORS.map((s) => ({ value: s, label: s }))} {...register('industry')} error={e('industry')} />
                <TextField label="Sub-sector (optional)" {...register('subSector')} />
              </div>
              <SelectField label="Organization type" required placeholder="Select…" options={ORG_TYPES} {...register('orgType')} error={e('orgType')} hint="Private enterprise, MSME, GCC, PSU, government institution or other." />
              {orgType === 'other' && <TextField label="Describe the organization type" required {...register('orgTypeOther')} error={e('orgTypeOther')} />}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label="Organization size" required placeholder="Select…" options={SIZE_CATEGORIES.map((s) => ({ value: s.value, label: `${s.label} — ${s.hint}` }))} {...register('sizeCategory')} error={e('sizeCategory')} hint="Used as a benchmark cohort dimension." />
                <SelectField label="Workforce band" required placeholder="Select…" options={WORKFORCE_BANDS.map((w) => ({ value: w, label: w }))} {...register('workforceBand')} error={e('workforceBand')} />
                <Controller control={control} name="employeeCount" render={({ field }) => <NumberField label="Employees (optional)" value={field.value} onChange={field.onChange} error={e('employeeCount')} hint="Pre-fills the denominators of per-employee indicators." />} />
                <SelectField label="Annual revenue / budget band" required placeholder="Select…" options={REVENUE_BANDS.map((r) => ({ value: r, label: r }))} {...register('revenueBand')} error={e('revenueBand')} hint="Choose “Not applicable” where revenue is not meaningful." />
                <Controller control={control} name="itExpenditureLakh" render={({ field }) => <NumberField label="Annual IT expenditure" unit="₹ lakh" value={field.value} onChange={field.onChange} error={e('itExpenditureLakh')} hint="1 crore = 100 lakh. Leave blank if not disclosed." />} />
                <Controller control={control} name="aiExpenditureLakh" render={({ field }) => <NumberField label="Annual AI expenditure" unit="₹ lakh" value={field.value} onChange={field.onChange} error={e('aiExpenditureLakh')} hint="Leave blank if not tracked — blank is not treated as zero." />} />
              </div>
              {it !== null && ai !== null && it !== undefined && ai !== undefined && ai > it && (
                <Callout tone="warn">AI expenditure ({formatInr(ai)}) is higher than IT expenditure ({formatInr(it)}). That is plausible if AI is funded outside IT — note this in the evidence — otherwise please recheck.</Callout>
              )}
              <SelectField label="Current AI investment and deployment stage" required placeholder="Select…" options={AI_STAGES} {...register('aiStage')} error={e('aiStage')} />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <TextField label="Headquarters / primary location" required {...register('headquarters')} error={e('headquarters')} placeholder="e.g. Pune, Maharashtra" />
              <SelectField label="Operating footprint" required placeholder="Select…" options={FOOTPRINTS} {...register('footprint')} error={e('footprint')} />
              <TextArea label="Footprint notes (optional)" {...register('footprintNotes')} hint="States, international presence, key facilities." />
              <Controller control={control} name="regulatoryContext" render={({ field }) => <ChipToggle label="Applicable regulatory and sectoral context" options={REGULATORY_CONTEXT} value={field.value} onChange={field.onChange} />} />
              <TextArea label="Regulatory notes (optional)" {...register('regulatoryNotes')} hint="Selection records context for the assessor; it is not a statement of what laws apply." />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <TextField label="Assessment name" required {...register('assessmentName')} error={e('assessmentName')} />
              <div className="grid gap-4 sm:grid-cols-3">
                <SelectField label="Assessment period" required placeholder="Select…" options={ASSESSMENT_PERIODS.map((p) => ({ value: p, label: p }))} {...register('periodLabel')} error={e('periodLabel')} />
                <TextField label="Period start" type="date" required {...register('periodStart')} error={e('periodStart')} />
                <TextField label="Period end" type="date" required {...register('periodEnd')} error={e('periodEnd')} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Assessment owner" required {...register('assessmentOwner')} error={e('assessmentOwner')} hint="A role or name at the assessed organization." />
                <TextField label="Owner role (optional)" {...register('ownerRole')} />
              </div>
              <fieldset>
                <legend className="label">Assessment team (optional)</legend>
                <p className="hint mb-2">Source guidance: avoid relying on a single respondent. Enter roles rather than personal details.</p>
                <div className="space-y-2">
                  {team.fields.map((f, i) => (
                    <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <input className="input" aria-label={`Team member ${i + 1} name or role`} placeholder="Name or title" {...register(`team.${i}.name` as const)} />
                      <input className="input" aria-label={`Team member ${i + 1} function`} placeholder="Function (e.g. CISO)" {...register(`team.${i}.role` as const)} />
                      <Button size="sm" onClick={() => team.remove(i)} aria-label={`Remove team member ${i + 1}`}>Remove</Button>
                    </div>
                  ))}
                </div>
                <Button size="sm" className="mt-2" onClick={() => team.append({ name: '', role: '' })}>Add team member</Button>
              </fieldset>
              <Controller control={control} name="participatingFunctions" render={({ field }) => <div><ChipToggle label="Participating functions (select all that apply)" options={FUNCTIONS} value={field.value} onChange={field.onChange} />{e('participatingFunctions') && <p role="alert" className="mt-1 text-xs text-bad">{e('participatingFunctions')}</p>}</div>} />
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Review and create</h2>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {[
                  ['Assessment name', v.assessmentName], ['Organization', v.organizationName], ['Industry', [v.industry, v.subSector].filter(Boolean).join(' — ')],
                  ['Type', ORG_TYPES.find((o) => o.value === v.orgType)?.label ?? v.orgType], ['Size', SIZE_CATEGORIES.find((o) => o.value === v.sizeCategory)?.label], ['Workforce', v.workforceBand],
                  ['Revenue / budget', v.revenueBand], ['IT expenditure', v.itExpenditureLakh === null ? 'Not provided' : formatInr(v.itExpenditureLakh)], ['AI expenditure', v.aiExpenditureLakh === null ? 'Not provided' : formatInr(v.aiExpenditureLakh)],
                  ['AI stage', AI_STAGES.find((o) => o.value === v.aiStage)?.label], ['Location', v.headquarters], ['Footprint', FOOTPRINTS.find((o) => o.value === v.footprint)?.label],
                  ['Period', `${v.periodLabel}: ${v.periodStart} → ${v.periodEnd}`], ['Owner', v.assessmentOwner], ['Functions', v.participatingFunctions.join(', ')], ['Regulatory context', v.regulatoryContext.join(', ') || '—'],
                ].map(([k, val]) => <div key={k as string}><dt className="text-muted">{k}</dt><dd className="font-medium">{(val as string) || '—'}</dd></div>)}
              </dl>
              <Callout tone="info">Creating the assessment opens the 100-question diagnostic. A blank assessment starts with no scores — nothing is pre-filled and the demonstration assessment is not touched.</Callout>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
            <div className="flex gap-2">
              <Button onClick={back} disabled={step === 0}><ArrowLeft className="h-4 w-4" aria-hidden /> Back</Button>
              <Button onClick={saveDraft}><Save className="h-4 w-4" aria-hidden /> Save draft</Button>
              <Link to="/assessments" className="btn btn-md btn-ghost" onClick={() => { if (idRef.current || getValues('organizationName')) persist(step); }}>Save & exit</Link>
            </div>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={next}>Next <ArrowRight className="h-4 w-4" aria-hidden /></Button>
            ) : (
              <Button variant="primary" onClick={create}><Check className="h-4 w-4" aria-hidden /> Create assessment</Button>
            )}
          </div>
        </Card>
      </form>
    </>
  );
}
