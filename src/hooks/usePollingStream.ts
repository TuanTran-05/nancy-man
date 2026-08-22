import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { RealtimeEventKey } from './useInvalidationRefresh';

export interface UsePollingStreamOptions<T> {
  topic: RealtimeEventKey;
  fetchInitialData: () => Promise<{ items: T[]; serverTime?: number }>;
  enabled?: boolean;
  intervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const MIN_POLL_INTERVAL_MS = 5_000;
const MAX_POLL_INTERVAL_MS = 60_000;

function configuredPollInterval(): number {
  const parsed = Number(import.meta.env.VITE_REALTIME_POLL_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, parsed));
}

export function usePollingStream<T extends { id: string }>({
  topic,
  fetchInitialData,
  enabled = true,
  intervalMs = configuredPollInterval(),
}: UsePollingStreamOptions<T>) {
  const { profile, user } = useAuth();
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const fetchRef = useRef(fetchInitialData);
  const inFlightGenerations = useRef(new Set<number>());
  const generationRef = useRef(0);
  fetchRef.current = fetchInitialData;

  const executeRefresh = useCallback(async (generation: number, initialLoad = false) => {
    if (inFlightGenerations.current.has(generation)) return;
    inFlightGenerations.current.add(generation);
    try {
      if (initialLoad && generationRef.current === generation) setLoading(true);
      const result = await fetchRef.current();
      if (generationRef.current !== generation) return;
      setData(result.items);
      setError(null);
    } catch (caught) {
      if (generationRef.current !== generation) return;
      const nextError = caught instanceof Error ? caught : new Error(String(caught));
      console.error(`[usePollingStream] Failed to refresh ${topic}:`, nextError);
      setError(nextError);
    } finally {
      inFlightGenerations.current.delete(generation);
      if (initialLoad && generationRef.current === generation) setLoading(false);
    }
  }, [topic]);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!enabled || !profile || !user) {
      setLoading(false);
      return;
    }

    let active = true;
    const run = async (initialLoad = false) => {
      if (!active) return;
      await executeRefresh(generation, initialLoad);
    };
    void run(true);

    const requestedInterval = Number.isFinite(intervalMs) ? intervalMs : DEFAULT_POLL_INTERVAL_MS;
    const safeInterval = Math.min(
      MAX_POLL_INTERVAL_MS,
      Math.max(MIN_POLL_INTERVAL_MS, requestedInterval)
    );
    const timer = window.setInterval(() => void run(), safeInterval);
    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible') void run();
    };
    const refreshWhenOnline = () => void run();
    document.addEventListener('visibilitychange', refreshWhenActive);
    window.addEventListener('online', refreshWhenOnline);

    return () => {
      active = false;
      generationRef.current += 1;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenActive);
      window.removeEventListener('online', refreshWhenOnline);
    };
  }, [enabled, executeRefresh, intervalMs, profile?.classId, profile?.role, user?.uid]);

  return {
    data,
    setData,
    loading,
    error,
    refresh: () => executeRefresh(generationRef.current, false),
  };
}

export default usePollingStream;
