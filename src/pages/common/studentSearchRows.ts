import type { SafeStudent, Student } from '../../types';
import { expandWithSiblings } from '../../../shared/siblingScholarship';
import {
  matchesStudentStatusFilter,
  type StudentStatusFilter,
} from '../../lib/student/statusFilters';

export const getStudentDisplayName = (
  student: Pick<Student, 'name' | 'studentId' | 'code' | 'id'>
) => {
  const name = typeof student.name === 'string' ? student.name.trim() : '';
  return name || student.studentId || student.code || student.id || 'N/A';
};

export function buildStudentSearchRows(
  students: readonly SafeStudent[],
  input: { searchTerm: string; filterClass: string; filterStatus: StudentStatusFilter }
) {
  const pool = students.filter(
    (student) =>
      (input.filterClass === 'all' || student.classId === input.filterClass) &&
      matchesStudentStatusFilter(student, input.filterStatus)
  );
  const needle = input.searchTerm.trim().toLowerCase();
  const direct = needle
    ? pool.filter((student) =>
        [getStudentDisplayName(student), student.studentId, student.code, student.contact]
          .filter((value): value is string => typeof value === 'string')
          .some((value) => value.toLowerCase().includes(needle))
      )
    : pool;
  return {
    pool,
    rows: needle
      ? expandWithSiblings(direct, pool)
      : direct.map((student) => ({ student, matchKind: 'direct' as const })),
  };
}
