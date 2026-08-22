// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseClosingSnapshot } from '../../../../shared/courseClosing';
import { apiRequest } from '../../../lib/api/apiClient';
import { useInvalidationRefresh } from '../../../hooks/useInvalidationRefresh';
import { useCourseClosing } from './useCourseClosing';

let invalidationHandler: (() => void | Promise<void>) | undefined;

vi.mock('../../../hooks/useInvalidationRefresh', () => ({
  useInvalidationRefresh: vi.fn((options) => {
    invalidationHandler = options.onInvalidate;
  }),
}));

vi.mock('../../../lib/api/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api/apiClient')>();
  return { ...actual, apiRequest: vi.fn() };
});

function snapshot(status: CourseClosingSnapshot['status'] = 'ready_for_approval') {
  return {
    courseId: 'course-1',
    status,
    approvalValid: status === 'approved',
    requiredStudentCount: 1,
    finalEvaluationCount: 1,
    evaluationSentCount: 0,
    rankRequiredCount: 0,
    rankSentCount: 0,
    tuitionSentCount: 0,
    exemptStudentCount: 0,
    missingEvaluationStudentIds: [],
    pendingEvaluationStudentIds: ['student-1'],
    pendingRankStudentIds: [],
    pendingTuitionStudentIds: ['student-1'],
    lockedEvaluationIds: [],
    exemptions: [],
  } as CourseClosingSnapshot;
}

describe('useCourseClosing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidationHandler = undefined;
    vi.mocked(apiRequest).mockResolvedValue({ success: true, courseClosing: snapshot() });
  });

  it('loads canonical status and exposes refresh through the HTTP invalidation channel', async () => {
    const { result } = renderHook(() => useCourseClosing('class-1'));

    await waitFor(() => expect(result.current.snapshot?.status).toBe('ready_for_approval'));
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(useInvalidationRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ channelKey: 'course-closing:class-1', enabled: true })
    );

    await act(async () => {
      await invalidationHandler?.();
    });
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('posts a trimmed Admin reason and replaces the local snapshot', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true, courseClosing: snapshot() })
      .mockResolvedValueOnce({ success: true, courseClosing: snapshot('approved') });
    const { result } = renderHook(() => useCourseClosing('class-1'));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    await act(async () => {
      await result.current.approve('  Admin reviewed  ');
    });

    expect(apiRequest).toHaveBeenLastCalledWith('/api/v1/classes/approve-course-closing', {
      method: 'POST',
      body: { classId: 'class-1', reason: 'Admin reviewed' },
    });
    expect(result.current.snapshot?.status).toBe('approved');
  });
});
