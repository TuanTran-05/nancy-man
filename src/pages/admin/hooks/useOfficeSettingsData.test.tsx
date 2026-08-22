// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { useOfficeSettingsData } from './useOfficeSettingsData';
import { apiRequest } from '../../../lib/api/apiClient';
import { readCalendarReferences } from '../../../lib/api/frontendReadApi';

vi.mock('../../../lib/api/apiClient', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../../lib/api/frontendReadApi', () => ({
  readCalendarReferences: vi.fn(),
}));

const OFFICE = { uid: 'office-1', role: 'office' };

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useOfficeSettingsData', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();

    vi.mocked(apiRequest).mockResolvedValue({ success: true });
    vi.mocked(readCalendarReferences).mockResolvedValue({
      classes: [],
      attendance: [],
      attendanceCounts: {},
      systemHolidays: ['2026-01-01', '2026-05-01'],
    });
  });

  it('fetches holidays via office query policy', async () => {
    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useOfficeSettingsData(OFFICE, 'en'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.holidayDates).toEqual(['2026-01-01', '2026-05-01']);
    expect(readCalendarReferences).toHaveBeenCalledTimes(1);
  });

  it('adds holiday and invalidates holiday cache', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true });
    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useOfficeSettingsData(OFFICE, 'en'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setNewHoliday('2026-09-02');
    });

    await act(async () => {
      await result.current.handleAddHoliday();
    });

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/classes/save-settings', {
      method: 'POST',
      body: {
        settingType: 'holidays',
        dates: ['2026-01-01', '2026-05-01', '2026-09-02'],
      },
    });
  });

  it('removes holiday and invalidates holiday cache', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true });
    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useOfficeSettingsData(OFFICE, 'en'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleRemoveHoliday('2026-01-01');
    });

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/classes/save-settings', {
      method: 'POST',
      body: {
        settingType: 'holidays',
        dates: ['2026-05-01'],
      },
    });
  });
});
