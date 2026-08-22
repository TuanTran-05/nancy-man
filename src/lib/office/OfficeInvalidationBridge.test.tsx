// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRONTEND_READ_POLL_INTERVAL_MS } from '../api/frontendReadApi';
import { OfficeInvalidationBridge } from './OfficeInvalidationBridge';

afterEach(() => {
  vi.useRealTimers();
});

function mountBridge(identity: { uid?: string; role?: string }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const clear = vi.spyOn(queryClient, 'clear');
  const view = render(
    <QueryClientProvider client={queryClient}>
      <OfficeInvalidationBridge uid={identity.uid} role={identity.role} />
    </QueryClientProvider>
  );
  return { queryClient, invalidate, clear, ...view };
}

describe('OfficeInvalidationBridge', () => {
  it('periodically invalidates office and read queries for office users', () => {
    vi.useFakeTimers();
    const { invalidate } = mountBridge({ uid: 'office-1', role: 'office' });

    act(() => vi.advanceTimersByTime(FRONTEND_READ_POLL_INTERVAL_MS));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['office'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['read'] });
  });

  it('does not poll for roles without office access', () => {
    vi.useFakeTimers();
    const { invalidate } = mountBridge({ uid: 'parent-1', role: 'parent' });

    act(() => vi.advanceTimersByTime(FRONTEND_READ_POLL_INTERVAL_MS * 2));

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('clears cached data when the signed-in identity changes', () => {
    const { clear, rerender, queryClient } = mountBridge({ uid: 'office-1', role: 'office' });

    rerender(
      <QueryClientProvider client={queryClient}>
        <OfficeInvalidationBridge uid="admin-1" role="admin" />
      </QueryClientProvider>
    );

    expect(clear).toHaveBeenCalledTimes(1);
  });
});
