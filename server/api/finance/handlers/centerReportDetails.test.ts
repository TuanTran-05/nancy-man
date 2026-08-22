import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(() => ({ id: 'db' })),
  verifyAuthToken: vi.fn().mockResolvedValue({ uid: 'accountant-1' }),
}));

vi.mock('../../lib/services/centerFinanceReportDetailsService.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../lib/services/centerFinanceReportDetailsService.js')
  >('../../lib/services/centerFinanceReportDetailsService.js');
  return {
    ...actual,
    buildCenterFinanceReportDetails: vi.fn().mockResolvedValue({
      success: true,
      type: 'income',
      period: { startDate: '2026-08-05', endDate: '2026-08-05' },
      totalCount: 0,
      totalAmount: 0,
      rows: [],
      nextCursor: null,
    }),
  };
});

import { verifyAuthToken } from '../../lib/auth/verifyAuth.js';
import { buildCenterFinanceReportDetails } from '../../lib/services/centerFinanceReportDetailsService.js';
import { handleCenterReportDetails } from './centerReportDetails.js';

function responseStub() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as ApiResponse;
}

beforeEach(() => vi.clearAllMocks());

describe('handleCenterReportDetails', () => {
  it('passes an explicit one-day period to the detail service', async () => {
    const req = {
      method: 'GET',
      query: {
        startDate: '2026-08-05',
        endDate: '2026-08-05',
        type: 'income',
        pageSize: '25',
      },
    } as unknown as ApiRequest;
    const res = responseStub();

    await handleCenterReportDetails(req, res);

    expect(verifyAuthToken).toHaveBeenCalledWith(req, res, ['admin', 'accounting']);
    expect(buildCenterFinanceReportDetails).toHaveBeenCalledWith(expect.anything(), {
      startDate: '2026-08-05',
      endDate: '2026-08-05',
      type: 'income',
      pageSize: 25,
      cursor: null,
    });
  });

  it.each([
    { month: '2026-08', startDate: '2026-08-01', endDate: '2026-08-31' },
    { startDate: '2026-08-01' },
    { startDate: '2026-08-31', endDate: '2026-08-01' },
    { startDate: '2026-02-30', endDate: '2026-03-01' },
  ])('rejects an invalid or ambiguous scope: %o', async (query) => {
    const req = {
      method: 'GET',
      query: { ...query, type: 'income' },
    } as unknown as ApiRequest;
    const res = responseStub();

    await handleCenterReportDetails(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(buildCenterFinanceReportDetails).not.toHaveBeenCalled();
  });

  it('keeps month requests compatible with the Admin report', async () => {
    const req = {
      method: 'GET',
      query: { month: '2026-02', type: 'expense' },
    } as unknown as ApiRequest;
    const res = responseStub();

    await handleCenterReportDetails(req, res);

    expect(buildCenterFinanceReportDetails).toHaveBeenCalledWith(expect.anything(), {
      month: '2026-02',
      type: 'expense',
      pageSize: 25,
      cursor: null,
    });
  });
});
