import { describe, expect, it, vi } from 'vitest';
import type { CourseClosingSnapshot } from '../../../../shared/courseClosing.js';
import { CourseClosingError } from '../../classes/helpers/courseClosing.js';
import { handleApiError, sendApiError } from './apiResponse.js';

vi.mock('../logging/logger.js', () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

function response() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((statusCode: number) => {
    res.statusCode = statusCode;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

const snapshot: CourseClosingSnapshot = {
  courseId: 'course-1',
  status: 'stale',
  approvalValid: false,
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
  staleReason: 'APPROVAL_FINGERPRINT_MISMATCH',
};

describe('sendApiError', () => {
  it('preserves request_error for an ordinary handled object error below 500', () => {
    const res = response();
    sendApiError(res, Object.assign(new Error('Ordinary conflict'), { statusCode: 409 }));
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      errorCode: 'request_error',
      error: 'Ordinary conflict',
    });
  });

  it('preserves a typed course-closing code and safe snapshot', () => {
    const res = response();
    sendApiError(
      res,
      new CourseClosingError(
        409,
        'COURSE_CLOSING_STALE',
        'Course approval is stale',
        snapshot,
      ),
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      errorCode: 'COURSE_CLOSING_STALE',
      error: 'Course approval is stale',
      courseClosing: snapshot,
    });
  });
});

describe('handleApiError', () => {
  it('passes the typed domain error through after logging', () => {
    const res = response();
    const error = new CourseClosingError(
      409,
      'COURSE_CLOSING_NOT_APPROVED',
      'Course is not approved',
      snapshot,
    );
    handleApiError(
      { method: 'POST', query: { action: 'approve' } } as any,
      res,
      error,
      { module: 'classes', route: '/api/classes/approve', defaultMessage: 'Failed' },
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      errorCode: 'COURSE_CLOSING_NOT_APPROVED',
      courseClosing: snapshot,
    });
  });
});
