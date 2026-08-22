// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readChannel } from '../../lib/api/readApi';
import { listPayOSPayments } from '../../lib/api/payosApi';
import {
  financeExpensesQueryOptions,
  financeLedgersQueryOptions,
  financePaymentsQueryOptions,
  financeReceiptsQueryOptions,
} from './financeListQueries';

vi.mock('../../lib/api/readApi', () => ({
  readChannel: vi.fn(),
}));

vi.mock('../../lib/api/payosApi', () => ({
  listPayOSPayments: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(readChannel).mockReset();
  vi.mocked(listPayOSPayments).mockReset();
});

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithClient(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const ACCOUNTING = { uid: 'accounting-1', role: 'accounting' };
const LEDGER_FILTERS = { status: 'all', classId: '' };

function ledgerPage(ledgers: unknown[], hasMore = false, nextCursor: string | null = null) {
  return { ledgers, page: { nextCursor, hasMore } } as never;
}

describe('finance list query policy', () => {
  // Leaving a tab and coming back re-enables the query. Within the window that
  // must come from cache — the realtime channels already force a refetch the
  // moment money changes, so the request on every switch buys nothing.
  it('does not refetch a list when a tab is revisited inside the 60-second window', async () => {
    vi.mocked(readChannel).mockResolvedValue(ledgerPage([{ id: 'ledger-1' }]));
    const queryClient = newClient();
    const wrapper = renderWithClient(queryClient);

    const onTab = renderHook(
      () => useInfiniteQuery(financeLedgersQueryOptions(ACCOUNTING, LEDGER_FILTERS, true)),
      { wrapper }
    );
    await waitFor(() => expect(onTab.result.current.isSuccess).toBe(true));
    expect(readChannel).toHaveBeenCalledTimes(1);

    onTab.unmount();
    const backOnTab = renderHook(
      () => useInfiniteQuery(financeLedgersQueryOptions(ACCOUNTING, LEDGER_FILTERS, true)),
      { wrapper }
    );
    await waitFor(() => expect(backOnTab.result.current.isSuccess).toBe(true));

    expect(readChannel).toHaveBeenCalledTimes(1);
    expect(backOnTab.result.current.data?.pages[0].rows).toEqual([{ id: 'ledger-1' }]);

    backOnTab.unmount();
    queryClient.clear();
  });

  it('refetches a list once the 60-second window has passed', async () => {
    vi.useFakeTimers();
    vi.mocked(readChannel).mockResolvedValue(ledgerPage([]));
    const queryClient = newClient();
    const wrapper = renderWithClient(queryClient);

    const first = renderHook(
      () => useInfiniteQuery(financeLedgersQueryOptions(ACCOUNTING, LEDGER_FILTERS, true)),
      { wrapper }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readChannel).toHaveBeenCalledTimes(1);
    first.unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001);
    });

    const second = renderHook(
      () => useInfiniteQuery(financeLedgersQueryOptions(ACCOUNTING, LEDGER_FILTERS, true)),
      { wrapper }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(readChannel).toHaveBeenCalledTimes(2);

    second.unmount();
    queryClient.clear();
  });

  it('refreshes an actively observed money list at 60 seconds, not before', async () => {
    vi.useFakeTimers();
    vi.mocked(readChannel).mockResolvedValue(ledgerPage([]));
    const queryClient = newClient();
    const wrapper = renderWithClient(queryClient);

    const hook = renderHook(
      () => useInfiniteQuery(financeLedgersQueryOptions(ACCOUNTING, LEDGER_FILTERS, true)),
      { wrapper }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readChannel).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(readChannel).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(readChannel).toHaveBeenCalledTimes(2);

    hook.unmount();
    queryClient.clear();
  });

  it('does not serve one identity the ledgers cached for another', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce(ledgerPage([{ id: 'accounting-visible' }]))
      .mockResolvedValueOnce(ledgerPage([{ id: 'admin-visible' }]));
    const queryClient = newClient();
    const wrapper = renderWithClient(queryClient);

    const asAccounting = renderHook(
      () => useInfiniteQuery(financeLedgersQueryOptions(ACCOUNTING, LEDGER_FILTERS, true)),
      { wrapper }
    );
    await waitFor(() => expect(asAccounting.result.current.isSuccess).toBe(true));
    asAccounting.unmount();

    const asAdmin = renderHook(
      () =>
        useInfiniteQuery(
          financeLedgersQueryOptions({ uid: 'admin-1', role: 'admin' }, LEDGER_FILTERS, true)
        ),
      { wrapper }
    );
    await waitFor(() => expect(asAdmin.result.current.isSuccess).toBe(true));

    expect(asAdmin.result.current.data?.pages[0].rows).toEqual([{ id: 'admin-visible' }]);
    expect(readChannel).toHaveBeenCalledTimes(2);

    asAdmin.unmount();
    queryClient.clear();
  });

  it('gives each filter combination its own cache entry', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce(ledgerPage([{ id: 'all-statuses' }]))
      .mockResolvedValueOnce(ledgerPage([{ id: 'unpaid-only' }]));
    const queryClient = newClient();
    const wrapper = renderWithClient(queryClient);

    const all = renderHook(
      () => useInfiniteQuery(financeLedgersQueryOptions(ACCOUNTING, LEDGER_FILTERS, true)),
      { wrapper }
    );
    await waitFor(() => expect(all.result.current.isSuccess).toBe(true));
    all.unmount();

    const unpaid = renderHook(
      () =>
        useInfiniteQuery(
          financeLedgersQueryOptions(ACCOUNTING, { status: 'unpaid', classId: '' }, true)
        ),
      { wrapper }
    );
    await waitFor(() => expect(unpaid.result.current.isSuccess).toBe(true));

    expect(unpaid.result.current.data?.pages[0].rows).toEqual([{ id: 'unpaid-only' }]);
    expect(readChannel).toHaveBeenLastCalledWith(
      'finance',
      expect.objectContaining({ resource: 'ledgers', status: 'unpaid' })
    );

    unpaid.unmount();
    queryClient.clear();
  });

  it('carries the previous cursor into the next page and stops when the server says so', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce(ledgerPage([{ id: 'row-1' }], true, 'cursor-1'))
      .mockResolvedValueOnce(ledgerPage([{ id: 'row-2' }], false, null));
    const queryClient = newClient();
    const wrapper = renderWithClient(queryClient);

    const hook = renderHook(
      () => useInfiniteQuery(financeLedgersQueryOptions(ACCOUNTING, LEDGER_FILTERS, true)),
      { wrapper }
    );
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(hook.result.current.hasNextPage).toBe(true);
    expect(readChannel).toHaveBeenLastCalledWith(
      'finance',
      expect.objectContaining({ cursor: null })
    );

    await act(async () => {
      await hook.result.current.fetchNextPage();
    });
    await waitFor(() => expect(hook.result.current.data?.pages).toHaveLength(2));

    expect(readChannel).toHaveBeenLastCalledWith(
      'finance',
      expect.objectContaining({ cursor: 'cursor-1' })
    );
    expect(hook.result.current.data?.pages.flatMap((page) => page.rows)).toEqual([
      { id: 'row-1' },
      { id: 'row-2' },
    ]);
    expect(hook.result.current.hasNextPage).toBe(false);

    hook.unmount();
    queryClient.clear();
  });

  it('does not fetch any list until an identity is known', async () => {
    const queryClient = newClient();
    const wrapper = renderWithClient(queryClient);
    const noIdentity = { uid: '', role: '' };

    const hooks = [
      renderHook(
        () => useInfiniteQuery(financeLedgersQueryOptions(noIdentity, LEDGER_FILTERS, false)),
        { wrapper }
      ),
      renderHook(
        () =>
          useInfiniteQuery(
            financeReceiptsQueryOptions(
              noIdentity,
              { status: 'all', classId: '', startDate: '', endDate: '' },
              false
            )
          ),
        { wrapper }
      ),
      renderHook(
        () =>
          useInfiniteQuery(
            financeExpensesQueryOptions(
              noIdentity,
              { status: 'all', startDate: '', endDate: '' },
              false
            )
          ),
        { wrapper }
      ),
      renderHook(
        () => useInfiniteQuery(financePaymentsQueryOptions(noIdentity, { status: 'all' }, false)),
        { wrapper }
      ),
    ];
    await act(async () => {});

    expect(readChannel).not.toHaveBeenCalled();
    expect(listPayOSPayments).not.toHaveBeenCalled();

    hooks.forEach((hook) => hook.unmount());
    queryClient.clear();
  });

  it('keeps the payment health block reachable from the first page', async () => {
    const health = {
      pendingOlderThan30m: 2,
      needsReviewOpen: 1,
      staleCreatingGatewaySession: 0,
      failedWebhookEvents24h: 0,
    };
    vi.mocked(listPayOSPayments).mockResolvedValue({
      success: true,
      payments: [{ id: 'payment-1' }],
      health,
      page: { limit: 50, nextCursor: null, hasMore: false },
    } as never);
    const queryClient = newClient();
    const wrapper = renderWithClient(queryClient);

    const hook = renderHook(
      () => useInfiniteQuery(financePaymentsQueryOptions(ACCOUNTING, { status: 'all' }, true)),
      { wrapper }
    );
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    expect(listPayOSPayments).toHaveBeenCalledWith('all', 50, null);
    expect(hook.result.current.data?.pages[0].health).toEqual(health);
    expect(hook.result.current.data?.pages[0].rows).toEqual([{ id: 'payment-1' }]);

    hook.unmount();
    queryClient.clear();
  });
});
