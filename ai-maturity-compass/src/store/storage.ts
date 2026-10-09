/**
 * localStorage persistence with schema versioning and defensive loading.
 *
 * - The whole app state is one JSON document under a versioned key.
 * - On load every assessment is validated with the zod schema; invalid ones are skipped and
 *   reported (never silently "fixed" into fabricated data).
 * - Unparseable JSON or a newer, unknown schema version is copied to a backup key before any
 *   overwrite so nothing is lost.
 * - Storage errors (quota, blocked storage, private mode) are caught and surfaced.
 */
import { SCHEMA_VERSION } from '../data/spec';
import { assessorProfileSchema, benchmarkRecordSchema, type Assessment, type AssessorProfile, type BenchmarkRecord } from '../domain/schema';
import { parseAssessment } from '../domain/factory';

export const STORAGE_KEY = 'aimc:state';
export const BACKUP_PREFIX = 'aimc:backup:';

export interface ExternalBenchmarkMeta {
  publisher: string;
  methodology: string;
  collectedOn: string;
  sampleDescription: string;
  importedAt: string;
}

export interface PersistedState {
  schemaVersion: number;
  savedAt: string;
  assessments: Assessment[];
  currentId: string | null;
  assessor: AssessorProfile;
  externalBenchmarks: BenchmarkRecord[];
  externalMeta: ExternalBenchmarkMeta | null;
}

export interface LoadResult {
  /** null → nothing stored yet (first launch). */
  state: PersistedState | null;
  warnings: string[];
}

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Used when the browser blocks localStorage (sandboxed frames, some private modes): the app still works for the session. */
const memoryStore: Storage = (() => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
})();

let mode: 'local' | 'memory' = 'local';

function backend(): Storage {
  try {
    const s = globalThis.localStorage;
    if (!s) throw new Error('no localStorage');
    const probe = '__aimc_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    mode = 'local';
    return s;
  } catch {
    mode = 'memory';
    return memoryStore;
  }
}

/** Whether changes persist across page loads ('local') or only for this page session ('memory'). */
export function storageMode(): 'local' | 'memory' {
  backend();
  return mode;
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
/** Migrations keyed by the version they upgrade FROM. None needed yet; the hook exists so v2 can ship safely. */
export const MIGRATIONS: Record<number, Migration> = {};

export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  let current = raw;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    current = step ? step(current) : current;
    version += 1;
  }
  return { ...current, schemaVersion: SCHEMA_VERSION };
}

export function backupRaw(store: Storage, raw: string, reason: string): void {
  try {
    store.setItem(`${BACKUP_PREFIX}${reason}:${Date.now()}`, raw);
  } catch {
    /* best effort */
  }
}

export function loadState(store: Storage | null = backend()): LoadResult {
  if (!store) return { state: null, warnings: ['Browser storage is unavailable; changes will not persist after reload.'] };
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return { state: null, warnings: ['Browser storage could not be read.'] };
  }
  if (raw === null) return { state: null, warnings: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    backupRaw(store, raw, 'corrupt');
    return { state: null, warnings: ['Stored data was unreadable and has been backed up; starting fresh with demonstration data.'] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    backupRaw(store, raw, 'invalid');
    return { state: null, warnings: ['Stored data had an unexpected shape and has been backed up; starting fresh.'] };
  }
  const obj = parsed as Record<string, unknown>;
  const version = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    backupRaw(store, raw, `newer-v${version}`);
    return { state: null, warnings: [`Stored data comes from a newer version (v${version}) of this app; it was backed up and not loaded.`] };
  }

  const m = migrate(obj);
  const warnings: string[] = [];
  const assessments: Assessment[] = [];
  const list = Array.isArray(m.assessments) ? m.assessments : [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const item of list) {
    const a = parseAssessment(item);
    if (!a || seen.has(a.id)) {
      skipped++;
      continue;
    }
    seen.add(a.id);
    assessments.push(a);
  }
  if (skipped > 0) {
    backupRaw(store, raw, 'partial');
    warnings.push(`${skipped} stored assessment${skipped > 1 ? 's were' : ' was'} invalid and skipped (original data backed up).`);
  }

  const ext: BenchmarkRecord[] = [];
  if (Array.isArray(m.externalBenchmarks)) {
    for (const r of m.externalBenchmarks) {
      const p = benchmarkRecordSchema.safeParse(r);
      if (p.success) ext.push(p.data);
    }
  }
  const assessor = assessorProfileSchema.safeParse(m.assessor);
  const currentId = typeof m.currentId === 'string' && seen.has(m.currentId) ? m.currentId : assessments[0]?.id ?? null;
  const meta = (m.externalMeta ?? null) as ExternalBenchmarkMeta | null;

  return {
    state: {
      schemaVersion: SCHEMA_VERSION,
      savedAt: typeof m.savedAt === 'string' ? m.savedAt : new Date().toISOString(),
      assessments,
      currentId,
      assessor: assessor.success ? assessor.data : assessorProfileSchema.parse({}),
      externalBenchmarks: ext,
      externalMeta: ext.length > 0 ? meta : null,
    },
    warnings,
  };
}

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };

export function saveState(state: Omit<PersistedState, 'schemaVersion' | 'savedAt'>, store: Storage | null = backend()): SaveResult {
  if (!store) return { ok: false, error: 'Browser storage is unavailable; changes will not persist.' };
  const savedAt = new Date().toISOString();
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...state, schemaVersion: SCHEMA_VERSION, savedAt }));
    return { ok: true, savedAt };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    return {
      ok: false,
      error: /quota/i.test(name) || /quota/i.test(String(e))
        ? 'Browser storage is full. Export your assessments and remove old ones to free space.'
        : 'Changes could not be saved to browser storage.',
    };
  }
}

export function clearStorage(store: Storage | null = backend()): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function storageUsageBytes(store: Storage | null = backend()): number {
  try {
    return (store?.getItem(STORAGE_KEY) ?? '').length * 2;
  } catch {
    return 0;
  }
}
