import { describe, expect, it } from 'vitest';

import { classifyMutationSql } from './mutationClassification.js';

describe('classifyMutationSql', () => {
  it('classifies one direct DML statement and marks unbounded writes as critical', () => {
    expect(
      classifyMutationSql("INSERT INTO public.students (id, name) VALUES ('1', 'An')")
    ).toEqual({
      allowed: true,
      kind: 'insert',
      requiresTypedConfirmation: false
    });
    expect(classifyMutationSql("UPDATE public.students SET name = 'An' WHERE id = '1'")).toEqual({
      allowed: true,
      kind: 'update',
      requiresTypedConfirmation: false
    });
    expect(classifyMutationSql('DELETE FROM public.students')).toEqual({
      allowed: true,
      kind: 'delete',
      requiresTypedConfirmation: true
    });
  });

  it('rejects reads, transaction controls, DDL, CTE writes and statement batches', () => {
    for (const sql of [
      'SELECT * FROM public.students',
      'BEGIN; DELETE FROM public.students',
      'TRUNCATE public.students',
      'ALTER TABLE public.students ADD COLUMN emergency_note text',
      'WITH deleted AS (DELETE FROM public.students RETURNING *) SELECT * FROM deleted',
      "UPDATE public.students SET name = 'An'; DELETE FROM public.students"
    ]) {
      expect(classifyMutationSql(sql)).toEqual({ allowed: false, code: 'SQL_DML_REQUIRED' });
    }
  });
});
