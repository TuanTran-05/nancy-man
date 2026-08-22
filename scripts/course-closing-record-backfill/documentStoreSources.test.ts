import { describe, expect, it, vi } from 'vitest';
import { loadCourseClosingBackfillSources } from './documentStoreSources.js';

function doc(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
    updateTime: {
      toDate: () => new Date('2026-07-18T08:00:00.000Z'),
    },
  };
}

function makeDocumentStoreStub(collections: Record<string, Array<ReturnType<typeof doc>> | Error>) {
  const selectedFields: Record<string, string[]> = {};
  const collection = vi.fn((name: string) => {
    const get = vi.fn(async () => {
      const value = collections[name] || [];
      if (value instanceof Error) throw value;
      return { docs: value, size: value.length };
    });
    return {
      get,
      select: vi.fn((...fields: string[]) => {
        selectedFields[name] = fields;
        return { get };
      }),
    };
  });
  return {
    collection,
    batch: vi.fn(),
    runTransaction: vi.fn(),
    selectedFields,
  };
}

describe('loadCourseClosingBackfillSources', () => {
  it('projects minimal source fields and omits sensitive values', async () => {
    const db = makeDocumentStoreStub({
      students: [
        doc('student-1', {
          classId: 'class-1',
          name: 'Nguyễn Văn An',
          code: 'HV001',
          phone: '0900000000',
          email: 'an@example.com',
          password: 'secret',
        }),
      ],
      evaluations: [
        doc('evaluation-1', {
          classId: 'class-1',
          studentId: 'student-1',
          evaluationType: 'final',
          date: '2026-07-18',
          totalScore: 84,
          privateNote: 'not-for-report',
        }),
      ],
      student_course_enrollments: [
        doc('enrollment-1', {
          studentId: 'student-1',
          classId: 'class-1',
          termStart: '2026-03-18',
          termEnd: '2026-07-18',
          status: 'completed',
          privateNote: 'not-for-report',
        }),
      ],
    });

    const { sources, summary } = await loadCourseClosingBackfillSources(db as never);

    expect(sources.students[0].data).toEqual({
      classId: 'class-1',
      name: 'Nguyễn Văn An',
      code: 'HV001',
    });
    expect(sources.evaluations[0]).toMatchObject({
      id: 'evaluation-1',
      updateTime: '2026-07-18T08:00:00.000Z',
      data: {
        classId: 'class-1',
        studentId: 'student-1',
        evaluationType: 'final',
        date: '2026-07-18',
        totalScore: 84,
      },
    });
    expect(summary).toMatchObject({ students: 1, evaluations: 1 });
    expect(sources.enrollments[0].data).toEqual({
      studentId: 'student-1',
      classId: 'class-1',
      termStart: '2026-03-18',
      termEnd: '2026-07-18',
      status: 'completed',
    });
    expect(db.selectedFields.students).toEqual(expect.arrayContaining(['classId', 'name', 'code']));
    expect(db.selectedFields.users).toEqual(expect.arrayContaining(['displayName', 'name']));
    expect(JSON.stringify(sources)).not.toMatch(/0900000000|an@example\.com|secret|not-for-report/);
    expect(db.batch).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  it('rejects the whole load when one source collection fails', async () => {
    const db = makeDocumentStoreStub({
      evaluations: new Error('evaluation read failed'),
    });

    await expect(loadCourseClosingBackfillSources(db as never)).rejects.toThrow(
      'evaluation read failed'
    );
  });
});
