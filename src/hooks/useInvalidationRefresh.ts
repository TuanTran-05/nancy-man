import { useEffect, useRef } from 'react';
import { FRONTEND_READ_POLL_INTERVAL_MS } from '../lib/api/frontendReadApi';
import type { RealtimeEventKey } from '../lib/realtime/realtimeEventKeys';

export type { RealtimeEventKey };

export interface UseInvalidationRefreshOptions {
  /**
   * Logical cache channel. This is deliberately a string because class-scoped
   * resources use keys such as `class-detail:<classId>`.
   */
  channelKey: RealtimeEventKey | string;
  enabled?: boolean;
  debounceMs?: number;
  minIntervalMs?: number;
  pollIntervalMs?: number;
  onInvalidate: () => void | Promise<void>;
}

/**
 * Refresh HTTP-backed reads without keeping a PostgreSQL API realtime listener.
 *
 * Queries are refreshed on a conservative interval and immediately when the
 * browser regains focus or connectivity. The in-flight/trailing guards avoid
 * concurrent refresh storms when several browser events happen together.
 */
export function useInvalidationRefresh({
  channelKey,
  enabled = true,
  debounceMs = 250,
  minIntervalMs = 2500,
  pollIntervalMs = FRONTEND_READ_POLL_INTERVAL_MS,
  onInvalidate,
}: UseInvalidationRefreshOptions): void {
  const onInvalidateRef = useRef(onInvalidate);
  onInvalidateRef.current = onInvalidate;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let inFlight = false;
    let trailing = false;
    let lastRefreshedAt = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const executeRefresh = async () => {
      if (cancelled) return;
      if (inFlight) {
        trailing = true;
        return;
      }

      inFlight = true;
      lastRefreshedAt = Date.now();
      try {
        await onInvalidateRef.current();
      } catch (error) {
        console.error(`[useInvalidationRefresh] failed to refresh channel ${channelKey}:`, error);
      } finally {
        inFlight = false;
        if (trailing && !cancelled) {
          trailing = false;
          scheduleRefresh();
        }
      }
    };

    const scheduleRefresh = () => {
      if (cancelled) return;
      if (timeout) clearTimeout(timeout);

      const elapsed = Date.now() - lastRefreshedAt;
      const delay = Math.max(debounceMs, minIntervalMs - elapsed);
      timeout = setTimeout(() => void executeRefresh(), delay);
    };

    const interval = setInterval(scheduleRefresh, Math.max(pollIntervalMs, minIntervalMs));
    const handleFocus = () => scheduleRefresh();
    const handleOnline = () => scheduleRefresh();

    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, [channelKey, enabled, debounceMs, minIntervalMs, pollIntervalMs]);
}

export default useInvalidationRefresh;
