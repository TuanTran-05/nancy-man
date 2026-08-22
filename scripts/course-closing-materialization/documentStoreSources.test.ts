import { describe, expect, it } from 'vitest';
import { loadCourseClosingMaterializationSources } from './documentStoreSources.js';

function fakeDb(collections: Record<string, Array<{ id: string; data: Record<string, unknown> }>>) {
  return {
    collection: (name: string) => {
      const query = {
        select: () => query,
        get: async () => ({
          docs: (collections[name] || []).map((entry) => ({
            id: entry.id,
            data: () => entry.data,
          })),
        }),
      };
      return query;
    },
  } as any;
}

describe('loadCourseClosingMaterializationSources', () => {
  it('loads records and only relevant sent notification evidence', async () => {
    const result = await loadCourseClosingMaterializationSources(
      fakeDb({
        course_closing_records: [
          {
            id: 'record-1',
            data: {
              courseId: 'course-1',
              studentId: 'student-1',
            },
          },
        ],
        zalo_notifications: [
          {
            id: 'tuition-sent',
            data: { status: 'sent', type: 'tuition_notice', courseId: 'course-1' },
          },
          {
            id: 'evaluation-sent',
            data: { status: 'sent', type: 'evaluation_notice', courseId: 'course-1' },
          },
          {
            id: 'tuition-failed',
            data: { status: 'failed', type: 'tuition_notice', courseId: 'course-1' },
          },
          {
            id: 'unrelated',
            data: { status: 'sent', type: 'attendance_notice', courseId: 'course-1' },
          },
        ],
        course_fee_ledgers: [
          {
            id: 'ledger-1',
            data: { courseId: 'course-1', studentId: 'student-1' },
          },
        ],
      })
    );

    expect(result.records[0].id).toBe('record-1');
    expect(result.notifications.map((entry) => entry.id)).toEqual([
      'tuition-sent',
      'evaluation-sent',
    ]);
    expect(result.ledgers.map((entry) => entry.id)).toEqual(['ledger-1']);
  });
});
