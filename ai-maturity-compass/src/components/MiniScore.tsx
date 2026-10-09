import clsx from 'clsx';
import { MATURITY_SCALE, SCALE_BY_SCORE, type Score } from '../data/spec';
import { SCORE_FILL, SCORE_TEXT } from './charts/colors';

export function MiniScore({ label, value, onChange, disabled }: { label: string; value: Score | null; onChange: (s: Score | null) => void; disabled?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
        {MATURITY_SCALE.map((l) => (
          <button
            key={l.score} type="button" role="radio" aria-checked={value === l.score} disabled={disabled} title={`${l.score} — ${l.label}: ${l.description}`}
            onClick={() => onChange(value === l.score ? null : l.score)}
            className={clsx('h-8 min-w-8 rounded-md border px-2 text-sm font-semibold', value === l.score ? 'border-teal-600 ring-2 ring-teal-500/40' : 'border-navy-200 hover:border-navy-400')}
            style={{ background: value === l.score ? SCORE_FILL[l.score] : '#fff', color: value === l.score ? SCORE_TEXT[l.score] : undefined }}
          >{l.score}</button>
        ))}
      </div>
      <div className="mt-1 min-h-4 text-[11px] text-muted">{value === null ? 'Not scored' : `${SCALE_BY_SCORE[value].label}: ${SCALE_BY_SCORE[value].description}`}</div>
    </div>
  );
}
