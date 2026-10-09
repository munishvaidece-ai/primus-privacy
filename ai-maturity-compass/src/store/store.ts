import { create } from 'zustand';
import { DEFAULT_SCORING_CONFIG } from '../data/spec';
import { createAssessment, fillAssessment, nowIso, parseAssessment, repairResponse, uid } from '../domain/factory';
import {
  assessmentSchema, assessorProfileSchema, externalBenchmarkFileSchema,
  type Assessment, type AssessorProfile, type BenchmarkRecord, type CustomRec, type GateDecision, type IndicatorEntry, type IndiaItem, type Profile,
  type RecOverride, type Response, type RoiInputs, type ValueEvidence,
} from '../domain/schema';
import { clearStorage, loadState, saveState, storageMode, type ExternalBenchmarkMeta } from './storage';
import { createDemoAssessment, DEMO_ID } from './seed/demo';

type ScoringConfig = Assessment['config'];

export interface AppState {
  ready: boolean;
  assessments: Record<string, Assessment>;
  order: string[];
  currentId: string | null;
  assessor: AssessorProfile;
  externalBenchmarks: BenchmarkRecord[];
  externalMeta: ExternalBenchmarkMeta | null;
  lastSavedAt: string | null;
  /** False when the browser blocks storage and changes last only for this page session. */
  persistent: boolean;
  storageError: string | null;
  loadWarnings: string[];

  init(): void;
  flush(): void;
  dismissWarnings(): void;

  selectAssessment(id: string): void;
  createDraft(profile?: Partial<Profile>, name?: string): string;
  updateDraft(id: string, patch: { profile?: Partial<Profile>; name?: string; wizardStep?: number }): void;
  completeWizard(id: string): void;
  renameAssessment(id: string, name: string): void;
  duplicateAssessment(id: string): string | null;
  deleteAssessment(id: string): void;
  submitAssessment(id: string): void;
  reopenAssessment(id: string): void;
  updateProfile(patch: Partial<Profile>): void;
  updateNotes(notes: string): void;

  updateResponse(questionId: string, patch: (r: Response) => Response): void;
  updateIndicator(indicatorId: string, patch: Partial<IndicatorEntry>): void;
  updateRoi(fn: (r: RoiInputs) => RoiInputs): void;
  updateValueEvidence(fn: (v: ValueEvidence) => ValueEvidence): void;
  updateIndiaItem(id: string, patch: Partial<IndiaItem>): void;
  setIndiaDate(date: string): void;

  updateConfig(fn: (c: ScoringConfig) => ScoringConfig): void;
  resetConfig(): void;
  setGateDecision(decision: Partial<GateDecision>): void;
  setRecOverride(recId: string, patch: RecOverride): void;
  clearRecOverride(recId: string): void;
  addCustomRec(rec: Omit<CustomRec, 'id'>): string;
  updateCustomRec(id: string, patch: Partial<CustomRec>): void;
  deleteCustomRec(id: string): void;

  importAssessmentJson(text: string): { ok: true; id: string } | { ok: false; error: string };
  importExternalBenchmarks(text: string): { ok: true; count: number } | { ok: false; error: string };
  clearExternalBenchmarks(): void;
  setAssessor(patch: Partial<AssessorProfile>): void;
  resetDemo(): void;
  clearAll(): void;
}

const MAX_ACTIVITY = 100;

function withLog(a: Assessment, event: string, detail = ''): Assessment {
  return { ...a, activity: [...a.activity, { at: nowIso(), event, detail }].slice(-MAX_ACTIVITY) };
}

const touch = (a: Assessment): Assessment => ({ ...a, updatedAt: nowIso() });

/** Data edits are blocked once an assessment is submitted (until it is reopened). */
const locked = (a: Assessment | undefined): boolean => !a || a.status === 'submitted';

export const useStore = create<AppState>((set, get) => {
  /** Apply a function to the current assessment. */
  const mutateCurrent = (fn: (a: Assessment) => Assessment, opts?: { allowSubmitted?: boolean }) => {
    const { currentId, assessments } = get();
    if (!currentId) return;
    const a = assessments[currentId];
    if (!a || (!opts?.allowSubmitted && locked(a))) return;
    set({ assessments: { ...assessments, [currentId]: touch(fn(a)) } });
  };
  const mutateById = (id: string, fn: (a: Assessment) => Assessment) => {
    const a = get().assessments[id];
    if (!a) return;
    set({ assessments: { ...get().assessments, [id]: touch(fn(a)) } });
  };

  return {
    ready: false,
    assessments: {},
    order: [],
    currentId: null,
    assessor: assessorProfileSchema.parse({}),
    externalBenchmarks: [],
    externalMeta: null,
    lastSavedAt: null,
    persistent: true,
    storageError: null,
    loadWarnings: [],

    init() {
      if (get().ready) return;
      const { state, warnings } = loadState();
      set({ persistent: storageMode() === 'local' });
      if (state) {
        const map: Record<string, Assessment> = {};
        state.assessments.forEach((a) => (map[a.id] = a));
        set({
          ready: true,
          assessments: map,
          order: state.assessments.map((a) => a.id),
          currentId: state.currentId,
          assessor: state.assessor,
          externalBenchmarks: state.externalBenchmarks,
          externalMeta: state.externalMeta,
          lastSavedAt: state.savedAt,
          loadWarnings: warnings,
        });
      } else {
        const demo = createDemoAssessment();
        set({ ready: true, assessments: { [demo.id]: demo }, order: [demo.id], currentId: demo.id, loadWarnings: warnings });
        get().flush();
      }
    },

    flush() {
      const s = get();
      const res = saveState({
        assessments: s.order.map((id) => s.assessments[id]).filter(Boolean),
        currentId: s.currentId,
        assessor: s.assessor,
        externalBenchmarks: s.externalBenchmarks,
        externalMeta: s.externalMeta,
      });
      if (res.ok) set({ lastSavedAt: res.savedAt, storageError: null });
      else set({ storageError: res.error });
    },

    dismissWarnings() {
      set({ loadWarnings: [] });
    },

    selectAssessment(id) {
      if (get().assessments[id]) set({ currentId: id });
    },

    createDraft(profile, name) {
      const a = createAssessment({
        name: name ?? (profile?.organizationName ? `${profile.organizationName} — AI maturity assessment` : 'New assessment'),
        profile,
      });
      set({ assessments: { ...get().assessments, [a.id]: a }, order: [a.id, ...get().order], currentId: a.id });
      return a.id;
    },

    updateDraft(id, patch) {
      mutateById(id, (a) => ({
        ...a,
        name: patch.name ?? a.name,
        wizardStep: patch.wizardStep ?? a.wizardStep,
        profile: { ...a.profile, ...(patch.profile ?? {}) },
      }));
    },

    completeWizard(id) {
      mutateById(id, (a) => withLog({ ...a, status: a.status === 'draft' ? 'in_progress' : a.status }, 'Profile completed', 'Assessment opened for responses'));
    },

    renameAssessment(id, name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      mutateById(id, (a) => withLog({ ...a, name: trimmed }, 'Renamed', trimmed));
    },

    duplicateAssessment(id) {
      const src = get().assessments[id];
      if (!src) return null;
      const copy = fillAssessment(
        assessmentSchema.parse({
          ...JSON.parse(JSON.stringify(src)),
          id: uid('asm'),
          name: `${src.name} (copy)`,
          status: src.status === 'draft' ? 'draft' : 'in_progress',
          submittedAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          activity: [{ at: nowIso(), event: 'Duplicated', detail: `From “${src.name}”` }],
        }),
      );
      const idx = get().order.indexOf(id);
      const order = [...get().order];
      order.splice(idx + 1, 0, copy.id);
      set({ assessments: { ...get().assessments, [copy.id]: copy }, order });
      return copy.id;
    },

    deleteAssessment(id) {
      const { assessments, order, currentId } = get();
      if (!assessments[id]) return;
      const next = { ...assessments };
      delete next[id];
      const newOrder = order.filter((x) => x !== id);
      set({ assessments: next, order: newOrder, currentId: currentId === id ? newOrder[0] ?? null : currentId });
    },

    submitAssessment(id) {
      mutateById(id, (a) => withLog({ ...a, status: 'submitted', submittedAt: nowIso() }, 'Submitted', 'Assessment marked submitted; data editing locked'));
    },

    reopenAssessment(id) {
      mutateById(id, (a) => withLog({ ...a, status: 'in_progress', submittedAt: null }, 'Reopened', 'Reopened for authorized review (prototype — no access control)'));
    },

    updateProfile(patch) {
      mutateCurrent((a) => ({ ...a, profile: { ...a.profile, ...patch } }));
    },

    updateNotes(notes) {
      mutateCurrent((a) => ({ ...a, notes }), { allowSubmitted: true });
    },

    updateResponse(questionId, patch) {
      mutateCurrent((a) => {
        const cur = a.responses[questionId];
        if (!cur) return a;
        const next = repairResponse({ ...patch(cur), updatedAt: nowIso() });
        return { ...a, responses: { ...a.responses, [questionId]: next } };
      });
    },

    updateIndicator(indicatorId, patch) {
      mutateCurrent((a) => ({ ...a, indicators: { ...a.indicators, [indicatorId]: { ...a.indicators[indicatorId], ...patch } } }));
    },

    updateRoi(fn) {
      mutateCurrent((a) => ({ ...a, roi: fn(a.roi) }));
    },

    updateValueEvidence(fn) {
      mutateCurrent((a) => ({ ...a, valueEvidence: fn(a.valueEvidence) }));
    },

    updateIndiaItem(id, patch) {
      mutateCurrent((a) => ({ ...a, india: { ...a.india, items: { ...a.india.items, [id]: { ...a.india.items[id], ...patch } } } }));
    },

    setIndiaDate(date) {
      mutateCurrent((a) => ({ ...a, india: { ...a.india, assessmentDate: date } }));
    },

    updateConfig(fn) {
      mutateCurrent((a) => withLog({ ...a, config: fn(a.config) }, 'Scoring policy changed'), { allowSubmitted: false });
    },

    resetConfig() {
      mutateCurrent((a) => withLog({ ...a, config: JSON.parse(JSON.stringify(DEFAULT_SCORING_CONFIG)) }, 'Scoring policy reset to defaults'));
    },

    setGateDecision(decision) {
      mutateCurrent(
        (a) => {
          const next: GateDecision = { ...a.gateDecision, ...decision, decidedAt: nowIso() };
          if (next.status === 'unreviewed') next.decidedAt = null;
          return withLog({ ...a, gateDecision: next }, `Maturity gate ${next.status}`, next.note);
        },
        { allowSubmitted: true },
      );
    },

    setRecOverride(recId, patch) {
      mutateCurrent((a) => ({ ...a, recommendationOverrides: { ...a.recommendationOverrides, [recId]: { ...a.recommendationOverrides[recId], ...patch } } }), { allowSubmitted: true });
    },

    clearRecOverride(recId) {
      mutateCurrent(
        (a) => {
          const next = { ...a.recommendationOverrides };
          delete next[recId];
          return { ...a, recommendationOverrides: next };
        },
        { allowSubmitted: true },
      );
    },

    addCustomRec(rec) {
      const id = uid('custom');
      mutateCurrent((a) => ({ ...a, customRecommendations: [...a.customRecommendations, { ...rec, id }] }), { allowSubmitted: true });
      return id;
    },

    updateCustomRec(id, patch) {
      mutateCurrent(
        (a) => ({ ...a, customRecommendations: a.customRecommendations.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),
        { allowSubmitted: true },
      );
    },

    deleteCustomRec(id) {
      mutateCurrent((a) => ({ ...a, customRecommendations: a.customRecommendations.filter((c) => c.id !== id) }), { allowSubmitted: true });
    },

    importAssessmentJson(text) {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return { ok: false, error: 'The file is not valid JSON.' };
      }
      const candidate = (raw as { assessment?: unknown })?.assessment ?? raw;
      const parsed = parseAssessment(candidate);
      if (!parsed) return { ok: false, error: 'The file is not a valid AI Maturity Compass assessment export.' };
      const id = get().assessments[parsed.id] ? uid('asm') : parsed.id;
      const a: Assessment = { ...parsed, id, name: id === parsed.id ? parsed.name : `${parsed.name} (imported)`, updatedAt: nowIso() };
      set({ assessments: { ...get().assessments, [id]: withLog(a, 'Imported', 'From JSON export') }, order: [id, ...get().order], currentId: id });
      return { ok: true, id };
    },

    importExternalBenchmarks(text) {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return { ok: false, error: 'The file is not valid JSON.' };
      }
      const parsed = externalBenchmarkFileSchema.safeParse(raw);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return { ok: false, error: `Invalid benchmark file: ${first.path.join('.') || 'root'} — ${first.message}` };
      }
      const records: BenchmarkRecord[] = parsed.data.records.map((r) => ({ ...r, source: 'external_supplied' as const }));
      set({ externalBenchmarks: records, externalMeta: { ...parsed.data.provenance, importedAt: nowIso() } });
      return { ok: true, count: records.length };
    },

    clearExternalBenchmarks() {
      set({ externalBenchmarks: [], externalMeta: null });
    },

    setAssessor(patch) {
      set({ assessor: { ...get().assessor, ...patch } });
    },

    resetDemo() {
      const demo = createDemoAssessment();
      const { assessments, order } = get();
      set({
        assessments: { ...assessments, [DEMO_ID]: demo },
        order: order.includes(DEMO_ID) ? order : [...order, DEMO_ID],
        currentId: DEMO_ID,
      });
    },

    clearAll() {
      clearStorage();
      set({ assessments: {}, order: [], currentId: null, externalBenchmarks: [], externalMeta: null });
      get().flush();
    },
  };
});

/** Debounced autosave. Returns an unsubscribe function. */
export function startAutosave(delayMs = 250): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = useStore.subscribe((state, prev) => {
    if (!state.ready) return;
    const changed =
      state.assessments !== prev.assessments || state.order !== prev.order || state.currentId !== prev.currentId ||
      state.assessor !== prev.assessor || state.externalBenchmarks !== prev.externalBenchmarks;
    if (!changed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => useStore.getState().flush(), delayMs);
  });
  const onUnload = () => {
    if (timer) clearTimeout(timer);
    useStore.getState().flush();
  };
  window.addEventListener('beforeunload', onUnload);
  window.addEventListener('pagehide', onUnload);
  return () => {
    unsub();
    window.removeEventListener('beforeunload', onUnload);
    window.removeEventListener('pagehide', onUnload);
    if (timer) clearTimeout(timer);
  };
}
