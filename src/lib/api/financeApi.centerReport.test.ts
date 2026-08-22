import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { getIdToken: vi.fn().mockResolvedValue('token-123') } },
}));

import {
  fetchCenterFinanceReport,
  fetchCenterFinanceReportDetails,
  fetchFinanceReport,
} from './financeApi';

afterEach(() => vi.restoreAllMocks());

describe('fetchCenterFinanceReport', () => {
  it('preserves errorCode and status from a 413 response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        text: async () =>
          JSON.stringify({ success: false, error: 'too large', errorCode: 'report_too_large' }),
      })
    );
    await expect(fetchCenterFinanceReport('2026-04', 12)).rejects.toMatchObject({
      errorCode: 'report_too_large',
      status: 413,
    });
  });

  it('builds the request path with month and months', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, selectedMonth: '2026-04' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchCenterFinanceReport('2026-04', 6);
    expect(fetchMock.mock.calls[0][0]).toContain('/center-report?month=2026-04&months=6');
  });

  it('builds the paginated finance detail request path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          month: '2026-07',
          type: 'income',
          period: { startDate: '2026-07-01', endDate: '2026-07-31' },
          totalCount: 0,
          totalAmount: 0,
          rows: [],
          nextCursor: null,
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchCenterFinanceReportDetails({
      month: '2026-07',
      type: 'income',
      pageSize: 25,
      cursor: 'cursor-1',
    });
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/center-report-details?month=2026-07&type=income&pageSize=25&cursor=cursor-1'
    );
  });

  it('requests a live fund summary when stale details need reconciliation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          totalIncome: 0,
          totalExpenses: 0,
          balance: 0,
          monthlyBreakdown: [],
          source: 'live',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchFinanceReport('2025-06-01', '2025-06-30', { forceLive: true });

    expect(fetchMock.mock.calls[0][0]).toContain(
      '/report?startDate=2025-06-01&endDate=2025-06-30&forceLive=1'
    );
  });

  it('requests an opt-in daily fund breakdown', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, dailyBreakdown: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchFinanceReport('2026-08-01', '2026-08-31', { includeDaily: true });

    expect(fetchMock.mock.calls[0][0]).toContain(
      '/report?startDate=2026-08-01&endDate=2026-08-31&includeDaily=1'
    );
  });

  it('builds a paginated date-range finance detail request path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          type: 'expense',
          period: { startDate: '2026-08-05', endDate: '2026-08-05' },
          totalCount: 0,
          totalAmount: 0,
          rows: [],
          nextCursor: null,
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchCenterFinanceReportDetails({
      startDate: '2026-08-05',
      endDate: '2026-08-05',
      type: 'expense',
      pageSize: 25,
      cursor: null,
    });

    expect(fetchMock.mock.calls[0][0]).toContain(
      '/center-report-details?startDate=2026-08-05&endDate=2026-08-05&type=expense&pageSize=25'
    );
  });
});
