import { describe, expect, it } from 'vitest';
import { classifyStudentLifecycleRecord } from './audit-student-lifecycle-records';

describe('classifyStudentLifecycleRecord', () => {
  it('classifies old status-change dropped records as repair candidates', () => {
    expect(
      classifyStudentLifecycleRecord({
        id: 'stu-1',
        enrollmentStatus: 'dropped',
        studentLifecycle: 'archived',
        isRevoked: true,
        deletedAt: '2026-05-20T00:00:00.000Z',
        classId: 'class-1',
        teacherId: 'teacher-1',
        statusNote: 'Left class',
      })
    ).toBe('repairable_dropped_status');
  });

  it('keeps explicit soft delete records archived', () => {
    expect(
      classifyStudentLifecycleRecord({
        id: 'stu-2',
        enrollmentStatus: 'dropped',
        studentLifecycle: 'archived',
        isRevoked: true,
        deletedAt: '2026-05-20T00:00:00.000Z',
        classId: 'class-1',
        teacherId: 'teacher-1',
        statusNote: 'Soft deleted',
      })
    ).toBe('soft_deleted');
  });

  it('keeps rejected trial history archived', () => {
    expect(
      classifyStudentLifecycleRecord({
        id: 'stu-3',
        enrollmentStatus: 'dropped',
        studentLifecycle: 'archived',
        isRevoked: true,
        archiveReason: 'trial_rejected',
      })
    ).toBe('historical_archived');
  });
});
