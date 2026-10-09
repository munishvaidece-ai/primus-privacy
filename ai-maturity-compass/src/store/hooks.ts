import { useMemo } from 'react';
import type { Assessment } from '../domain/schema';
import { computeResults, type AssessmentResults } from '../scoring/results';
import { useStore } from './store';

export function useCurrent(): Assessment | null {
  return useStore((s) => (s.currentId ? s.assessments[s.currentId] ?? null : null));
}

/** Results for the current assessment, recomputed whenever its data changes. */
export function useResults(a: Assessment | null): AssessmentResults | null {
  return useMemo(() => (a ? computeResults(a) : null), [a]);
}

export const isEditable = (a: Assessment | null): boolean => !!a && a.status !== 'submitted';
