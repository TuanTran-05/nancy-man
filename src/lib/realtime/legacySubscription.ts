export type Unsubscribe = () => void;

type SubscribeOptions = {
  label?: string;
  onError?: (error: Error) => void;
  silent?: boolean;
  maxRetries?: number;
  baseDelayMs?: number;
};

/** Retired compatibility surface. Production refreshes through HTTP polling. */
export function subscribeToQuery<T>(
  _queryRef: unknown,
  onData: (data: T[]) => void,
  _options: SubscribeOptions = {}
): Unsubscribe {
  onData([]);
  return () => {};
}

/** Retired compatibility surface. Production refreshes through HTTP polling. */
export function subscribeToDoc<T>(
  _documentRef: unknown,
  onData: (data: T | null) => void,
  _options: SubscribeOptions = {}
): Unsubscribe {
  onData(null);
  return () => {};
}
