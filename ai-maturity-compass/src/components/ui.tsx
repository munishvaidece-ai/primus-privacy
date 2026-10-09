/**
 * Small, dependency-free, accessible UI primitives.
 */
import clsx from 'clsx';
import {
  AlertTriangle, CheckCircle2, Info, OctagonAlert, X,
} from 'lucide-react';
import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';

// ---------------------------------------------------------------- Buttons
type BtnVariant = 'primary' | 'teal' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md';
}
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }, ref) {
  return <button ref={ref} type={type} className={clsx('btn', `btn-${size}`, `btn-${variant}`, className)} {...rest} />;
});

// ---------------------------------------------------------------- Badges
export type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'bad' | 'teal' | 'navy';
const TONES: Record<Tone, string> = {
  neutral: 'bg-navy-100 text-navy-800',
  info: 'bg-info-bg text-info',
  good: 'bg-good-bg text-good',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  teal: 'bg-teal-50 text-teal-700',
  navy: 'bg-navy-900 text-white',
};
export function Badge({ tone = 'neutral', children, className, title, icon }: { tone?: Tone; children: ReactNode; className?: string; title?: string; icon?: ReactNode }) {
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-5 whitespace-nowrap', TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Banners
const CALLOUT: Record<'info' | 'warn' | 'bad' | 'good', { cls: string; icon: ReactNode }> = {
  info: { cls: 'bg-info-bg border-blue-200 text-navy-900', icon: <Info className="h-4 w-4 text-info shrink-0 mt-0.5" aria-hidden /> },
  warn: { cls: 'bg-warn-bg border-amber-300 text-navy-900', icon: <AlertTriangle className="h-4 w-4 text-warn shrink-0 mt-0.5" aria-hidden /> },
  bad: { cls: 'bg-bad-bg border-red-300 text-navy-900', icon: <OctagonAlert className="h-4 w-4 text-bad shrink-0 mt-0.5" aria-hidden /> },
  good: { cls: 'bg-good-bg border-green-300 text-navy-900', icon: <CheckCircle2 className="h-4 w-4 text-good shrink-0 mt-0.5" aria-hidden /> },
};
export function Callout({ tone = 'info', title, children, className, action }: { tone?: 'info' | 'warn' | 'bad' | 'good'; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  const c = CALLOUT[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'note'} className={clsx('flex flex-wrap gap-x-2.5 gap-y-2 rounded-lg border px-3.5 py-2.5 text-sm', c.cls, className)}>
      {c.icon}
      <div className="min-w-[200px] flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={clsx(title && 'mt-0.5', 'text-[13.5px] leading-snug')}>{children}</div>}
      </div>
      {action && <div className="w-full sm:w-auto sm:shrink-0 pl-[26px] sm:pl-0">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Layout bits
export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={clsx('card', pad && 'card-pad', className)}>{children}</section>;
}

export function CardHeader({ title, subtitle, action, id }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-[13px] text-muted mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, meta }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] sm:text-2xl font-semibold text-ink">{title}</h1>
          {description && <p className="text-sm text-muted mt-1 max-w-3xl">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
      </div>
      {meta && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">{meta}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-4">
      {icon && <div className="mb-3 text-navy-400">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="text-sm text-muted mt-1 max-w-md">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, tone = 'teal', label, className, height = 'h-2' }: { value: number | null; tone?: 'teal' | 'blue' | 'orange' | 'good' | 'warn' | 'bad'; label?: string; className?: string; height?: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  const color = { teal: 'bg-teal-600', blue: 'bg-series-verified', orange: 'bg-series-self', good: 'bg-good', warn: 'bg-amber-500', bad: 'bg-bad' }[tone];
  return (
    <div
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(pct)}
      aria-label={label} aria-valuetext={value === null ? 'Not available' : `${Math.round(pct)}%`}
      className={clsx('w-full rounded-full bg-navy-100 overflow-hidden', height, className)}
    >
      <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- Form fields
interface FieldShell { label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; className?: string }

function Shell({ id, label, hint, error, required, className, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
        {required && <span className="text-bad ml-0.5" aria-hidden>*</span>}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="hint">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="text-xs text-bad mt-1">{error}</p>}
    </div>
  );
}

export const TextField = forwardRef<HTMLInputElement, FieldShell & InputHTMLAttributes<HTMLInputElement>>(function TextField({ label, hint, error, required, className, ...rest }, ref) {
  const id = useId();
  return (
    <Shell id={id} {...{ label, hint, error, required, className }}>
      <input ref={ref} id={id} className={clsx('input', error && 'border-bad')} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} required={required} {...rest} />
    </Shell>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ label, hint, error, required, className, rows = 3, ...rest }, ref) {
  const id = useId();
  return (
    <Shell id={id} {...{ label, hint, error, required, className }}>
      <textarea ref={ref} id={id} rows={rows} className={clsx('input resize-y', error && 'border-bad')} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} {...rest} />
    </Shell>
  );
});

export const SelectField = forwardRef<HTMLSelectElement, FieldShell & SelectHTMLAttributes<HTMLSelectElement> & { options: readonly { value: string; label: string }[]; placeholder?: string }>(
  function SelectField({ label, hint, error, required, className, options, placeholder, ...rest }, ref) {
    const id = useId();
    return (
      <Shell id={id} {...{ label, hint, error, required, className }}>
        <select ref={ref} id={id} className={clsx('input pr-8', error && 'border-bad')} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Shell>
    );
  },
);

/** Number input that keeps what the user typed, and reports number | null (never NaN, never silent 0). */
export function NumberField({ label, value, onChange, hint, error, required, className, unit, min, step = 'any', placeholder, disabled }: FieldShell & {
  value: number | null; onChange: (n: number | null) => void; unit?: string; min?: number; step?: number | 'any'; placeholder?: string; disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    // Re-sync when the value changes from outside (e.g. switching assessment), but not mid-typing.
    const parsed = text.trim() === '' ? null : Number(text);
    if (parsed !== value && !(parsed !== null && Number.isNaN(parsed) && value === null)) setText(value === null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Shell id={id} {...{ label, hint, error, required, className }}>
      <div className="relative">
        <input
          id={id} type="text" inputMode="decimal" className={clsx('input', unit && 'pr-16', error && 'border-bad')} value={text} placeholder={placeholder} disabled={disabled}
          data-min={min} data-step={step}
          aria-invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            if (t.trim() === '') onChange(null);
            else {
              const n = Number(t.replace(/,/g, ''));
              onChange(Number.isFinite(n) ? n : null);
            }
          }}
        />
        {unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">{unit}</span>}
      </div>
    </Shell>
  );
}

export function Checkbox({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500" />
      <label htmlFor={id} className="text-sm leading-snug">
        {label}
        {hint && <span className="block hint">{hint}</span>}
      </label>
    </div>
  );
}

export function ChipToggle({ options, value, onChange, label, disabled }: { options: readonly string[]; value: string[]; onChange: (v: string[]) => void; label: string; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled}>
      <legend className="label">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button
              key={o} type="button" aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
              className={clsx('rounded-full border px-3 py-1 text-[13px] transition-colors', on ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-navy-200 text-navy-800 hover:bg-navy-50')}
            >
              {o}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------- Tabs
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[n].id);
    refs.current[tabs[n].id]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line mb-5 no-print">
      {tabs.map((t, i) => (
        <button
          key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" id={`tab-${t.id}`} aria-selected={value === t.id} aria-controls={`panel-${t.id}`} tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}
          className={clsx('px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors', value === t.id ? 'border-teal-600 text-teal-700' : 'border-transparent text-muted hover:text-ink')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
export const TabPanel = ({ id, active, children }: { id: string; active: boolean; children: ReactNode }) =>
  active ? <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`}>{children}</div> : null;

// ---------------------------------------------------------------- Modal (native <dialog>: focus trap + Esc built in)
export function Modal({ open, onClose, title, children, footer, size = 'md', description }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; description?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) d.close();
  }, [open]);
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <dialog
      ref={ref} aria-labelledby={titleId} className="m-auto w-full backdrop:bg-navy-950/50"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <div className={clsx('mx-auto w-[calc(100vw-1.5rem)] bg-white rounded-xl shadow-pop border border-line flex flex-col max-h-[90vh]', width)}>
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-line">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
              {description && <p className="text-sm text-muted mt-0.5">{description}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-md p-1 text-muted hover:bg-navy-100"><X className="h-5 w-5" /></button>
          </div>
          <div className="px-5 py-4 overflow-y-auto">{children}</div>
          {footer && <div className="px-5 py-3 border-t border-line flex flex-wrap justify-end gap-2 bg-navy-50 rounded-b-xl">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, children, confirmLabel = 'Confirm', danger, requireText }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; children: ReactNode; confirmLabel?: string; danger?: boolean; requireText?: string;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (!open) setTyped(''); }, [open]);
  const ok = !requireText || typed.trim() === requireText;
  return (
    <Modal
      open={open} onClose={onClose} title={title} size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={!ok} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="text-sm space-y-3">
        {children}
        {requireText && <TextField label={<>Type <strong>{requireText}</strong> to confirm</>} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Toasts
interface Toast { id: number; message: string; tone: 'good' | 'info' | 'bad' }
const ToastCtx = createContext<(message: string, tone?: Toast['tone']) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast['tone'] = 'good') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, message, tone }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4200);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 no-print">
        {items.map((t) => (
          <div key={t.id} className={clsx('flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm shadow-pop border bg-white', t.tone === 'good' && 'border-green-300', t.tone === 'bad' && 'border-red-300', t.tone === 'info' && 'border-blue-200')}>
            {t.tone === 'good' ? <CheckCircle2 className="h-4 w-4 text-good" aria-hidden /> : t.tone === 'bad' ? <OctagonAlert className="h-4 w-4 text-bad" aria-hidden /> : <Info className="h-4 w-4 text-info" aria-hidden />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------- Misc
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3.5 py-3 min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className={clsx('text-xl font-semibold mt-0.5 tabular-nums', tone === 'bad' && 'text-bad', tone === 'warn' && 'text-warn', tone === 'good' && 'text-good')}>{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="font-medium break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · AI Maturity Compass`;
    return () => { document.title = prev; };
  }, [title]);
}

export const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
export const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
