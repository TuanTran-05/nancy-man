import { describe, expect, it, vi } from 'vitest';
import { readAssignments } from './readers.js';

function documentStoreDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

describe('readAssignments submission visibility', () => {
  it('omits soft-deleted submissions before projecting the assignments response', async () => {
    const assignments = [documentStoreDoc('assignment-1', { title: 'Visible assignment' })];
    const submissions = [
      documentStoreDoc('active-graded', { status: 'graded', grade: 90, isDeleted: false }),
      documentStoreDoc('deleted-graded', { status: 'graded', grade: 40, isDeleted: true }),
    ];
    const db = {
      collection: vi.fn((name: string) => ({
        limit: () => ({
          get: vi.fn().mockResolvedValue({
            docs: name === 'assignments' ? assignments : submissions,
          }),
        }),
      })),
    };

    const result = await readAssignments(
      db as never,
      { uid: 'admin-1', role: 'admin' } as never,
      { query: { limit: '200' } } as never
    );

    expect(result.submissions.map((submission) => submission.id)).toEqual(['active-graded']);
  });

  it('serves the directory GPA view without reading assignments or returning ungraded rows', async () => {
    const assignmentGet = vi.fn().mockResolvedValue({ docs: [] });
    const submissionGet = vi.fn().mockResolvedValue({
      docs: [
        documentStoreDoc('graded-1', { status: 'graded', grade: 9 }),
        documentStoreDoc('submitted-1', { status: 'submitted' }),
        documentStoreDoc('deleted-graded', { status: 'graded', isDeleted: true }),
      ],
    });
    const db = {
      collection: vi.fn((name: string) => ({
        limit: () => ({
          get: name === 'assignments' ? assignmentGet : submissionGet,
        }),
      })),
    };

    const result = await readAssignments(
      db as never,
      { uid: 'admin-1', role: 'admin' } as never,
      { query: { limit: '2000', view: 'graded-submissions' } } as never
    );

    expect(assignmentGet).not.toHaveBeenCalled();
    expect(submissionGet).toHaveBeenCalledOnce();
    expect(result.assignments).toEqual([]);
    expect(result.submissions.map((submission) => submission.id)).toEqual(['graded-1']);
  });
});
