// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readOfficeTeachersMonth } from '../api/officeTeachersApi';
import { officeTeachersMonthQueryOptions } from './officeTeachersQueries';

vi.mock('../api/officeTeachersApi', () => ({
  readOfficeTeachersMonth: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(readOfficeTeachersMonth).mockReset();
});

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const OFFICE = { uid: 'office-1', role: 'office' };
const monthPayload = (month: string) => ({
  month,
  range: { from: `${month}-01`, to: `${month}-28` },
  teachers: [],
  classes: [],
  sessions: [],
  substitutes: [],
  serverTime: 0,
});

describe('office teachers month query policy', () => {
  it('returns to an already viewed month without reading it again', async () => {
    vi.mocked(readOfficeTeachersMonth).mockImplementation(
      async (month: string) => monthPayload(month) as any
    );
    const queryClient = newClient();
    const wrapper = wrapperFor(queryClient);

    const august = renderHook(
      () => useQuery(officeTeachersMonthQueryOptions(OFFICE, '2026-08', true)),
      { wrapper }
    );
    await waitFor(() => expect(august.result.current.isSuccess).toBe(true));
    august.unmount();

    const september = renderHook(
      () => useQuery(officeTeachersMonthQueryOptions(OFFICE, '2026-09', true)),
      { wrapper }
    );
    await waitFor(() => expect(september.result.current.isSuccess).toBe(true));
    september.unmount();
    expect(readOfficeTeachersMonth).toHaveBeenCalledTimes(2);

    const backToAugust = renderHook(
      () => useQuery(officeTeachersMonthQueryOptions(OFFICE, '2026-08', true)),
      { wrapper }
    );
    await waitFor(() => expect(backToAugust.result.current.isSuccess).toBe(true));

    expect(readOfficeTeachersMonth).toHaveBeenCalledTimes(2);
    expect(backToAugust.result.current.data?.month).toBe('2026-08');

    backToAugust.unmount();
    queryClient.clear();
  });

  it('keeps two months in independent cache entries', async () => {
    vi.mocked(readOfficeTeachersMonth).mockImplementation(
      async (month: string) => monthPayload(month) as any
    );
    const queryClient = newClient();
    const wrapper = wrapperFor(queryClient);

    const august = renderHook(
      () => useQuery(officeTeachersMonthQueryOptions(OFFICE, '2026-08', true)),
      { wrapper }
    );
    const september = renderHook(
      () => useQuery(officeTeachersMonthQueryOptions(OFFICE, '2026-09', true)),
      { wrapper }
    );
    await waitFor(() => expect(august.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(september.result.current.isSuccess).toBe(true));

    expect(august.result.current.data?.month).toBe('2026-08');
    expect(september.result.current.data?.month).toBe('2026-09');

    august.unmount();
    september.unmount();
    queryClient.clear();
  });

  it('does not serve one identity the month cached for another', async () => {
    vi.mocked(readOfficeTeachersMonth)
      .mockResolvedValueOnce({
        ...monthPayload('2026-08'),
        teachers: [{ uid: 'office-view' }],
      } as any)
      .mockResolvedValueOnce({
        ...monthPayload('2026-08'),
        teachers: [{ uid: 'admin-view' }],
      } as any);
    const queryClient = newClient();
    const wrapper = wrapperFor(queryClient);

    const asOffice = renderHook(
      () => useQuery(officeTeachersMonthQueryOptions(OFFICE, '2026-08', true)),
      { wrapper }
    );
    await waitFor(() => expect(asOffice.result.current.isSuccess).toBe(true));
    asOffice.unmount();

    const asAdmin = renderHook(
      () =>
        useQuery(
          officeTeachersMonthQueryOptions({ uid: 'admin-1', role: 'admin' }, '2026-08', true)
        ),
      { wrapper }
    );
    await waitFor(() => expect(asAdmin.result.current.isSuccess).toBe(true));

    expect(asAdmin.result.current.data?.teachers).toEqual([{ uid: 'admin-view' }]);

    asAdmin.unmount();
    queryClient.clear();
  });

  it('does not fetch before a month or an identity is known', async () => {
    vi.mocked(readOfficeTeachersMonth).mockResolvedValue(monthPayload('2026-08') as any);
    const queryClient = newClient();
    const hook = renderHook(
      () => useQuery(officeTeachersMonthQueryOptions({ uid: '', role: '' }, '', false)),
      { wrapper: wrapperFor(queryClient) }
    );
    await act(async () => {});

    expect(readOfficeTeachersMonth).not.toHaveBeenCalled();

    hook.unmount();
    queryClient.clear();
  });
});
