import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './apiClient';
import { standardizeStudentIdsInBatches } from './studentAdminApi';

vi.mock('./apiClient', () => ({
  apiRequest: vi.fn(),
}));

describe('standardizeStudentIdsInBatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The server now plans a page before it will touch anything -- a bulk
   * rename is an identity change across many humans, so nothing happens until
   * the exact set of profiles it covers has been read back. The client has
   * to confirm that plan (by its digest) in a second call before the page's
   * writes land; skipping the confirm call is the bug this test guards
   * against, since it would leave the button reporting success while
   * renaming nobody.
   */
  it("confirms each page's plan before moving to the next cursor", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        success: true,
        mode: 'plan',
        planDigest: 'digest-1',
        plan: [{ id: 'stu-1', from: 'LEGACY-1' }],
        processed: 2,
        updated: 0,
        candidates: 1,
        skipped: 1,
        cursor: 'stu-2',
        hasMore: true,
        batchSize: 2,
      })
      .mockResolvedValueOnce({
        success: true,
        mode: 'applied',
        planDigest: 'digest-1',
        processed: 2,
        updated: 1,
        candidates: 1,
        skipped: 1,
        cursor: 'stu-2',
        hasMore: true,
        batchSize: 2,
      })
      .mockResolvedValueOnce({
        success: true,
        mode: 'plan',
        planDigest: 'digest-2',
        plan: [],
        processed: 2,
        updated: 0,
        candidates: 0,
        skipped: 2,
        cursor: 'stu-4',
        hasMore: false,
        batchSize: 2,
      });

    const progress = vi.fn();
    const result = await standardizeStudentIdsInBatches({ batchSize: 2, onProgress: progress });

    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/v1/students/standardize-student-ids', {
      method: 'POST',
      body: { batchSize: 2 },
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/students/standardize-student-ids', {
      method: 'POST',
      body: { batchSize: 2, apply: true, confirmPlanDigest: 'digest-1' },
    });
    // The second page has no candidates, so it is never confirmed -- a plan
    // call with nothing to rename is the final word on that page.
    expect(apiRequest).toHaveBeenNthCalledWith(3, '/api/v1/students/standardize-student-ids', {
      method: 'POST',
      body: { batchSize: 2, cursor: 'stu-2' },
    });
    expect(apiRequest).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ batches: 2, processed: 4, updated: 1, hasMore: false })
    );
    expect(result).toEqual({
      success: true,
      processed: 4,
      updated: 1,
      skipped: 3,
      batches: 2,
    });
  });
});

describe('transferStudent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the transfer endpoint with correct arguments', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      success: true,
      rolloverBalance: 500000,
    });

    const { transferStudent } = await import('./studentAdminApi');
    const result = await transferStudent('student-1', 'class-2');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/students/transfer', {
      method: 'POST',
      body: { id: 'student-1', targetClassId: 'class-2' },
    });
    expect(result).toEqual({
      success: true,
      rolloverBalance: 500000,
    });
  });
});

describe('updateStudentCourseEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts the validated correction payload to the server-only endpoint', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ success: true });
    const { updateStudentCourseEnrollment } = await import('./studentAdminApi');
    await updateStudentCourseEnrollment({
      enrollmentId: 'enrollment-1',
      status: 'on_leave',
      joinedAt: '2026-07-03',
      endedAt: null,
      statusReason: 'Family leave',
    });

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/students/course-enrollment', {
      method: 'POST',
      body: {
        enrollmentId: 'enrollment-1',
        status: 'on_leave',
        joinedAt: '2026-07-03',
        endedAt: null,
        statusReason: 'Family leave',
      },
    });
  });
});
