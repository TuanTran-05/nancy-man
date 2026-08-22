import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/finance/route';
import { verifyAuthToken } from '../../server/api/lib/auth/verifyAuth.js';
import {
  buildCenterFinanceReport,
  type CenterFinanceReport,
} from '../../server/api/lib/services/centerFinanceReportService.js';

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(() => ({})),
  verifyAuthToken: vi.fn(),
  verifyAuthContext: vi.fn(),
}));
vi.mock('../../server/api/lib/services/centerFinanceReportService.js', () => ({
  buildCenterFinanceReport: vi.fn(),
}));

function mockReq(query: Record<string, string>): ApiRequest {
  return { method: 'GET', query, headers: {} } as unknown as ApiRequest;
}

function mockRes(): ApiResponse {
  const res = {} as ApiResponse;
  res.status = vi.fn(() => res) as ApiResponse['status'];
  res.json = vi.fn(() => res) as ApiResponse['json'];
  res.setHeader = vi.fn(() => res) as ApiResponse['setHeader'];
  res.end = vi.fn(() => res) as ApiResponse['end'];
  return res;
}

const report: CenterFinanceReport = {
  success: true,
  selectedMonth: '2026-04',
  months: [],
  current: {
    month: '2026-04',
    grossBilled: 0,
    discountTotal: 0,
    netBilled: 0,
    collectedCohort: 0,
    outstanding: 0,
    cashIn: 0,
    cashOut: 0,
  },
  discountBreakdown: { discount: 0, waiver: 0, unclassified: 0 },
  incomeByLevel: [],
  expensesByCategory: [],
  receivablesByStatus: [],
  studentPayments: {
    summary: {
      total: 0,
      paid: 0,
      partial: 0,
      unpaid: 0,
      waived: 0,
      withOutstanding: 0,
      overdue: 0,
    },
    rows: [],
  },
  source: 'live',
};

afterEach(() => vi.clearAllMocks());

describe('finance center-report action', () => {
  it('requires the admin/accounting roles and returns 403 otherwise', async () => {
    vi.mocked(verifyAuthToken).mockImplementation(async (_req, res) => {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return null;
    });
    const res = mockRes();

    await handler(mockReq({ action: 'center-report' }), res);

    expect(verifyAuthToken).toHaveBeenCalledWith(expect.anything(), res, ['admin', 'accounting']);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(buildCenterFinanceReport).not.toHaveBeenCalled();
  });

  it('returns the report for an authorized user', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-1' } as NonNullable<
      Awaited<ReturnType<typeof verifyAuthToken>>
    >);
    vi.mocked(buildCenterFinanceReport).mockResolvedValue(report);
    const res = mockRes();

    await handler(mockReq({ action: 'center-report', month: '2026-04', months: '6' }), res);

    expect(buildCenterFinanceReport).toHaveBeenCalledWith(expect.anything(), {
      month: '2026-04',
      months: 6,
    });
    expect(res.json).toHaveBeenCalledWith(report);
  });

  it('rejects a calendar month outside 01-12 without invoking the service', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-1' } as NonNullable<
      Awaited<ReturnType<typeof verifyAuthToken>>
    >);
    const res = mockRes();

    await handler(mockReq({ action: 'center-report', month: '2026-99', months: '6' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorCode: 'invalid_month' })
    );
    expect(buildCenterFinanceReport).not.toHaveBeenCalled();
  });
});
