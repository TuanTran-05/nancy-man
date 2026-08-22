import { apiRequest } from './apiClient';
import type { OnlinePaymentRequest, OnlinePaymentStatus } from '../../types';

export interface PayOSCreateResponse {
  success: boolean;
  checkoutUrl: string;
  orderCode: number;
  paymentRequestId: string;
  amount: number;
  returnUrl: string;
}

export interface PayOSStatusResponse {
  success: boolean;
  status: OnlinePaymentStatus;
  amount: number;
  receiptId?: string;
  ledgerId?: string;
  paymentRequestId?: string;
}

export interface PayOSPaymentListResponse {
  success: boolean;
  payments: OnlinePaymentRequest[];
  health?: {
    pendingOlderThan30m: number;
    needsReviewOpen: number;
    staleCreatingGatewaySession: number;
    failedWebhookEvents24h: number;
  };
  page?: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface PayOSReconcileResponse {
  success: boolean;
  checked: number;
  results: { id: string; action: string; orderCode?: number; status?: string }[];
}

export function createPayOSPayment(ledgerId: string): Promise<PayOSCreateResponse> {
  return apiRequest<PayOSCreateResponse>('/api/v1/payments/payos/create', {
    method: 'POST',
    body: { ledgerId },
  });
}

export function getPayOSPaymentStatus(orderCode: number): Promise<PayOSStatusResponse> {
  return apiRequest<PayOSStatusResponse>(`/api/v1/payments/payos/status?orderCode=${orderCode}`);
}

export function refreshPayOSPaymentStatus(paymentRequestId: string): Promise<PayOSStatusResponse> {
  const params = new URLSearchParams({ paymentRequestId });
  return apiRequest<PayOSStatusResponse>(`/api/v1/payments/payos/status?${params}`);
}

export function listPayOSPayments(
  status = 'all',
  limit = 2000,
  cursor?: string | null
): Promise<PayOSPaymentListResponse> {
  const params = new URLSearchParams({ status, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return apiRequest<PayOSPaymentListResponse>(`/api/v1/payments/payos/list?${params}`);
}

export function reconcilePayOSPayments(): Promise<PayOSReconcileResponse> {
  return apiRequest<PayOSReconcileResponse>('/api/v1/payments/payos/reconcile', {
    method: 'POST',
  });
}

export interface PayOSResolveReviewResponse {
  success: boolean;
  action: 'approved' | 'rejected' | 'manual_handling_required';
  receiptId?: string;
  needsReview?: boolean;
  reviewReason?: string;
}

export function resolvePayOSReview(
  paymentRequestId: string,
  decision: 'approve' | 'reject',
  reason: string,
  gatewayAmount?: number,
  gatewayReference?: string
): Promise<PayOSResolveReviewResponse> {
  return apiRequest<PayOSResolveReviewResponse>('/api/v1/payments/payos/resolve-review', {
    method: 'POST',
    body: { paymentRequestId, decision, reason, gatewayAmount, gatewayReference },
  });
}
