import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleResolveReview } from './resolveReview.js';
import { getDb, verifyAuthToken, verifyAuthContext } from '../../../lib/auth/verifyAuth.js';
import { getPayOSClient } from '../../../lib/payments/payosClient.js';
import { writeCriticalAuditLog, getClientIp } from '../../../lib/logging/auditLog.js';
import { getUserRoleAndName, normalizeBody } from '../../../lib/http/helpers.js';
import {
  getLatestGatewayTransaction,
  refreshPaymentFromGateway,
  sendPaymentConfirmationIfNeeded,
} from './shared.js';

vi.mock('../../../lib/auth/verifyAuth.js', () => {
  const getDb = vi.fn();
  const verifyAuthToken = vi.fn();
  const verifyAuthContext = vi.fn(async (req: any, res: any, requiredRoles: any) => {
    const decoded = await verifyAuthToken(req, res, requiredRoles);
    if (!decoded) return null;
    return {
      decoded,
      context: {
        uid: decoded.uid,
        email: decoded.email,
        role: decoded.role || 'admin',
        name: 'Admin Account',
      },
    };
  });
  return { getDb, verifyAuthToken, verifyAuthContext };
});

vi.mock('../../../lib/logging/auditLog.js', () => ({
  writeCriticalAuditLog: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../../../lib/http/helpers.js', () => ({
  getUserRoleAndName: vi.fn().mockResolvedValue({ role: 'admin', name: 'Admin Account' }),
  normalizeBody: vi.fn((b) => b || {}),
}));

vi.mock('../../../lib/payments/payosClient.js', () => {
  const getMock = vi.fn();
  return {
    getPayOSClient: vi.fn(() => ({
      paymentRequests: {
        get: getMock,
      },
    })),
  };
});

vi.mock('./shared.js', () => ({
  getLatestGatewayTransaction: vi.fn(),
  refreshPaymentFromGateway: vi.fn(),
  sendPaymentConfirmationIfNeeded: vi.fn(),
}));

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: any) => {
    res.body = body;
    return res;
  });
  return res;
}

function makeDoc(data: any, exists = true) {
  return {
    exists,
    data: () => data,
  };
}

describe('handleResolveReview', () => {
  let mockPaymentRef: any;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPaymentRef = {
      get: vi.fn(),
      update: vi.fn(),
      set: vi.fn(),
    };
    mockDb = {
      collection: vi.fn((name) => {
        if (name === 'payment_requests') {
          return {
            doc: vi.fn(() => mockPaymentRef),
          };
        }
        return {};
      }),
    };

    vi.mocked(getDb).mockReturnValue(mockDb as any);
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid: 'admin-uid', role: 'admin' } as any);
  });

  it('rejects non-POST requests with 405 Method Not Allowed', async () => {
    const res = mockRes();
    await handleResolveReview({ method: 'GET' } as any, res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ success: false, error: 'Method not allowed' });
  });

  it('rejects requests with invalid parameters with 400 Bad Request', async () => {
    const res = mockRes();
    await handleResolveReview(
      {
        method: 'POST',
        body: { paymentRequestId: '', decision: 'approve', reason: 'validating' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Invalid parameters' });
  });

  it('returns 404 if payment request does not exist', async () => {
    mockPaymentRef.get.mockResolvedValue(makeDoc({}, false));
    const res = mockRes();
    await handleResolveReview(
      {
        method: 'POST',
        body: { paymentRequestId: 'non-existent', decision: 'reject', reason: 'cleaning' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Payment not found' });
  });

  it('returns 400 if payment request status is not needs_review', async () => {
    mockPaymentRef.get.mockResolvedValue(makeDoc({ status: 'pending' }));
    const res = mockRes();
    await handleResolveReview(
      {
        method: 'POST',
        body: { paymentRequestId: 'pay-123', decision: 'reject', reason: 'cleaning' },
      } as any,
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Payment is not in needs_review status' });
  });

  it('successfully rejects needs_review payment and marks it failed', async () => {
    mockPaymentRef.get.mockResolvedValue(makeDoc({ status: 'needs_review' }));
    const res = mockRes();
    await handleResolveReview(
      {
        method: 'POST',
        body: { paymentRequestId: 'pay-123', decision: 'reject', reason: 'suspicious activity' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, action: 'rejected' });
    expect(mockPaymentRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        failureReason: 'Manual rejection: suspicious activity',
        reviewResolution: 'rejected',
        resolvedBy: 'admin-uid',
      })
    );
    expect(writeCriticalAuditLog).toHaveBeenCalled();
  });

  it('requires manual handling when orderCode is missing for approval', async () => {
    mockPaymentRef.get.mockResolvedValue(makeDoc({ status: 'needs_review', orderCode: null }));
    const res = mockRes();
    await handleResolveReview(
      {
        method: 'POST',
        body: { paymentRequestId: 'pay-123', decision: 'approve', reason: 'check gateway' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      action: 'manual_handling_required',
      needsReview: true,
    });
    expect(mockPaymentRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'needs_review',
        reviewResolution: 'manual_handling_required',
        resolvedBy: 'admin-uid',
      })
    );
  });

  it('returns 502 Bad Gateway if payOS client fetching orderCode fails', async () => {
    mockPaymentRef.get.mockResolvedValue(makeDoc({ status: 'needs_review', orderCode: 998877 }));
    const payosGetMock = getPayOSClient().paymentRequests.get as any;
    payosGetMock.mockRejectedValue(new Error('PayOS gateway timeout'));

    const res = mockRes();
    await handleResolveReview(
      {
        method: 'POST',
        body: { paymentRequestId: 'pay-123', decision: 'approve', reason: 'force sync' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ success: false, error: 'Failed to verify payment with payOS' });
    expect(mockPaymentRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'needs_review',
        reviewResolution: 'gateway_verification_failed',
      })
    );
  });

  it('requires manual handling if gateway payment status is not PAID', async () => {
    mockPaymentRef.get.mockResolvedValue(makeDoc({ status: 'needs_review', orderCode: 998877 }));
    const payosGetMock = getPayOSClient().paymentRequests.get as any;
    payosGetMock.mockResolvedValue({ status: 'PENDING', amount: 5000 });

    const res = mockRes();
    await handleResolveReview(
      {
        method: 'POST',
        body: { paymentRequestId: 'pay-123', decision: 'approve', reason: 'recheck' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      action: 'manual_handling_required',
      needsReview: true,
      reviewReason: 'payOS payment is not PAID',
    });
    expect(mockPaymentRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'needs_review',
        gatewayStatus: 'PENDING',
        reviewResolution: 'manual_handling_required',
      })
    );
  });

  it('successfully approves a verified PAID gateway transaction', async () => {
    mockPaymentRef.get.mockResolvedValue(makeDoc({ status: 'needs_review', orderCode: 998877 }));
    const payosGetMock = getPayOSClient().paymentRequests.get as any;
    payosGetMock.mockResolvedValue({
      status: 'PAID',
      amount: 50000,
      transactions: [{ reference: 'TRANS-OK-1' }],
    });

    vi.mocked(refreshPaymentFromGateway).mockResolvedValue({
      receiptId: 'rcpt-9988',
      needsReview: false,
    } as any);

    vi.mocked(getLatestGatewayTransaction).mockReturnValue({ reference: 'TRANS-OK-1' } as any);

    const res = mockRes();
    await handleResolveReview(
      {
        method: 'POST',
        body: { paymentRequestId: 'pay-123', decision: 'approve', reason: 'verified matching' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      action: 'approved',
      receiptId: 'rcpt-9988',
      needsReview: false,
      reviewReason: undefined,
    });
    expect(mockPaymentRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewResolution: 'approved_by_gateway_verification',
        resolvedBy: 'admin-uid',
      }),
      { merge: true }
    );
    expect(writeCriticalAuditLog).toHaveBeenCalled();
    expect(sendPaymentConfirmationIfNeeded).toHaveBeenCalled();
  });
});
