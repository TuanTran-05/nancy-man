import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { afterEach, expect, it, vi } from 'vitest';
import handler from '../../server/api/finance/route';
import { verifyAuthToken } from '../../server/api/lib/auth/verifyAuth.js';
import {
  buildCenterFinanceReportDetails,
  decodeCenterReportDetailsCursor,
} from '../../server/api/lib/services/centerFinanceReportDetailsService.js';

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(() => ({})),
  verifyAuthToken: vi.fn(),
  verifyAuthContext: vi.fn(),
}));
vi.mock('../../server/api/lib/services/centerFinanceReportDetailsService.js', () => ({
  buildCenterFinanceReportDetails: vi.fn(),
  decodeCenterReportDetailsCursor: vi.fn(),
}));

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

it('requires admin or accounting and never invokes the detail service on denial', async () => {
  vi.mocked(verifyAuthToken).mockImplementation(async (_req, res) => {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return null;
  });
  const res = mockRes();
  await handler(
    mockReq({
      action: 'center-report-details',
      month: '2026-07',
      type: 'income',
    }),
    res
  );
  expect(verifyAuthToken).toHaveBeenCalledWith(expect.anything(), res, ['admin', 'accounting']);
  expect(buildCenterFinanceReportDetails).not.toHaveBeenCalled();
});

it('normalizes page size and passes a decoded cursor to the service', async () => {
  vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-1' } as any);
  vi.mocked(decodeCenterReportDetailsCursor).mockReturnValue({
    date: '2026-07-30',
    id: 'r1',
  });
  vi.mocked(buildCenterFinanceReportDetails).mockResolvedValue({
    success: true,
    month: '2026-07',
    type: 'income',
    period: { startDate: '2026-07-01', endDate: '2026-07-31' },
    totalCount: 0,
    totalAmount: 0,
    rows: [],
    nextCursor: null,
  });
  const res = mockRes();
  await handler(
    mockReq({
      action: 'center-report-details',
      month: '2026-07',
      type: 'income',
      pageSize: '500',
      cursor: 'opaque',
    }),
    res
  );
  expect(buildCenterFinanceReportDetails).toHaveBeenCalledWith(expect.anything(), {
    month: '2026-07',
    type: 'income',
    pageSize: 100,
    cursor: { date: '2026-07-30', id: 'r1' },
  });
});

it.each([
  [{ month: '2026-99', type: 'income' }, 'invalid_month'],
  [{ month: '2026-07', type: 'unknown' }, 'invalid_detail_type'],
])('rejects invalid detail query %o', async (query, errorCode) => {
  vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-1' } as any);
  const res = mockRes();
  await handler(mockReq({ action: 'center-report-details', ...query }), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errorCode }));
  expect(buildCenterFinanceReportDetails).not.toHaveBeenCalled();
});

it('returns invalid_cursor when cursor decoding fails', async () => {
  vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-1' } as any);
  vi.mocked(decodeCenterReportDetailsCursor).mockImplementation(() => {
    throw Object.assign(new Error('invalid_cursor'), {
      errorCode: 'invalid_cursor',
      statusCode: 400,
    });
  });
  const res = mockRes();
  await handler(
    mockReq({
      action: 'center-report-details',
      month: '2026-07',
      type: 'income',
      cursor: 'bad-cursor',
    }),
    res
  );
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'invalid_cursor' }));
  expect(buildCenterFinanceReportDetails).not.toHaveBeenCalled();
});

it('rejects non-GET methods', async () => {
  const res = mockRes();
  await handler(
    mockReq(
      {
        action: 'center-report-details',
        month: '2026-07',
        type: 'income',
      },
      'POST'
    ),
    res
  );
  expect(res.status).toHaveBeenCalledWith(405);
  expect(verifyAuthToken).not.toHaveBeenCalled();
});
