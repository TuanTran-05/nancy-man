import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/apiClient';
import { createTrialAdmission, searchHistoricalAdmissions } from './admissionsApi';

vi.mock('../api/apiClient', () => ({
  apiRequest: vi.fn(),
}));

describe('admissions API wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps created trial data from the API envelope', async () => {
    const data = {
      mode: 'created' as const,
      studentId: 'student-1',
      studentCode: 'HS260001',
      trialReviewStatus: 'pending_sessions' as const,
    };
    vi.mocked(apiRequest).mockResolvedValue({ success: true, data });

    await expect(
      createTrialAdmission({
        name: 'Nguyen Van A',
        dob: '2014-01-01',
        contact: '0384072314',
        grade: 6,
        classId: 'class-1',
      })
    ).resolves.toEqual(data);
  });

  it('unwraps historical admission search matches', async () => {
    const data = { exactMatches: [], possibleMatches: [{ id: 'student-old' }] };
    vi.mocked(apiRequest).mockResolvedValue({ success: true, data });

    await expect(
      searchHistoricalAdmissions({
        name: 'Nguyen Van A',
        dob: '2014-01-01',
        contact: '0384072314',
      })
    ).resolves.toEqual(data);
  });
});
