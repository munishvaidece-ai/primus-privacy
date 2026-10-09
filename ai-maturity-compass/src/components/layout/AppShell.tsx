import clsx from 'clsx';
import {
  BarChart3, Check, ChevronDown, Compass, FileCheck2, FileText, FolderOpen, LayoutDashboard, ListChecks, Menu, Plus, Radar, Route as RouteIcon,
  Settings as SettingsIcon, ShieldCheck, TrendingUp, User, X, AlertTriangle, Save,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { QUESTIONS } from '../../data/spec';
import { useCurrent, useResults } from '../../store/hooks';
import { useStore } from '../../store/store';
import { AssessmentStatusBadge, DemoTag } from '../shared';
import { Callout, ProgressBar, formatDateTime } from '../ui';

const NAV = [
  { to: '/', label: 'Executive Overview', icon: LayoutDashboard, end: true },
  { to: '/assessments', label: 'Assessments', icon: FolderOpen },
  { to: '/questionnaire', label: 'Assessment Questionnaire', icon: ListChecks },
  { to: '/evidence', label: 'Evidence & Verification', icon: FileCheck2 },
  { to: '/maturity', label: 'AI Maturity Analysis', icon: Radar },
  { to: '/risk', label: 'Risk & Governance', icon: ShieldCheck },
  { to: '/value', label: 'Value Realization', icon: TrendingUp },
  { to: '/roadmap', label: 'Recommendations & Roadmap', icon: RouteIcon },
  { to: '/benchmarking', label: 'Benchmarking', icon: BarChart3 },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
] as const;

const TITLES: [string, string][] = [
  ['/assessments/new', 'New assessment'],
  ['/assessments', 'Assessments'],
  ['/questionnaire/review', 'Review & submit'],
  ['/questionnaire', 'Assessment Questionnaire'],
  ['/evidence', 'Evidence & Verification'],
  ['/maturity', 'AI Maturity Analysis'],
  ['/risk', 'Risk & Governance'],
  ['/value', 'Value Realization'],
  ['/roadmap', 'Recommendations & Roadmap'],
  ['/benchmarking', 'Benchmarking'],
  ['/reports', 'Reports'],
  ['/settings', 'Settings'],
];

function useOutsideClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [onClose]);
  return ref;
}

function Dropdown({ label, button, children, align = 'left' }: { label: string; button: ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(() => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-sm hover:bg-navy-50">
        {button}
        <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
      </button>
      {open && (
        <div role="menu" className={clsx('absolute z-40 mt-1.5 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-white shadow-pop py-1.5', align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function AssessmentSwitcher() {
  const assessments = useStore((s) => s.assessments);
  const order = useStore((s) => s.order);
  const currentId = useStore((s) => s.currentId);
  const select = useStore((s) => s.selectAssessment);
  const navigate = useNavigate();
  const cur = currentId ? assessments[currentId] : null;
  return (
    <Dropdown
      label="Switch assessment"
      button={
        <span className="flex min-w-0 items-center gap-2 max-w-[44vw] sm:max-w-xs">
          <FolderOpen className="h-4 w-4 text-teal-700 shrink-0" aria-hidden />
          <span className="truncate font-medium">{cur ? cur.name : 'No assessment'}</span>
          {cur?.isDemo && <DemoTag className="hidden sm:inline-flex" />}
        </span>
      }
    >
      {(close) => (
        <>
          <div className="px-3 pb-1 pt-0.5 text-xs font-semibold uppercase tracking-wide text-muted">Assessments</div>
          <div className="max-h-72 overflow-y-auto">
            {order.length === 0 && <div className="px-3 py-2 text-sm text-muted">No assessments yet.</div>}
            {order.map((id) => {
              const a = assessments[id];
              if (!a) return null;
              return (
                <button key={id} role="menuitem" type="button" onClick={() => { select(id); close(); }} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-navy-50">
                  <Check className={clsx('mt-0.5 h-4 w-4 shrink-0', id === currentId ? 'text-teal-600' : 'text-transparent')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.name}</span>
                    <span className="block truncate text-xs text-muted">{a.profile.organizationName || 'Organization not set'}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1"><AssessmentStatusBadge status={a.status} />{a.isDemo && <DemoTag />}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-1 border-t border-line pt-1">
            <button role="menuitem" type="button" onClick={() => { close(); navigate('/assessments/new'); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-navy-50"><Plus className="h-4 w-4" aria-hidden /> New assessment</button>
            <button role="menuitem" type="button" onClick={() => { close(); navigate('/assessments'); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-navy-50"><FolderOpen className="h-4 w-4" aria-hidden /> Manage assessments</button>
          </div>
        </>
      )}
    </Dropdown>
  );
}

function SaveIndicator() {
  const savedAt = useStore((s) => s.lastSavedAt);
  const err = useStore((s) => s.storageError);
  if (err) return <span role="status" className="hidden md:flex items-center gap-1.5 text-xs text-bad" title={err}><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Not saved</span>;
  return (
    <span role="status" aria-live="polite" className="hidden md:flex items-center gap-1.5 text-xs text-muted" title="Changes are saved automatically in this browser">
      <Save className="h-3.5 w-3.5" aria-hidden />
      {savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Autosave on'}
    </span>
  );
}

function ProfileMenu() {
  const assessor = useStore((s) => s.assessor);
  const initials = assessor.name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'U';
  return (
    <Dropdown label="Profile menu" align="right" button={<span className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-white">{initials}</span><span className="hidden lg:inline text-sm">{assessor.name}</span></span>}>
      {(close) => (
        <div className="px-3 py-2">
          <div className="flex items-center gap-2.5">
            <User className="h-8 w-8 rounded-full bg-navy-100 p-1.5 text-navy-700" aria-hidden />
            <div className="min-w-0"><div className="truncate text-sm font-semibold">{assessor.name}</div><div className="truncate text-xs text-muted">{assessor.role} · {assessor.firm}</div></div>
          </div>
          <p className="mt-2 text-xs text-muted">Prototype profile for report attribution only. There is no sign-in or access control.</p>
          <Link to="/settings?tab=profile" onClick={close} role="menuitem" className="mt-2 inline-block text-sm link">Edit profile</Link>
        </div>
      )}
    </Dropdown>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const a = useCurrent();
  const res = useResults(a);
  const applicable = res?.coverage.applicable ?? 0;
  const answered = res ? res.coverage.selfAnswered + res.coverage.selfDontKnow : 0;
  const progress = a && applicable > 0 ? Math.min(1, answered / applicable) : a ? 0 : null;
  return (
    <div className="flex h-full flex-col bg-navy-900 text-navy-100">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5 px-5 pt-5 pb-4 text-white">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600"><Compass className="h-5 w-5" aria-hidden /></span>
        <span>
          <span className="block text-[15px] font-semibold leading-tight">AI Maturity Compass</span>
          <span className="block text-[11px] text-navy-300 leading-tight">Assessment, Governance &amp; Value Realization</span>
        </span>
      </Link>
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pb-3">
        <ul className="space-y-0.5">
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to} end={'end' in n ? n.end : false} onClick={onNavigate}
                className={({ isActive }) => clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors', isActive ? 'bg-white/12 text-white font-medium ring-1 ring-white/10' : 'text-navy-200 hover:bg-white/8 hover:text-white')}
              >
                <n.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                <span className="leading-tight">{n.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="m-3 rounded-xl bg-white/8 p-3.5 ring-1 ring-white/10">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-navy-300">Current assessment</div>
        {a ? (
          <>
            <div className="mt-1 text-sm font-medium text-white leading-snug">{a.profile.organizationName || 'Organization not set'}</div>
            <div className="text-xs text-navy-300 leading-snug">{a.name}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5"><AssessmentStatusBadge status={a.status} />{a.isDemo && <DemoTag />}</div>
            <div className="mt-2.5">
              <div className="mb-1 flex justify-between text-[11px] text-navy-300"><span>Self-reported progress</span><span>{answered} / {applicable}</span></div>
              <ProgressBar value={progress} label="Self-reported progress" height="h-1.5" />
            </div>
            <div className="mt-2 text-[11px] text-navy-300">Updated {formatDateTime(a.updatedAt)}</div>
          </>
        ) : (
          <div className="mt-1 text-xs text-navy-300">None selected. <Link to="/assessments" onClick={onNavigate} className="underline text-white">Open assessments</Link></div>
        )}
      </div>
      <p className="px-5 pb-4 text-[10.5px] leading-snug text-navy-400">Prototype by Primus Partners. Data stays in this browser. Total questions: {QUESTIONS.length}.</p>
    </div>
  );
}

export default function AppShell() {
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  const a = useCurrent();
  const warnings = useStore((s) => s.loadWarnings);
  const dismiss = useStore((s) => s.dismissWarnings);
  const storageError = useStore((s) => s.storageError);
  const title = TITLES.find(([p]) => loc.pathname.startsWith(p))?.[1] ?? 'Executive Overview';
  const isPrint = loc.pathname === '/reports/print';

  useEffect(() => { setDrawer(false); window.scrollTo(0, 0); }, [loc.pathname]);

  if (isPrint) return <Outlet />;

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow-pop no-print">Skip to main content</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[268px] lg:block no-print" aria-label="Sidebar"><Sidebar /></aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden no-print" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-[290px] max-w-[85vw] shadow-pop">
            <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="absolute right-2 top-2 z-10 rounded-md p-1.5 text-white hover:bg-white/10"><X className="h-5 w-5" /></button>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
      <div className="lg:pl-[268px]">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur sm:px-6 no-print">
          <button type="button" className="rounded-md p-1.5 hover:bg-navy-100 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation menu"><Menu className="h-5 w-5" /></button>
          <div className="hidden min-w-0 sm:block">
            <div className="kicker">Primus Partners</div>
            <div className="truncate text-sm font-semibold leading-tight">{title}</div>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <SaveIndicator />
            <AssessmentSwitcher />
            <ProfileMenu />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1320px] px-4 py-5 sm:px-6 sm:py-6" tabIndex={-1}>
          <div className="space-y-3 mb-4 no-print">
            {warnings.map((w, i) => (
              <Callout key={i} tone="warn" title="Stored data notice" action={<button type="button" className="text-xs link" onClick={dismiss}>Dismiss</button>}>{w}</Callout>
            ))}
            {storageError && <Callout tone="bad" title="Changes are not being saved">{storageError}</Callout>}
            {a?.isDemo && (
              <Callout tone="warn" title="Illustrative demonstration assessment" action={<Link to="/assessments/new" className="btn btn-sm btn-secondary">Start a new assessment</Link>}>
                Synthetic data for a fictional organization. Every figure is calculated from the seeded responses but is not a client finding and not a validated benchmark.
              </Callout>
            )}
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
