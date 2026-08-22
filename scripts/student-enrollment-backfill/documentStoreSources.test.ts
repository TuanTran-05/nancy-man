import { describe, expect, it } from 'vitest';
import type { DocumentStore } from '@/server/db/documentStore.js';
import { makeStudentCourseEnrollmentId } from '../../shared/studentCourseEnrollment.js';
import { loadSafeEnrollmentSources } from './documentStoreSources.js';

type FakeDoc = {
  id: string;
  value: Record<string, unknown>;
  updateTime?: string;
};

function fakeDocumentStore(collections: Record<string, FakeDoc[]>): {
  db: DocumentStore;
  reads: string[];
} {
  const reads: string[] = [];
  const db = {
    collection(name: string) {
      return {
        async get() {
          reads.push(name);
          return {
            docs: (collections[name] || []).map((doc) => ({
              id: doc.id,
              data: () => structuredClone(doc.value),
              updateTime: doc.updateTime ? { toDate: () => new Date(doc.updateTime!) } : undefined,
            })),
          };
        },
      };
    },
  };
  return { db: db as unknown as DocumentStore, reads };
}

function validEnrollment(studentId: string, classId: string, termStart: string) {
  const timestamp = '2026-08-01T02:00:00.000Z';
  return {
    studentId,
    classId,
    termStart,
    termEnd: '2026-08-31',
    status: 'active',
    joinedAt: termStart,
    endedAt: null,
    statusReason: null,
    source: 'manual',
    confidence: 'confirmed',
    statusChangedAt: timestamp,
    statusChangedBy: 'office-user',
    confirmedAt: timestamp,
    confirmedBy: 'office-user',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('safe enrollment DocumentStore sources', () => {
  it('loads exactly the three required collections and groups validated enrollments', async () => {
    const enrollmentId = makeStudentCourseEnrollmentId('student-1', 'class-1', '2026-08-01');
    const { db, reads } = fakeDocumentStore({
      students: [
        { id: 'student-z', value: { classId: 'class-1' }, updateTime: '2026-08-01T01:00:02.000Z' },
        { id: 'student-1', value: { classId: 'class-1' }, updateTime: '2026-08-01T01:00:01.000Z' },
      ],
      classes: [
        {
          id: 'class-1',
          value: { startDate: '2026-08-01' },
          updateTime: '2026-08-01T01:00:00.000Z',
        },
      ],
      student_course_enrollments: [
        {
          id: enrollmentId,
          value: validEnrollment('student-1', 'class-1', '2026-08-01'),
          updateTime: '2026-08-01T02:00:00.000Z',
        },
      ],
    });

    const result = await loadSafeEnrollmentSources(db);

    expect([...reads].sort()).toEqual(['classes', 'student_course_enrollments', 'students']);
    expect(result.summary).toEqual({ students: 2, classes: 1, enrollments: 1 });
    expect(result.sources.students.map((doc) => doc.id)).toEqual(['student-1', 'student-z']);
    expect(result.sources.students[0].updateTime).toBe('2026-08-01T01:00:01.000Z');
    expect(result.sources.existingByStudent.get('student-1')).toEqual([
      expect.objectContaining({ id: enrollmentId, studentId: 'student-1', status: 'active' }),
    ]);
  });

  it('rejects a malformed stored enrollment instead of treating the student as empty', async () => {
    const { db } = fakeDocumentStore({
      students: [{ id: 'student-1', value: { classId: 'class-1' } }],
      classes: [{ id: 'class-1', value: { startDate: '2026-08-01' } }],
      student_course_enrollments: [
        {
          id: 'broken-enrollment',
          value: { studentId: 'student-1', classId: 'class-1', status: 'active' },
        },
      ],
    });

    await expect(loadSafeEnrollmentSources(db)).rejects.toThrow(
      'SAFE_ENROLLMENT_STORED_RECORD_INVALID:broken-enrollment'
    );
  });
});
