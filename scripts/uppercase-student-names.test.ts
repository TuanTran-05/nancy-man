import { describe, expect, it } from 'vitest';
import { planUppercaseStudentNames } from './uppercase-student-names';

describe('planUppercaseStudentNames', () => {
  it('uppercases mixed-case Vietnamese names and preserves diacritics', () => {
    const plan = planUppercaseStudentNames([
      { id: 'student-1', data: { name: 'Nguyễn văn An' } },
    ]);

    expect(plan.operations).toEqual([
      { studentDocId: 'student-1', before: 'Nguyễn văn An', after: 'NGUYỄN VĂN AN' },
    ]);
  });

  it('collapses stray whitespace while formatting', () => {
    const plan = planUppercaseStudentNames([
      { id: 'student-2', data: { name: '  Tran   Thi   Bich  ' } },
    ]);

    expect(plan.operations).toEqual([
      { studentDocId: 'student-2', before: '  Tran   Thi   Bich  ', after: 'TRAN THI BICH' },
    ]);
  });

  it('leaves already-uppercase names unchanged', () => {
    const plan = planUppercaseStudentNames([{ id: 'student-3', data: { name: 'LE VAN CUONG' } }]);

    expect(plan.operations).toEqual([]);
    expect(plan.unchangedCount).toBe(1);
  });

  it('skips students with no name on record', () => {
    const plan = planUppercaseStudentNames([{ id: 'student-4', data: {} }]);

    expect(plan.operations).toEqual([]);
    expect(plan.unchangedCount).toBe(1);
  });
});
