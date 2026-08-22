// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readChannel } from '../../../lib/api/readApi';
import {
  readAssignmentsData,
  readClassDetailData,
  readClassesData,
} from '../../../lib/api/frontendReadApi';
import { useTeacherDashboardData } from './useTeacherDashboardData';

vi.mock('../../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

vi.mock('../../../lib/api/apiClient', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../../lib/api/readApi', () => ({
  readChannel: vi.fn(),
}));

vi.mock('../../../lib/api/frontendReadApi', () => ({
  FRONTEND_READ_POLL_INTERVAL_MS: 60_000,
  readAssignmentsData: vi.fn(),
  readClassDetailData: vi.fn(),
  readClassesData: vi.fn(),
}));

describe('useTeacherDashboardData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(readClassesData).mockResolvedValue({
      classes: [
        {
          id: 'class-1',
          name: 'Class 1',
          status: 'active',
          teacherId: 'teacher-1',
          daysOfWeek: [1],
          startTime: '18:00',
        },
      ],
    } as never);
    vi.mocked(readAssignmentsData).mockResolvedValue({
      assignments: [],
      submissions: [],
    } as never);
    vi.mocked(readClassDetailData).mockResolvedValue({ evaluations: [] } as never);
  });

  it('keeps class metrics when the student read fails', async () => {
    vi.mocked(readChannel).mockRejectedValue(new Error('student read timed out'));

    const { result, unmount } = renderHook(() =>
      useTeacherDashboardData({ uid: 'teacher-1', role: 'teacher' } as never)
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.stats).toMatchObject({
      classes: 1,
      students: 0,
      assignments: 0,
    });
    expect(result.current.classesData).toHaveProperty('class-1');
    expect(console.error).toHaveBeenCalledWith(
      'Partial teacher dashboard read failed:',
      expect.any(Error)
    );
    unmount();
  });
});
