import { describe, it, expect } from 'vitest';
import { buildReportStudentScope } from './reportStudentScope';

type Row = {
  id: string;
  name: string;
  dob: string;
  classId?: string;
  studentLifecycle?: string;
  enrollmentStatus?: string;
  placementStatus?: string;
};

const student = (id: string, overrides: Partial<Row> = {}): Row => ({
  id,
  name: `Student ${id}`,
  dob: '2015-01-01',
  classId: 'class-a',
  studentLifecycle: 'enrolled',
  enrollmentStatus: 'active',
  ...overrides,
});

describe('buildReportStudentScope', () => {
  it('counts the whole roster regardless of which class a student sits in', () => {
    const scope = buildReportStudentScope([
      student('a'),
      student('b', { name: 'Student b', classId: 'archived-class' }),
      student('c', { name: 'Student c', classId: undefined }),
    ]);

    expect(scope.total).toBe(3);
    expect(scope.roster).toHaveLength(3);
  });

  it('limits the roster and historical status counts to the requested class', () => {
    const scope = buildReportStudentScope(
      [
        student('a', { classId: 'class-a' }),
        student('b', { name: 'Student b', classId: 'class-b' }),
        student('c', {
          name: 'Student c',
          classId: 'class-b',
          enrollmentStatus: 'dropped',
        }),
      ],
      'class-a'
    );

    expect(scope.roster.map((row) => row.id)).toEqual(['a']);
    expect(scope.total).toBe(1);
    expect(scope.dropped).toBe(0);
  });

  it('collapses duplicate identity records instead of double counting them', () => {
    // The same child: an old promoted record plus the current enrolled record.
    const history = student('old', { name: 'Le Van A', enrollmentStatus: 'promoted' });
    const current = student('new', { name: 'Le Van A' });

    const scope = buildReportStudentScope([history, current]);

    expect(scope.total).toBe(1);
    expect(scope.roster[0].id).toBe('new');
  });

  it('excludes archived, dropped and promoted records from the headcount', () => {
    const scope = buildReportStudentScope([
      student('a'),
      student('b', { name: 'Student b', studentLifecycle: 'archived' }),
      student('c', { name: 'Student c', enrollmentStatus: 'dropped' }),
      student('d', { name: 'Student d', enrollmentStatus: 'promoted' }),
    ]);

    expect(scope.total).toBe(1);
  });

  it('uses canonical placement status instead of a stale active projection', () => {
    const scope = buildReportStudentScope([
      student('a'),
      student('b', {
        name: 'Student b',
        enrollmentStatus: 'active',
        placementStatus: 'inactive',
      }),
      student('c', {
        name: 'Student c',
        enrollmentStatus: 'active',
        placementStatus: 'waiting_for_placement',
      }),
    ]);

    expect(scope.roster.map((row) => row.id)).toEqual(['a']);
    expect(scope.learning + scope.trial + scope.onLeave).toBe(scope.total);
  });

  it('splits the roster into learning / trial / on leave so the parts sum to the total', () => {
    const scope = buildReportStudentScope([
      student('a'),
      student('b', { name: 'Student b' }),
      student('c', { name: 'Student c', enrollmentStatus: 'on_leave' }),
      student('d', { name: 'Student d', studentLifecycle: 'trial' }),
    ]);

    expect(scope.learning).toBe(2);
    expect(scope.trial).toBe(1);
    expect(scope.onLeave).toBe(1);
    expect(scope.learning + scope.trial + scope.onLeave).toBe(scope.total);
  });

  it('still reports dropped students for the status breakdown', () => {
    const scope = buildReportStudentScope([
      student('a'),
      student('b', { name: 'Student b', enrollmentStatus: 'dropped' }),
    ]);

    expect(scope.total).toBe(1);
    expect(scope.dropped).toBe(1);
  });

  describe('studentIds', () => {
    it('matches the roster so per-student rows share the headcount population', () => {
      const scope = buildReportStudentScope([
        student('a'),
        student('b', { name: 'Student b', classId: 'archived-class' }),
      ]);

      expect(scope.studentIds).toEqual(new Set(['a', 'b']));
      expect(scope.studentIds.size).toBe(scope.total);
    });

    it('drops the superseded record so its attendance is not counted twice', () => {
      const history = student('old', { name: 'Le Van A', enrollmentStatus: 'promoted' });
      const current = student('new', { name: 'Le Van A' });
      const scope = buildReportStudentScope([history, current]);

      const attendance = [
        { studentId: 'old', status: 'absent' },
        { studentId: 'new', status: 'present' },
      ];
      const scoped = attendance.filter((row) => scope.studentIds.has(row.studentId));

      expect(scoped).toEqual([{ studentId: 'new', status: 'present' }]);
    });

    it('excludes rows belonging to dropped students', () => {
      const scope = buildReportStudentScope([
        student('a'),
        student('b', { name: 'Student b', enrollmentStatus: 'dropped' }),
      ]);

      expect(scope.studentIds.has('a')).toBe(true);
      expect(scope.studentIds.has('b')).toBe(false);
    });
  });
});
