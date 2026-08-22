import { describe, expect, it } from 'vitest';
import {
  buildCurrentStudentStatusCounts,
  buildGenderCounts,
  buildStudentsPerClassCounts,
  findUnevaluatedStudents,
} from './reportStudentCharts';

describe('report student chart populations', () => {
  it('keeps the current-status chart on the same denominator as the KPI', () => {
    const counts = buildCurrentStudentStatusCounts({
      learning: 7,
      trial: 2,
      onLeave: 1,
      total: 10,
    });

    expect(counts.learning + counts.trial + counts.onLeave).toBe(counts.total);
    expect(counts).not.toHaveProperty('dropped');
  });

  it('preserves students outside visible classes in an explicit bucket', () => {
    const distribution = buildStudentsPerClassCounts(
      [
        { id: 'a', classId: 'class-a' },
        { id: 'b', classId: 'archived-class' },
        { id: 'c', classId: '' },
      ],
      [{ id: 'class-a', name: 'Class A' }]
    );

    expect(distribution.perClass).toEqual([{ classId: 'class-a', label: 'Class A', value: 1 }]);
    expect(distribution.outsideVisibleClasses).toBe(2);
    expect(distribution.total).toBe(3);
  });

  it('puts every non-canonical or missing gender in the other bucket', () => {
    const counts = buildGenderCounts([
      { gender: 'male' },
      { gender: 'female' },
      { gender: 'other' },
      { gender: 'unknown-legacy-value' },
      {},
    ]);

    expect(counts).toEqual({ male: 1, female: 1, other: 3, total: 5 });
  });

  it('returns students missing from every evaluated category', () => {
    const students = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    expect(findUnevaluatedStudents(students, new Set(['a', 'c']))).toEqual([{ id: 'b' }]);
  });
});
