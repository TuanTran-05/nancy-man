import { useMemo } from 'react';

export interface LiveQueryState<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  fromCache: boolean;
}

export interface LiveDocState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/** Compatibility-only hook for retired tests; production reads use readChannel. */
export function useLiveCollection<T>(_queryRef: unknown): LiveQueryState<T> {
  return useMemo(() => ({ data: [], loading: false, error: null, fromCache: false }), []);
}

/** Compatibility-only hook for retired tests; production reads use readChannel. */
export function useLiveDoc<T>(_documentRef: unknown): LiveDocState<T> {
  return useMemo(() => ({ data: null, loading: false, error: null }), []);
}
