import { useState, useEffect, useCallback, useRef } from 'react';
import { readChannel } from '../lib/api/readApi';
import { upsertById, removeById, patchById } from '../lib/collections/listOps';

export type UseReadChannelResourceOptions<TPayload, TItem extends { id: string }> = {
  channel: string;
  params?: Record<string, string | number | boolean | undefined | null>;
  select: (payload: TPayload) => TItem[];
  enabled?: boolean;
};

export type UseReadChannelResourceResult<TItem extends { id: string }> = {
  data: TItem[];
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  lastSyncedAt: string | null;
  isStale: boolean;
  refresh: () => Promise<void>;
  replace: (items: TItem[]) => void;
  patch: (id: string, patch: Partial<TItem>) => void;
  upsert: (item: TItem) => void;
  remove: (id: string) => void;
};

export function useReadChannelResource<TPayload, TItem extends { id: string }>({
  channel,
  params,
  select,
  enabled = true,
}: UseReadChannelResourceOptions<TPayload, TItem>): UseReadChannelResourceResult<TItem> {
  const [data, setData] = useState<TItem[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const paramsRef = useRef(params);
  paramsRef.current = params;
  const selectRef = useRef(select);
  selectRef.current = select;

  const serializedParams = JSON.stringify(params);

  const refresh = useCallback(async () => {
    if (!enabled) return;

    setRefreshing(true);
    try {
      const payload = await readChannel<TPayload>(channel, paramsRef.current || {});
      const items = selectRef.current(payload);
      setData(items);
      setError(null);
      setIsStale(false);
      setLastSyncedAt(new Date().toISOString());
    } catch (err) {
      console.error(`[useReadChannelResource] failed to refresh channel ${channel}:`, err);
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsStale(true);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [channel, enabled, serializedParams]);

  useEffect(() => {
    let active = true;

    if (enabled) {
      setLoading(true);
      setError(null);

      readChannel<TPayload>(channel, paramsRef.current || {})
        .then((payload) => {
          if (!active) return;
          const items = selectRef.current(payload);
          setData(items);
          setIsStale(false);
          setLastSyncedAt(new Date().toISOString());
          setError(null);
        })
        .catch((err) => {
          if (!active) return;
          console.error(`[useReadChannelResource] initial fetch failed:`, err);
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsStale(true);
        })
        .finally(() => {
          if (!active) return;
          setLoading(false);
        });
    } else {
      setData([]);
      setLoading(false);
    }

    return () => {
      active = false;
    };
  }, [channel, enabled, serializedParams]);

  const replace = useCallback((items: TItem[]) => {
    setData(items);
  }, []);

  const patch = useCallback((id: string, partial: Partial<TItem>) => {
    setData((current) => patchById(current, id, partial));
  }, []);

  const upsert = useCallback((item: TItem) => {
    setData((current) => upsertById(current, item));
  }, []);

  const remove = useCallback((id: string) => {
    setData((current) => removeById(current, id));
  }, []);

  return {
    data,
    loading,
    refreshing,
    error,
    lastSyncedAt,
    isStale,
    refresh,
    replace,
    patch,
    upsert,
    remove,
  };
}
export default useReadChannelResource;
