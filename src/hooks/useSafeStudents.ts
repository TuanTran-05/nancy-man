import { useCallback, useEffect, useState } from 'react';
import type { SafeStudent } from '../types';
import { readAllStudentPages } from '../lib/api/readApi';

export type StudentReadView =
  | 'identity'
  | 'index'
  | 'academic'
  | 'directory'
  | 'finance'
  | 'session'
  | 'attendance';

type StudentReadParams = Record<string, string | number | boolean | undefined | null>;

function stableParamsKey(params: StudentReadParams) {
  return JSON.stringify(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

export function useSafeStudents(view: StudentReadView, params: StudentReadParams = {}) {
  const [students, setStudents] = useState<SafeStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const paramsKey = stableParamsKey(params);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const students = await readAllStudentPages<SafeStudent>({ view, ...params });
      setStudents(students);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Student read failed'));
    } finally {
      setLoading(false);
    }
  }, [view, paramsKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { students, loading, error, reload };
}
