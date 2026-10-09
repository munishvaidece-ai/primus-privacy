import { beforeEach, describe, expect, it } from 'vitest';
import { QUESTIONS } from '../data/spec';
import { createAssessment, uid } from '../domain/factory';
import { buildReportPdf } from '../export/pdf';
import { dimensionScoresCsv, indicatorsCsv, principalScoresCsv, questionnaireCsv, recommendationsCsv, indiaCsv, toCsv, exportFilename } from '../export/csv';
import { computeResults } from '../scoring/results';
import { applyFilters, distribution, EMPTY_FILTERS, generateSyntheticBenchmarks, localBenchmarkRecords, percentileRank } from '../benchmark/benchmark';
import { DIMENSIONS } from '../data/spec';
import { createDemoAssessment, DEMO_ID } from './seed/demo';
import { BACKUP_PREFIX, loadState, saveState, STORAGE_KEY, type Storage } from './storage';
import { useStore } from './store';

class MemStorage implements Storage {
  data = new Map<string, string>();
  quota = Infinity;
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) {
    if (v.length > this.quota) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
    this.data.set(k, v);
  }
  removeItem(k: string) { this.data.delete(k); }
}

describe('illustrative demonstration assessment', () => {
  const demo = createDemoAssessment();
  const res = computeResults(demo);

  it('is flagged as demo, complete (100 responses) and internally consistent', () => {
    expect(demo.isDemo).toBe(true);
    expect(Object.keys(demo.responses)).toHaveLength(100);
    expect(res.maturity.status).toBe('definitive');
    expect(res.maturity.dimensions.every((d) => d.status === 'scored')).toBe(true);
    // contributions sum to the index; index follows the configured weights
    const sum = res.maturity.dimensions.reduce((s, d) => s + (d.contribution ?? 0), 0);
    expect(res.maturity.index).toBeCloseTo(sum, 10);
    expect(res.maturity.index).toBeGreaterThan(60);
    expect(res.maturity.index).toBeLessThan(80);
    expect(res.maturitySelf.index!).toBeGreaterThan(res.maturity.index!);
    expect(res.risk.components.reduce((s, c) => s + (c.contribution ?? 0), 0)).toBeCloseTo(res.risk.score!, 10);
    expect(res.value.components.reduce((s, c) => s + (c.contribution ?? 0), 0)).toBeCloseTo(res.value.score!, 10);
  });

  it('exposes a critical-control gate, evidence gaps, cross-check flags and recommendations', () => {
    expect(res.gates.triggered).toBe(true);
    expect(res.gates.deficiencies.map((d) => d.questionId).sort()).toEqual(['C06', 'R03']);
    expect(res.gates.ceilingApplies).toBe(true);
    expect(res.gates.status).toBe('review_required');
    expect(res.coverage.dontKnowNotVerified).toBeGreaterThan(0);
    expect(res.coverage.awaitingAssessment).toBeGreaterThan(0);
    expect(res.coverage.notApplicable).toBeGreaterThan(0);
    expect(res.crossChecks.length).toBeGreaterThan(0);
    expect(res.recommendations.length).toBeGreaterThan(5);
    expect(res.recommendations[0].priority).toBe('critical');
    expect(res.indicators.captured).toBe(15);
    expect(res.indicators.roi.roiVerified).toBeCloseTo(((3620 - 3150) / 3150) * 100, 8);
    expect(res.value.components.every((c) => c.status !== 'unscored')).toBe(true);
  });

  it('counts match the actual response data', () => {
    const na = QUESTIONS.filter((q) => demo.responses[q.id].verified.state === 'not_applicable' || (demo.responses[q.id].verified.state === 'pending' && demo.responses[q.id].self.state === 'not_applicable')).length;
    expect(res.coverage.notApplicable).toBe(na);
    expect(res.coverage.verifiedScored).toBe(QUESTIONS.filter((q) => demo.responses[q.id].verified.state === 'scored').length);
  });
});

describe('persistence', () => {
  it('round-trips assessments through versioned storage', () => {
    const mem = new MemStorage();
    const a = createDemoAssessment();
    const res = saveState({ assessments: [a], currentId: a.id, assessor: { name: 'X', role: 'Y', firm: 'Z' }, externalBenchmarks: [], externalMeta: null }, mem);
    expect(res.ok).toBe(true);
    const raw = JSON.parse(mem.getItem(STORAGE_KEY)!);
    expect(raw.schemaVersion).toBe(1);
    const loaded = loadState(mem);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.state!.assessments).toHaveLength(1);
    expect(loaded.state!.assessments[0].responses.S01).toEqual(a.responses.S01);
    expect(computeResults(loaded.state!.assessments[0]).maturity.index).toBe(computeResults(a).maturity.index);
    expect(loaded.state!.assessor.name).toBe('X');
  });

  it('returns null state on first launch', () => {
    expect(loadState(new MemStorage())).toEqual({ state: null, warnings: [] });
  });

  it('backs up and recovers from corrupt JSON', () => {
    const mem = new MemStorage();
    mem.setItem(STORAGE_KEY, '{not json');
    const r = loadState(mem);
    expect(r.state).toBeNull();
    expect(r.warnings[0]).toMatch(/unreadable/);
    expect([...mem.data.keys()].some((k) => k.startsWith(BACKUP_PREFIX))).toBe(true);
  });

  it('refuses to load a newer schema version but keeps a backup', () => {
    const mem = new MemStorage();
    mem.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 99, assessments: [] }));
    const r = loadState(mem);
    expect(r.state).toBeNull();
    expect(r.warnings[0]).toMatch(/newer version/);
    expect([...mem.data.keys()].some((k) => k.startsWith(BACKUP_PREFIX))).toBe(true);
  });

  it('skips invalid assessments, keeps valid ones, and never fabricates data', () => {
    const mem = new MemStorage();
    const good = createAssessment({ name: 'Good' });
    mem.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, currentId: 'bad', assessments: [good, { id: 'bad', responses: 5 }, 'junk'] }));
    const r = loadState(mem);
    expect(r.state!.assessments.map((x) => x.id)).toEqual([good.id]);
    expect(r.state!.currentId).toBe(good.id);
    expect(r.warnings[0]).toMatch(/2 stored assessments were invalid/);
  });

  it('repairs missing response keys and inconsistent score/state pairs without inventing scores', () => {
    const mem = new MemStorage();
    const a = JSON.parse(JSON.stringify(createAssessment({ name: 'Broken' })));
    delete a.responses.S01;
    a.responses.S02.self = { state: 'scored', score: null };
    a.responses.S03.verified = { state: 'dont_know_nonsense', score: 3 };
    mem.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, assessments: [a] }));
    const r = loadState(mem);
    // S03 has an invalid enum → whole assessment invalid → skipped
    expect(r.state!.assessments).toHaveLength(0);
    a.responses.S03.verified = { state: 'pending', score: 3 };
    mem.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, assessments: [a] }));
    const ok = loadState(mem).state!.assessments[0];
    expect(Object.keys(ok.responses)).toHaveLength(100);
    expect(ok.responses.S01.self).toEqual({ state: 'unanswered', score: null });
    expect(ok.responses.S02.self).toEqual({ state: 'unanswered', score: null });
    expect(ok.responses.S03.verified.score).toBeNull();
  });

  it('reports storage-full errors instead of throwing', () => {
    const mem = new MemStorage();
    mem.quota = 10;
    const res = saveState({ assessments: [createDemoAssessment()], currentId: null, assessor: { name: '', role: '', firm: '' }, externalBenchmarks: [], externalMeta: null }, mem);
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/full/);
    expect(saveState({ assessments: [], currentId: null, assessor: { name: '', role: '', firm: '' }, externalBenchmarks: [], externalMeta: null }, null).ok).toBe(false);
  });
});

describe('store: changes survive a "refresh"', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ ready: false, assessments: {}, order: [], currentId: null, externalBenchmarks: [], externalMeta: null });
  });
  const reload = () => {
    useStore.getState().flush();
    useStore.setState({ ready: false, assessments: {}, order: [], currentId: null });
    useStore.getState().init();
  };

  it('seeds the demo on first launch and persists edits', () => {
    useStore.getState().init();
    expect(useStore.getState().currentId).toBe(DEMO_ID);
    useStore.getState().updateResponse('S01', (r) => ({ ...r, self: { state: 'scored', score: 1 }, observations: 'edited' }));
    reload();
    const r = useStore.getState().assessments[DEMO_ID].responses.S01;
    expect(r.self.score).toBe(1);
    expect(r.observations).toBe('edited');
  });

  it('creates a new assessment without touching the demo, then saves a draft and resumes it', () => {
    useStore.getState().init();
    const demoBefore = JSON.parse(JSON.stringify(useStore.getState().assessments[DEMO_ID]));
    const id = useStore.getState().createDraft({ organizationName: 'Acme' }, 'Acme assessment');
    useStore.getState().updateDraft(id, { wizardStep: 2, profile: { industry: 'Insurance' } });
    reload();
    const s = useStore.getState();
    expect(s.assessments[id].status).toBe('draft');
    expect(s.assessments[id].wizardStep).toBe(2);
    expect(s.assessments[id].profile.industry).toBe('Insurance');
    expect(s.assessments[DEMO_ID]).toEqual(demoBefore);
    expect(s.order).toHaveLength(2);
    // a blank assessment has no scores — nothing was fabricated
    expect(computeResults(s.assessments[id]).maturity.index).toBeNull();
  });

  it('supports duplicate, rename, submit/reopen (with locking) and delete', () => {
    const st = () => useStore.getState();
    st().init();
    const id = st().createDraft({ organizationName: 'Acme' });
    st().completeWizard(id);
    st().updateResponse('S01', (r) => ({ ...r, self: { state: 'scored', score: 3 } }));
    const dup = st().duplicateAssessment(id)!;
    expect(st().assessments[dup].responses.S01.self.score).toBe(3);
    expect(st().assessments[dup].name).toMatch(/\(copy\)/);
    st().renameAssessment(dup, 'Renamed');
    expect(st().assessments[dup].name).toBe('Renamed');
    st().selectAssessment(id);
    st().submitAssessment(id);
    expect(st().assessments[id].status).toBe('submitted');
    st().updateResponse('S01', (r) => ({ ...r, self: { state: 'scored', score: 0 } }));
    expect(st().assessments[id].responses.S01.self.score).toBe(3); // locked
    st().reopenAssessment(id);
    st().updateResponse('S01', (r) => ({ ...r, self: { state: 'scored', score: 0 } }));
    expect(st().assessments[id].responses.S01.self.score).toBe(0);
    st().deleteAssessment(dup);
    expect(st().assessments[dup]).toBeUndefined();
  });

  it('clears all data and resets the demonstration data on request', () => {
    const st = () => useStore.getState();
    st().init();
    st().clearAll();
    reload();
    expect(st().order).toHaveLength(0); // explicit empty state is respected, not re-seeded
    st().resetDemo();
    expect(st().assessments[DEMO_ID]).toBeDefined();
  });

  it('round-trips an assessment through JSON export/import', () => {
    const st = () => useStore.getState();
    st().init();
    const text = JSON.stringify({ assessment: st().assessments[DEMO_ID] });
    const res = st().importAssessmentJson(text);
    expect(res.ok).toBe(true);
    const id = (res as { id: string }).id;
    expect(id).not.toBe(DEMO_ID);
    expect(st().assessments[id].name).toMatch(/imported/);
    expect(st().importAssessmentJson('{oops').ok).toBe(false);
    expect(st().importAssessmentJson('{"foo":1}').ok).toBe(false);
  });

  it('ids are unique', () => {
    expect(new Set(Array.from({ length: 500 }, () => uid())).size).toBe(500);
  });
});

describe('CSV exports', () => {
  const demo = createDemoAssessment();
  const res = computeResults(demo);
  const parse = (csv: string) => {
    // minimal RFC-4180 parser for the tests
    const rows: string[][] = [];
    let row: string[] = [], cur = '', q = false;
    for (let i = 0; i < csv.length; i++) {
      const c = csv[i];
      if (q) { if (c === '"' && csv[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\r') { /* skip */ } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    return rows;
  };

  it('questionnaire export contains every question with the right IDs, scores and distinct self/verified columns', () => {
    const rows = parse(questionnaireCsv(demo));
    expect(rows).toHaveLength(101);
    expect(rows.slice(1).map((r) => r[0])).toEqual(QUESTIONS.map((q) => q.id));
    const h = rows[0];
    const row = rows.find((r) => r[0] === 'C06')!;
    expect(row[h.indexOf('Self-reported score (0-4)')]).toBe('3');
    expect(row[h.indexOf('Assessor-verified score (0-4)')]).toBe('1');
    expect(row[h.indexOf('Self minus verified')]).toBe('2');
    expect(row[h.indexOf('Diagnostic question')]).toBe(QUESTIONS.find((q) => q.id === 'C06')!.text);
    const na = rows.find((r) => r[0] === 'R07')!;
    expect(na[h.indexOf('Assessor status')]).toBe('Not applicable');
    expect(na[h.indexOf('Assessor-verified score (0-4)')]).toBe(''); // N/A is blank, not 0
  });

  it('escapes commas, quotes and newlines, and neutralizes spreadsheet formulas', () => {
    const csv = toCsv([['a,b', 'say "hi"', 'line1\nline2', '=SUM(A1)', '+1', '-x', '@cmd', 5, -3, null]]);
    expect(csv).toBe('"a,b","say ""hi""","line1\nline2",\'=SUM(A1),\'+1,\'-x,\'@cmd,5,-3,\r\n');
  });

  it('dimension-score export has 12 dimensions plus a total that matches the engine', () => {
    const rows = parse(dimensionScoresCsv(res));
    expect(rows).toHaveLength(14);
    expect(rows[1][1]).toBe(DIMENSIONS[0].name);
    const total = rows[13];
    expect(Number(total[11])).toBeCloseTo(Math.round(res.maturity.index! * 100) / 100, 6);
  });

  it('principal scores, indicators, recommendations and India exports reflect current results', () => {
    expect(parse(principalScoresCsv(res)).length).toBeGreaterThan(20);
    const ind = parse(indicatorsCsv(demo, res));
    expect(ind).toHaveLength(16);
    expect(ind[1][0]).toBe('AI spending intensity');
    expect(Number(ind[1][6])).toBeCloseTo(7.5, 6);
    expect(parse(recommendationsCsv(res))).toHaveLength(res.recommendations.length + 1);
    expect(parse(indiaCsv(demo, res)).length).toBeGreaterThan(11);
  });

  it('builds safe filenames', () => {
    expect(exportFilename(demo, 'questionnaire', 'csv')).toMatch(/^bharat-prime-financial-services-ltd_questionnaire_\d{8}\.csv$/);
  });
});

describe('PDF report', () => {
  const demo = createDemoAssessment();
  const res = computeResults(demo);

  it('generates a multi-page PDF from the current assessment results', () => {
    const doc = buildReportPdf(demo, res, { compress: false, generatedAt: new Date('2026-10-09T10:00:00Z') });
    const buf = doc.output('arraybuffer');
    const head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 5));
    expect(head).toBe('%PDF-');
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(10);
    const text = new TextDecoder('latin1').decode(new Uint8Array(buf));
    expect(text).toContain('Bharat Prime Financial Services Ltd \\(fictional\\)');
    expect(text).toContain(res.maturity.index!.toFixed(1));
    expect(text).toContain(res.risk.score!.toFixed(1));
    expect(text).toContain('ILLUSTRATIVE DEMONSTRATION');
    expect(text).toContain('Roadmap');
    expect(text).toContain('Scoring methodology and limitations');
    expect(text).toContain('not a legal opinion');
  });

  it('changes when the assessment changes (not a static template)', () => {
    const a2 = JSON.parse(JSON.stringify(demo)) as typeof demo;
    for (const q of QUESTIONS) a2.responses[q.id].verified = { state: 'scored', score: 4, at: null };
    const r2 = computeResults(a2);
    const text = new TextDecoder('latin1').decode(new Uint8Array(buildReportPdf(a2, r2, { compress: false }).output('arraybuffer')));
    expect(text).toContain('100.0');
    expect(text).toContain('AI Leading');
  });

  it('handles a blank assessment without throwing or inventing scores', () => {
    const blank = createAssessment({ name: 'Blank', profile: { organizationName: 'Blank Co' } });
    const doc = buildReportPdf(blank, computeResults(blank), { compress: false });
    const text = new TextDecoder('latin1').decode(new Uint8Array(doc.output('arraybuffer')));
    expect(text).toContain('no AI Maturity Index can be reported');
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(8);
  });
});

describe('benchmarking dataset', () => {
  const recs = generateSyntheticBenchmarks();
  it('is deterministic, labelled synthetic, and internally consistent with the weights', () => {
    expect(recs).toHaveLength(360);
    expect(generateSyntheticBenchmarks()).toEqual(recs);
    expect(recs.every((r) => r.source === 'synthetic_demo')).toBe(true);
    for (const r of recs.slice(0, 40)) {
      const idx = DIMENSIONS.reduce((s, d, i) => s + (d.weight * r.dimensionScores[i]) / 100, 0);
      expect(r.maturityIndex).toBeCloseTo(idx, 1);
    }
  });
  it('filters by sector, type, size, period and classification without pooling', () => {
    const bfsi = applyFilters(recs, { ...EMPTY_FILTERS, sector: 'Banking & Financial Services' });
    expect(bfsi.length).toBeGreaterThan(10);
    expect(bfsi.every((r) => r.sector === 'Banking & Financial Services')).toBe(true);
    const cls = applyFilters(recs, { ...EMPTY_FILTERS, classification: 'emerging' });
    expect(cls.every((r) => r.maturityIndex > 40 && r.maturityIndex <= 60)).toBe(true);
    const d = distribution(bfsi.map((r) => r.maturityIndex));
    expect(d.n).toBe(bfsi.length);
    expect(d.p25!).toBeLessThanOrEqual(d.median!);
    expect(d.median!).toBeLessThanOrEqual(d.p75!);
    expect(distribution([]).median).toBeNull();
    expect(percentileRank([10, 20, 30], 20)).toBe(50);
  });
  it('excludes demo, draft and incompletely scored assessments from the local source — with reasons', () => {
    const blank = createAssessment({ name: 'Blank' });
    blank.status = 'in_progress';
    const { records, excluded } = localBenchmarkRecords([createDemoAssessment(), blank]);
    expect(records).toHaveLength(0);
    expect(excluded).toHaveLength(2);
  });
});

describe('storage fallback when the browser blocks localStorage', () => {
  it('keeps working in memory for the session and reports the mode', async () => {
    const { vi } = await import('vitest');
    const { storageMode } = await import('./storage');
    const blocked = { getItem() { throw new DOMException('denied', 'SecurityError'); }, setItem() { throw new DOMException('denied', 'SecurityError'); }, removeItem() { throw new DOMException('denied', 'SecurityError'); } };
    vi.stubGlobal('localStorage', blocked);
    try {
      expect(storageMode()).toBe('memory');
      expect(loadState()).toEqual({ state: null, warnings: [] }); // first launch in memory, no spurious warning
      const a = createDemoAssessment();
      const saved = saveState({ assessments: [a], currentId: a.id, assessor: { name: 'M', role: 'R', firm: 'F' }, externalBenchmarks: [], externalMeta: null });
      expect(saved.ok).toBe(true); // survives within the page session
      expect(loadState().state!.assessments[0].id).toBe(a.id);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(storageMode()).toBe('local');
  });
});
