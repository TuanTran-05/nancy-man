// @vitest-environment jsdom
import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readChannel } from '../lib/api/readApi';
import { useReadChannelResource } from './useReadChannelResource';

vi.mock('../lib/auth/sessionAuth', () => ({
  db: {},
}));

vi.mock('../lib/api/readApi', () => ({
  readChannel: vi.fn(),
}));

describe('useReadChannelResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs initial load when enabled is true', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      items: [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ],
    });

    const { result } = renderHook(() =>
      useReadChannelResource<
        { items: { id: string; name: string }[] },
        { id: string; name: string }
      >({
        channel: 'test-channel',
        select: (payload) => payload.items,
        enabled: true,
      })
    );

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(readChannel).toHaveBeenCalledWith('test-channel', {});
    expect(result.current.data).toEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]);
    expect(result.current.error).toBeNull();
    expect(result.current.isStale).toBe(false);
    expect(result.current.lastSyncedAt).not.toBeNull();
  });

  it('does not load initially when enabled is false', () => {
    const { result } = renderHook(() =>
      useReadChannelResource<
        { items: { id: string; name: string }[] },
        { id: string; name: string }
      >({
        channel: 'test-channel',
        select: (payload) => payload.items,
        enabled: false,
      })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(readChannel).not.toHaveBeenCalled();
  });

  it('supports background refreshing without hiding current data', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce({
        items: [{ id: '1', name: 'Alice' }],
      })
      .mockResolvedValueOnce({
        items: [
          { id: '1', name: 'Alice' },
          { id: '2', name: 'Bob-new' },
        ],
      });

    const { result } = renderHook(() =>
      useReadChannelResource<
        { items: { id: string; name: string }[] },
        { id: string; name: string }
      >({
        channel: 'test-channel',
        select: (payload) => payload.items,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual([{ id: '1', name: 'Alice' }]);

    let refreshPromise: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });

    expect(result.current.refreshing).toBe(true);
    expect(result.current.data).toEqual([{ id: '1', name: 'Alice' }]); // old data remains visible

    await act(async () => {
      await refreshPromise;
    });

    expect(result.current.refreshing).toBe(false);
    expect(result.current.data).toEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob-new' },
    ]);
  });

  it('preserves data and sets error/stale status if refresh fails', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce({
        items: [{ id: '1', name: 'Alice' }],
      })
      .mockRejectedValueOnce(new Error('Network failure'));

    const { result } = renderHook(() =>
      useReadChannelResource<
        { items: { id: string; name: string }[] },
        { id: string; name: string }
      >({
        channel: 'test-channel',
        select: (payload) => payload.items,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual([{ id: '1', name: 'Alice' }]);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.refreshing).toBe(false);
    expect(result.current.data).toEqual([{ id: '1', name: 'Alice' }]); // preserved
    expect(result.current.error?.message).toBe('Network failure');
    expect(result.current.isStale).toBe(true);
  });

  it('supports local manual manipulations (replace, patch, upsert, remove)', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      items: [{ id: '1', name: 'Alice' }],
    });

    const { result } = renderHook(() =>
      useReadChannelResource<
        { items: { id: string; name: string }[] },
        { id: string; name: string }
      >({
        channel: 'test-channel',
        select: (payload) => payload.items,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.upsert({ id: '2', name: 'Bob' });
    });
    expect(result.current.data).toEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]);

    act(() => {
      result.current.patch('1', { name: 'Alice-Modified' });
    });
    expect(result.current.data).toEqual([
      { id: '1', name: 'Alice-Modified' },
      { id: '2', name: 'Bob' },
    ]);

    act(() => {
      result.current.remove('2');
    });
    expect(result.current.data).toEqual([{ id: '1', name: 'Alice-Modified' }]);

    act(() => {
      result.current.replace([{ id: '3', name: 'Charlie' }]);
    });
    expect(result.current.data).toEqual([{ id: '3', name: 'Charlie' }]);
  });
});
