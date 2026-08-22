import { describe, expect, it } from 'vitest';
import { buildStudentSearchRows } from './studentSearchRows';
import type { SafeStudent } from '../../types';

function student(overrides: Partial<SafeStudent> & { id: string }): SafeStudent {
  return {
    name: '',
    studentId: '',
    dob: '',
    contact: '',
    classId: '5A',
    teacherId: 't1',
    createdAt: '2026-01-01T00:00:00.000Z',
    code: '',
    ...overrides,
  } as SafeStudent;
}

const an = student({
  id: 'an',
  name: 'Nguyen Van An',
  studentId: 'HS001',
  classId: '5A',
  siblingGroupId: 'g1',
});
const binh = student({
  id: 'binh',
  name: 'Tran Thi Binh',
  studentId: 'HS002',
  classId: '3B',
  siblingGroupId: 'g1',
});
const khanh = student({ id: 'khanh', name: 'Le Van Khanh', studentId: 'HS003', classId: '7A' });

const baseInput = { searchTerm: '', filterClass: 'all', filterStatus: 'all' as const };

describe('buildStudentSearchRows', () => {
  it('returns a direct match followed by its sibling row', () => {
    const { rows } = buildStudentSearchRows([an, binh, khanh], {
      ...baseInput,
      searchTerm: 'HS001',
    });
    expect(rows.map((r) => [r.student.id, r.matchKind])).toEqual([
      ['an', 'direct'],
      ['binh', 'sibling'],
    ]);
  });

  it('returns both as direct when a name is shared by both siblings', () => {
    const anShared = student({ ...an, name: 'Nguyen An' });
    const binhShared = student({ ...binh, name: 'Nguyen Binh' });
    const { rows } = buildStudentSearchRows([anShared, binhShared, khanh], {
      ...baseInput,
      searchTerm: 'Nguyen',
    });
    expect(rows.map((r) => [r.student.id, r.matchKind])).toEqual([
      ['an', 'direct'],
      ['binh', 'direct'],
    ]);
  });

  it('removes a sibling excluded by the class filter', () => {
    const { rows } = buildStudentSearchRows([an, binh, khanh], {
      ...baseInput,
      searchTerm: 'An',
      filterClass: '5A',
    });
    expect(rows.map((r) => r.student.id)).toEqual(['an']);
  });

  it('returns no sibling row for an unlinked student', () => {
    const { rows } = buildStudentSearchRows([an, binh, khanh], {
      ...baseInput,
      searchTerm: 'Khanh',
    });
    expect(rows.map((r) => [r.student.id, r.matchKind])).toEqual([['khanh', 'direct']]);
  });
});
