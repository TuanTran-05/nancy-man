import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/finance/route';
import { verifyAuthToken } from '../../server/api/lib/auth/verifyAuth.js';
import {
  buildClassReconciliationOptions,
  buildClassTuitionReconciliationReport,
  buildClassTuitionStudentDetail,
  ClassReconciliationNotFoundError,
  ClassReconciliationInvalidInputError,
} from '../../server/api/lib/services/classTuitionReconciliationService.js';
import { ClassReconciliationTooLargeError } from '../../server/api/lib/repositories/classTuitionReconciliationRepository.js';

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(() => ({})),
  verifyAuthToken: vi.fn(),
  verifyAuthContext: vi.fn(),
}));

vi.mock('../../server/api/lib/services/classTuitionReconciliationService.js', async () => {
  const actual = await vi.importActual<any>(
    '../../server/api/lib/services/classTuitionReconciliationService.js'
  );
  return {
    ...actual,
    buildClassReconciliationOptions: vi.fn(),
    buildClassTuitionReconciliationReport: vi.fn(),
    buildClassTuitionStudentDetail: vi.fn(),
  };
});

function mockReq(query: Record<string, string>, method = 'GET'): ApiRequest {
  return { method, query, headers: {} } as unknown as ApiRequest;
}

function mockRes(): ApiResponse {
  const res = {} as ApiResponse;
  res.status = vi.fn(() => res) as ApiResponse['status'];
  res.json = vi.fn(() => res) as ApiResponse['json'];
  res.setHeader = vi.fn(() => res) as ApiResponse['setHeader'];
  res.end = vi.fn(() => res) as ApiResponse['end'];
  return res;
}

afterEach(() => vi.clearAllMocks());

describe('class tuition reconciliation finance router & handlers', () => {
  describe('role and method gates', () => {
    it('blocks unauthenticated or otherwise unauthorized callers', async () => {
      vi.mocked(verifyAuthToken).mockImplementation(async (_req, res) => {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return null;
      });

      const res = mockRes();
      await handler(mockReq({ action: 'class-reconciliation-options' }), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(buildClassReconciliationOptions).not.toHaveBeenCalled();
    });

    it.each([
      ['class-reconciliation-options', {}],
      ['class-reconciliation', { classId: 'c1', termStart: '2026-01-01' }],
      [
        'class-reconciliation-student',
        { classId: 'c1', termStart: '2026-01-01', studentId: 'st1' },
      ],
    ])('admits both admin and accounting on %s', async (action, query) => {
      vi.mocked(verifyAuthToken).mockImplementation(async (_req, res) => {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return null;
      });

      const res = mockRes();
      await handler(mockReq({ action, ...(query as Record<string, string>) }), res);

      expect(verifyAuthToken).toHaveBeenCalledWith(expect.anything(), res, ['admin', 'accounting']);
    });

    it('serves an accounting user the same as an admin', async () => {
      vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'acc-1', role: 'accounting' } as any);
      vi.mocked(buildClassReconciliationOptions).mockResolvedValue({
        success: true,
        mode: 'classes',
        classes: [],
      });

      const res = mockRes();
      await handler(mockReq({ action: 'class-reconciliation-options' }), res);

      expect(buildClassReconciliationOptions).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it('rejects non-GET HTTP methods with 405 Method Not Allowed', async () => {
      vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-1', role: 'admin' } as any);
      const res = mockRes();

      await handler(mockReq({ action: 'class-reconciliation-options' }, 'POST'), res);
      expect(res.status).toHaveBeenCalledWith(405);
      expect(buildClassReconciliationOptions).not.toHaveBeenCalled();
    });
  });

  describe('class-reconciliation-options', () => {
    it('dispatches to buildClassReconciliationOptions with optional classId', async () => {
      vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-1', role: 'admin' } as any);
      vi.mocked(buildClassReconciliationOptions).mockResolvedValue({
        success: true,
        mode: 'classes',
        classes: [],
      });

      const res = mockRes();
      await handler(mockReq({ action: 'class-reconciliation-options', classId: 'c1' }), res);

      expect(buildClassReconciliationOptions).toHaveBeenCalledWith(expect.anything(), {
        classId: 'c1',
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        mode: 'classes',
        classes: [],
      });
    });
  });

  describe('class-reconciliation', () => {
    it('returns 400 when classId or termStart is invalid', async () => {
      vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-1', role: 'admin' } as any);
      const res = mockRes();

      await handler(mockReq({ action: 'class-reconciliation', classId: 'c1', termStart: 'invalid-date' }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'class_reconciliation_invalid_request',
        })
      );
    });

    it('dispatches to buildClassTuitionReconciliationReport on valid input', async () => {
      vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-1', role: 'admin' } as any);
      vi.mocked(buildClassTuitionReconciliationReport).mockResolvedValue({
        success: true,
        scope: { classId: 'c1', className: 'Class 1', courseId: null, termStart: '2026-06-01', termEnd: null, courseLabel: '2026-06-01' },
        tuitionFee: { amount: 2000000, source: 'class_current' },
        summary: {} as any,
        rows: [],
        warnings: [],
      });

      const res = mockRes();
      await handler(mockReq({ action: 'class-reconciliation', classId: 'c1', termStart: '2026-06-01' }), res);

      expect(buildClassTuitionReconciliationReport).toHaveBeenCalledWith(expect.anything(), {
        classId: 'c1',
        termStart: '2026-06-01',
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('handles 404 not found and 413 too large errors gracefully', async () => {
      vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-1', role: 'admin' } as any);
      vi.mocked(buildClassTuitionReconciliationReport).mockRejectedValueOnce(
        new ClassReconciliationNotFoundError('Class not found')
      );

      const res404 = mockRes();
      await handler(mockReq({ action: 'class-reconciliation', classId: 'c-none', termStart: '2026-06-01' }), res404);
      expect(res404.status).toHaveBeenCalledWith(404);
      expect(res404.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'class_reconciliation_not_found',
        })
      );

      vi.mocked(buildClassTuitionReconciliationReport).mockRejectedValueOnce(
        new ClassReconciliationTooLargeError(5000, 'course_fee_ledgers')
      );

      const res413 = mockRes();
      await handler(mockReq({ action: 'class-reconciliation', classId: 'c1', termStart: '2026-06-01' }), res413);
      expect(res413.status).toHaveBeenCalledWith(413);
      expect(res413.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'class_reconciliation_too_large',
        })
      );
    });
  });

  describe('class-reconciliation-student', () => {
    it('returns 400 when both or neither studentId and ledgerId are given', async () => {
      vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-1', role: 'admin' } as any);
      const res = mockRes();

      await handler(
        mockReq({ action: 'class-reconciliation-student', classId: 'c1', termStart: '2026-06-01' }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'class_reconciliation_invalid_request',
        })
      );
    });

    it('dispatches to buildClassTuitionStudentDetail with studentId', async () => {
      vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-1', role: 'admin' } as any);
      vi.mocked(buildClassTuitionStudentDetail).mockResolvedValue({
        success: true,
        scope: { classId: 'c1', termStart: '2026-06-01', studentId: 'st1', ledgerId: null },
        student: { id: 'st1', fullName: 'Nguyen Van A', studentCode: 'HV001', recordFound: true },
        enrollments: [],
        ledgers: [],
        allocations: [],
        warnings: [],
        workspaceUrl: null,
      });

      const res = mockRes();
      await handler(
        mockReq({
          action: 'class-reconciliation-student',
          classId: 'c1',
          termStart: '2026-06-01',
          studentId: 'st1',
        }),
        res
      );

      expect(buildClassTuitionStudentDetail).toHaveBeenCalledWith(expect.anything(), {
        classId: 'c1',
        termStart: '2026-06-01',
        studentId: 'st1',
        ledgerId: undefined,
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });
  });

  describe('unexpected errors', () => {
    it('rethrows unexpected errors to be caught by global handleApiError resulting in 500 without leaking stack', async () => {
      vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-1', role: 'admin' } as any);
      vi.mocked(buildClassReconciliationOptions).mockRejectedValueOnce(
        new Error('Unexpected DB crash')
      );

      const res = mockRes();
      await handler(mockReq({ action: 'class-reconciliation-options' }), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        })
      );
    });
  });
});
