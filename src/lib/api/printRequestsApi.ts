import type { PrintRequestStatus } from '../../types';
import { apiRequest } from './apiClient';

type SuccessResponse = { success: true; id?: string; status?: PrintRequestStatus };
type SignedUrlResponse = { success: true; url: string };

export function cancelPrintRequest(requestId: string) {
  return apiRequest<SuccessResponse>('/api/v1/classes/cancel-print-request', {
    method: 'POST',
    body: { requestId },
  });
}

export function updatePrintRequestStatus(
  requestId: string,
  status: Extract<PrintRequestStatus, 'printed' | 'completed' | 'rejected'>,
  rejectionReason = ''
) {
  return apiRequest<SuccessResponse>('/api/v1/classes/update-print-request-status', {
    method: 'POST',
    body: {
      requestId,
      status,
      ...(status === 'rejected' ? { rejectionReason } : {}),
    },
  });
}

export async function getPrintRequestFileUrl(requestId: string, fileId: string) {
  const params = new URLSearchParams({ requestId, fileId });
  const response = await apiRequest<SignedUrlResponse>(
    `/api/v1/knowledge-bank/print-request-file?${params.toString()}`
  );
  return response.url;
}
