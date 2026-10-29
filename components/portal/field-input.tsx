import { INPUT, LABEL } from "@/components/ui/kit";
import type { Field } from "@/lib/workspace/discovery-sections";

/** One questionnaire field, as a form control. Shared by the discovery steps and the sector question sets. */
export function FieldInput({ f, value, disabled }: { f: Field; value: unknown; disabled: boolean }) {
  const name = `a_${f.key}`;
  const legend = <>{f.label}{f.required ? <span className="text-red-700"> *</span> : null}</>;
  if (f.type === "text") return <label className={LABEL}>{legend}<textarea name={name} rows={4} maxLength={4000} disabled={disabled} defaultValue={String(value ?? "")} className={INPUT} />{f.help ? <span className="mt-1 block font-normal text-slate-500">{f.help}</span> : null}</label>;
  if (f.type === "line") return <label className={LABEL}>{legend}<input name={name} maxLength={300} disabled={disabled} defaultValue={String(value ?? "")} className={INPUT} /></label>;
  if (f.type === "choice") return <label className={LABEL}>{legend}<select name={name} disabled={disabled} defaultValue={String(value ?? "")} className={INPUT}><option value="">Choose…</option>{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
  if (f.type === "yesno") {
    const cur = value === true ? "yes" : value === false ? "no" : "";
    return (
      <fieldset><legend className={LABEL}>{legend}</legend>
        <div className="mt-1 flex gap-4 text-sm">{[["yes", "Yes"], ["no", "No"]].map(([v, l]) => <label key={v} className="flex items-center gap-1.5"><input type="radio" name={name} value={v} disabled={disabled} defaultChecked={cur === v} /> {l}</label>)}</div>
      </fieldset>
    );
  }
  const sel = Array.isArray(value) ? (value as string[]) : [];
  return (
    <fieldset><legend className={LABEL}>{legend}</legend>
      <div className="mt-1 grid gap-1 text-sm md:grid-cols-2">{f.options!.map((o) => <label key={o.value} className="flex items-center gap-1.5"><input type="checkbox" name={name} value={o.value} disabled={disabled} defaultChecked={sel.includes(o.value)} /> {o.label}</label>)}</div>
    </fieldset>
  );
}
