import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './apiClient';
import {
  cancelPrintRequest,
  getPrintRequestFileUrl,
  updatePrintRequestStatus,
} from './printRequestsApi';

vi.mock('./apiClient', () => ({
  apiRequest: vi.fn(),
}));

describe('print request API helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the cancel endpoint', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true });

    await cancelPrintRequest('print-1');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/classes/cancel-print-request', {
      method: 'POST',
      body: { requestId: 'print-1' },
    });
  });

  it('calls the office status endpoint', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true });

    await updatePrintRequestStatus('print-1', 'rejected', 'File is corrupted');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/classes/update-print-request-status', {
      method: 'POST',
      body: {
        requestId: 'print-1',
        status: 'rejected',
        rejectionReason: 'File is corrupted',
      },
    });
  });

  it('returns a signed file URL', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true, url: 'https://signed.example/file' });

    await expect(getPrintRequestFileUrl('print-1', 'file-1')).resolves.toBe(
      'https://signed.example/file'
    );

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/knowledge-bank/print-request-file?requestId=print-1&fileId=file-1'
    );
  });
});
