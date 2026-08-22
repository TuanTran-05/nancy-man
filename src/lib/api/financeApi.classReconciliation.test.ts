import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchClassReconciliationOptions,
  fetchClassTuitionReconciliation,
  fetchClassTuitionStudentDetail,
} from './financeApi';

afterEach(() => vi.restoreAllMocks());

describe('class tuition reconciliation finance client functions', () => {
  describe('fetchClassReconciliationOptions', () => {
    it('passes optional classId and AbortSignal to GET /class-reconciliation-options', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, mode: 'classes', classes: [] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const controller = new AbortController();
      await fetchClassReconciliationOptions('c1', controller.signal);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/finance/class-reconciliation-options?classId=c1',
        expect.objectContaining({
          method: 'GET',
          signal: controller.signal,
          headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest' }),
        })
      );
    });

    it('works without classId', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, mode: 'classes', classes: [] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await fetchClassReconciliationOptions();

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/finance/class-reconciliation-options',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('fetchClassTuitionReconciliation', () => {
    it('builds query string and propagates typed 413 error code', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 413,
          text: async () =>
            JSON.stringify({
              success: false,
              error: 'Reconciliation too large',
              errorCode: 'class_reconciliation_too_large',
            }),
        })
      );

      await expect(
        fetchClassTuitionReconciliation({ classId: 'c1', termStart: '2026-06-01' })
      ).rejects.toMatchObject({
        status: 413,
        errorCode: 'class_reconciliation_too_large',
        message: 'Reconciliation too large',
      });
    });

    it('successfully fetches report data and passes AbortSignal', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            scope: { classId: 'c1', termStart: '2026-06-01' },
            summary: { expectedGross: 1000 },
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const controller = new AbortController();
      const res = await fetchClassTuitionReconciliation({
        classId: 'c1',
        termStart: '2026-06-01',
        signal: controller.signal,
      });

      expect(res.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/finance/class-reconciliation?classId=c1&termStart=2026-06-01',
        expect.objectContaining({
          method: 'GET',
          signal: controller.signal,
        })
      );
    });
  });

  describe('fetchClassTuitionStudentDetail', () => {
    it('builds query with studentId and passes AbortSignal', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            student: { id: 'st1', fullName: 'A' },
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const controller = new AbortController();
      const res = await fetchClassTuitionStudentDetail({
        classId: 'c1',
        termStart: '2026-06-01',
        studentId: 'st1',
        signal: controller.signal,
      });

      expect(res.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/finance/class-reconciliation-student?classId=c1&termStart=2026-06-01&studentId=st1',
        expect.objectContaining({
          method: 'GET',
          signal: controller.signal,
        })
      );
    });

    it('builds query with ledgerId and preserves 404 error code', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          text: async () =>
            JSON.stringify({
              success: false,
              error: 'Not found',
              errorCode: 'class_reconciliation_not_found',
            }),
        })
      );

      await expect(
        fetchClassTuitionStudentDetail({
          classId: 'c1',
          termStart: '2026-06-01',
          ledgerId: 'l1',
        })
      ).rejects.toMatchObject({
        status: 404,
        errorCode: 'class_reconciliation_not_found',
      });
    });
  });
});
