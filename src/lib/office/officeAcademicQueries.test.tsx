// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readChannel } from '../api/readApi';
import { officeAcademicQueryOptions } from './officeAcademicQueries';

vi.mock('../api/readApi', () => ({
  readChannel: vi.fn(),
}));

afterEach(() => {
  vi.mocked(readChannel).mockReset();
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
const payload = {
  classes: [{ id: 'class-1' }],
  students: [],
  evaluations: [],
  ledgers: [],
  summaries: {},
};

describe('office academic query policy', () => {
  it('serves a remount from cache instead of rebuilding the payload', async () => {
    vi.mocked(readChannel).mockResolvedValue(payload as any);
    const queryClient = newClient();
    const wrapper = wrapperFor(queryClient);

    const first = renderHook(() => useQuery(officeAcademicQueryOptions(OFFICE, true)), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(readChannel).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = renderHook(() => useQuery(officeAcademicQueryOptions(OFFICE, true)), {
      wrapper,
    });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(readChannel).toHaveBeenCalledTimes(1);
    expect(second.result.current.isPending).toBe(false);

    second.unmount();
    queryClient.clear();
  });

  it('reads the office-academic channel with the existing limit', async () => {
    vi.mocked(readChannel).mockResolvedValue(payload as any);
    const queryClient = newClient();
    const hook = renderHook(() => useQuery(officeAcademicQueryOptions(OFFICE, true)), {
      wrapper: wrapperFor(queryClient),
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    expect(readChannel).toHaveBeenCalledWith('office-academic', { limit: 200 });

    hook.unmount();
    queryClient.clear();
  });

  it('joins an in-flight manual refresh when cancellation is disabled', async () => {
    let resolveSecond: ((value: unknown) => void) | undefined;
    vi.mocked(readChannel)
      .mockResolvedValueOnce(payload as any)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }) as any
      );
    const queryClient = newClient();
    const hook = renderHook(() => useQuery(officeAcademicQueryOptions(OFFICE, true)), {
      wrapper: wrapperFor(queryClient),
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    await act(async () => {
      void hook.result.current.refetch({ cancelRefetch: false });
      void hook.result.current.refetch({ cancelRefetch: false });
      await Promise.resolve();
    });

    expect(readChannel).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecond?.(payload);
    });

    hook.unmount();
    queryClient.clear();
  });

  it('does not serve one identity the payload cached for another', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce({ ...payload, classes: [{ id: 'office-view' }] } as any)
      .mockResolvedValueOnce({ ...payload, classes: [{ id: 'admin-view' }] } as any);
    const queryClient = newClient();
    const wrapper = wrapperFor(queryClient);

    const asOffice = renderHook(() => useQuery(officeAcademicQueryOptions(OFFICE, true)), {
      wrapper,
    });
    await waitFor(() => expect(asOffice.result.current.isSuccess).toBe(true));
    asOffice.unmount();

    const asAdmin = renderHook(
      () => useQuery(officeAcademicQueryOptions({ uid: 'admin-1', role: 'admin' }, true)),
      { wrapper }
    );
    await waitFor(() => expect(asAdmin.result.current.isSuccess).toBe(true));

    expect(asAdmin.result.current.data?.classes).toEqual([{ id: 'admin-view' }]);

    asAdmin.unmount();
    queryClient.clear();
  });

  it('does not fetch before an identity is known', async () => {
    vi.mocked(readChannel).mockResolvedValue(payload as any);
    const queryClient = newClient();
    const hook = renderHook(
      () => useQuery(officeAcademicQueryOptions({ uid: '', role: '' }, false)),
      { wrapper: wrapperFor(queryClient) }
    );
    await act(async () => {});

    expect(readChannel).not.toHaveBeenCalled();

    hook.unmount();
    queryClient.clear();
  });
});
