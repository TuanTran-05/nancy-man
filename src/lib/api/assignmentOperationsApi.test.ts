import { describe, expect, it, vi } from 'vitest';
import { getAssignmentProgressSummary } from './assignmentOperationsApi';
import { apiRequest } from './apiClient';

vi.mock('./apiClient', () => ({ apiRequest: vi.fn() }));

describe('assignmentOperationsApi', () => {
  it('loads assignment progress summary', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true, data: { counts: { target: 1 } } });

    const result = await getAssignmentProgressSummary('assignment-1');

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/edu/assignment-progress-summary?assignmentId=assignment-1'
    );
    expect(result).toEqual({ counts: { target: 1 } });
  });
});
