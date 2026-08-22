import { describe, expect, it } from 'vitest';

import { getClassSortGrade, sortClassesByStatusGradeName } from './sortClasses';

describe('sortClassesByStatusGradeName', () => {
  it('sorts active classes first, paused classes next, and archived classes last by grade', () => {
    const classes = [
      { id: 'archived-6', name: 'Advanced 6', status: 'archived' },
      { id: 'paused-7', name: 'Advanced 7', status: 'paused' },
      { id: 'active-7', name: 'Advanced 7', status: 'active' },
      { id: 'active-6', name: 'Advance 6', status: 'active' },
      { id: 'paused-6', name: 'Advance 6', status: 'paused' },
      { id: 'archived-5', name: 'G5-CS2', status: 'archived' },
    ];

    expect(sortClassesByStatusGradeName(classes).map((classInfo) => classInfo.id)).toEqual([
      'active-6',
      'active-7',
      'paused-6',
      'paused-7',
      'archived-5',
      'archived-6',
    ]);
  });

  it('uses explicit grade before falling back to the class name', () => {
    const classes = [
      { id: 'grade-7', name: 'G9', grade: 7, status: 'active' },
      { id: 'grade-6', name: 'Advanced 8', grade: 6, status: 'active' },
    ];

    expect(sortClassesByStatusGradeName(classes).map((classInfo) => classInfo.id)).toEqual([
      'grade-6',
      'grade-7',
    ]);
  });

  it('allows callers to treat ended active classes as archived for display sorting', () => {
    const classes = [
      { id: 'ended', name: 'Advance 6', status: 'active' },
      { id: 'paused', name: 'Advanced 7', status: 'paused' },
      { id: 'active', name: 'Advanced 8', status: 'active' },
    ];

    expect(
      sortClassesByStatusGradeName(classes, {
        getStatus: (classInfo) => (classInfo.id === 'ended' ? 'archived' : classInfo.status),
      }).map((classInfo) => classInfo.id)
    ).toEqual(['active', 'paused', 'ended']);
  });
});

describe('getClassSortGrade', () => {
  it('parses common grade formats from class names', () => {
    expect(getClassSortGrade({ name: 'Advanced 7' })).toBe(7);
    expect(getClassSortGrade({ name: 'G5-CS2' })).toBe(5);
    expect(getClassSortGrade({ name: 'No grade' })).toBe(Number.MAX_SAFE_INTEGER);
  });
});
