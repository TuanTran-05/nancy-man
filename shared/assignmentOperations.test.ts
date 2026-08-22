import { describe, expect, it } from 'vitest';
import { buildAssignmentProgressSummary } from './assignmentOperations';

describe('assignment operations summary', () => {
  it('counts target, submitted, graded, missing, late, and pending manual grading', () => {
    const summary = buildAssignmentProgressSummary({
      now: new Date('2026-06-13T10:00:00.000Z'),
      dueDate: '2026-06-12T10:00:00.000Z',
      targetStudents: [
        { id: 'student-1', name: 'Student One' },
        { id: 'student-2', name: 'Student Two' },
        { id: 'student-3', name: 'Student Three' },
      ],
      submissions: [
        {
          id: 'sub-1',
          studentId: 'student-1',
          studentName: 'Student One',
          status: 'graded',
          submittedAt: '2026-06-12T09:00:00.000Z',
          grade: 9,
          assessmentScore: null,
        },
        {
          id: 'sub-2',
          studentId: 'student-2',
          studentName: 'Student Two',
          status: 'submitted',
          submittedAt: '2026-06-12T11:00:00.000Z',
          grade: null,
          assessmentScore: { canAutoGradeAll: false },
        },
      ],
    });

    expect(summary.counts).toEqual({
      target: 3,
      submitted: 2,
      graded: 1,
      missing: 1,
      late: 1,
      pendingManual: 1,
    });
    expect(summary.missingStudents).toEqual([{ id: 'student-3', name: 'Student Three' }]);
    expect(summary.manualGradingQueue).toEqual([expect.objectContaining({ id: 'sub-2' })]);
  });

  it('ignores submissions from students outside the target list', () => {
    const summary = buildAssignmentProgressSummary({
      now: new Date('2026-06-13T10:00:00.000Z'),
      dueDate: '2026-06-12T10:00:00.000Z',
      targetStudents: [{ id: 'student-1', name: 'Student One' }],
      submissions: [
        {
          id: 'sub-1',
          studentId: 'student-1',
          studentName: 'Student One',
          status: 'graded',
          submittedAt: '2026-06-12T09:00:00.000Z',
          grade: 9,
          assessmentScore: null,
        },
        {
          id: 'sub-2',
          studentId: 'student-outside-target',
          studentName: 'Outside Target',
          status: 'submitted',
          submittedAt: '2026-06-12T11:00:00.000Z',
          grade: null,
          assessmentScore: { canAutoGradeAll: false },
        },
      ],
    });

    expect(summary.counts).toEqual({
      target: 1,
      submitted: 1,
      graded: 1,
      missing: 0,
      late: 0,
      pendingManual: 0,
    });
    expect(summary.manualGradingQueue).toEqual([]);
    expect(summary.lateSubmissions).toEqual([]);
  });
});
