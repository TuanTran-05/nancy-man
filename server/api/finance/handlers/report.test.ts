import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(() => ({ id: 'db' })),
  verifyAuthToken: vi.fn().mockResolvedValue({ uid: 'accountant-1' }),
}));

vi.mock('../../lib/services/financeReportService.js', () => ({
  buildFinanceReport: vi.fn().mockResolvedValue({
    success: true,
    totalIncome: 0,
    totalExpenses: 0,
    balance: 0,
    monthlyBreakdown: [],
    incomeByLevel: [],
    expensesByCategory: [],
    source: 'live',
  }),
}));

import { buildFinanceReport } from '../../lib/services/financeReportService.js';
import { handleReport } from './report.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleReport', () => {
  it('forwards an explicit live-refresh request to the report service', async () => {
    const req = {
      method: 'GET',
      query: {
        startDate: '2025-06-01',
        endDate: '2025-06-30',
        forceLive: '1',
      },
    } as unknown as ApiRequest;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as ApiResponse;

    await handleReport(req, res);

    expect(buildFinanceReport).toHaveBeenCalledWith(expect.anything(), {
      startDate: '2025-06-01',
      endDate: '2025-06-30',
      forceLive: true,
      includeDaily: false,
    });
  });

  it('forwards a validated daily-breakdown request', async () => {
    const req = {
      method: 'GET',
      query: {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        includeDaily: '1',
      },
    } as unknown as ApiRequest;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as ApiResponse;

    await handleReport(req, res);

    expect(buildFinanceReport).toHaveBeenCalledWith(expect.anything(), {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      forceLive: false,
      includeDaily: true,
    });
  });

  it('rejects an invalid daily report range before reading DocumentStore', async () => {
    const req = {
      method: 'GET',
      query: {
        startDate: '2026-08-31',
        endDate: '2026-08-01',
        includeDaily: '1',
      },
    } as unknown as ApiRequest;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as ApiResponse;

    await handleReport(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'invalid_date_range' })
    );
    expect(buildFinanceReport).not.toHaveBeenCalled();
  });
});
