const DEFAULT_UPDATE_TIME = '2026-01-01T00:00:00.000Z';

export interface DocumentStoreTestDocumentReference<T extends Record<string, unknown>> {
  id: string;
  path: string;
  get: () => Promise<DocumentStoreTestDocumentSnapshot<T>>;
}

export interface DocumentStoreTestDocumentSnapshot<T extends Record<string, unknown>> {
  id: string;
  exists: boolean;
  ref: DocumentStoreTestDocumentReference<T>;
  updateTime: { toDate: () => Date };
  data: () => T | undefined;
}

export interface DocumentStoreTestQuerySnapshot<T extends Record<string, unknown>> {
  docs: DocumentStoreTestDocumentSnapshot<T>[];
  size: number;
  empty: boolean;
  forEach: (callback: (doc: DocumentStoreTestDocumentSnapshot<T>) => void) => void;
}

export type DocumentStoreTestWrite =
  | { type: 'create'; ref: unknown; data: unknown }
  | { type: 'set'; ref: unknown; data: unknown; options: unknown }
  | { type: 'update'; ref: unknown; data: unknown }
  | { type: 'delete'; ref: unknown };

export interface DocumentStoreTestTransaction {
  get: (target: unknown) => Promise<unknown>;
  /** Distinct from `set`: idempotency documents rely on create failing if the id is taken. */
  create: (ref: unknown, data: unknown) => DocumentStoreTestTransaction;
  set: (ref: unknown, data: unknown, options?: unknown) => DocumentStoreTestTransaction;
  update: (ref: unknown, data: unknown) => DocumentStoreTestTransaction;
  delete: (ref: unknown) => DocumentStoreTestTransaction;
}

export function makeDocumentStoreDocSnapshot<T extends Record<string, unknown>>(options: {
  id: string;
  data?: T;
  exists?: boolean;
  path?: string;
  updateTime?: string | Date;
}): DocumentStoreTestDocumentSnapshot<T> {
  const exists = options.exists ?? true;
  const timestamp = options.updateTime ?? DEFAULT_UPDATE_TIME;
  const millis = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp);
  if (!Number.isFinite(millis)) throw new Error(`Invalid document-store test update time: ${timestamp}`);

  let snapshot!: DocumentStoreTestDocumentSnapshot<T>;
  const ref: DocumentStoreTestDocumentReference<T> = {
    id: options.id,
    path: options.path ?? `test/${options.id}`,
    get: async () => snapshot,
  };
  snapshot = {
    id: options.id,
    exists,
    ref,
    updateTime: { toDate: () => new Date(millis) },
    data: () => (exists && options.data ? ({ ...options.data } as T) : undefined),
  };
  return snapshot;
}

export function makeDocumentStoreQuerySnapshot<T extends Record<string, unknown>>(
  docs: DocumentStoreTestDocumentSnapshot<T>[],
): DocumentStoreTestQuerySnapshot<T> {
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (callback) => docs.forEach(callback),
  };
}

export function createDocumentStoreTransactionHarness(options: {
  onGet?: (target: unknown) => unknown | Promise<unknown>;
} = {}): {
  transaction: DocumentStoreTestTransaction;
  runTransaction: <T>(callback: (tx: DocumentStoreTestTransaction) => Promise<T>) => Promise<T>;
  writes: DocumentStoreTestWrite[];
} {
  const writes: DocumentStoreTestWrite[] = [];

  /**
   * What this harness has written, so it can be read again.
   *
   * Recording writes without letting them be read makes any
   * write-then-read-back protocol look broken: a mutation lease taken in one
   * transaction and renewed in the next comes back missing, and the code under
   * test reports a lost lease when nothing was lost.
   */
  const written = new Map<string, Record<string, unknown>>();
  const pathOf = (ref: unknown): string | null => {
    const path = (ref as { path?: unknown } | null)?.path;
    return typeof path === 'string' ? path : null;
  };

  const transaction: DocumentStoreTestTransaction = {
    get: async (target) => {
      if (options.onGet) return options.onGet(target);
      const path = pathOf(target);
      if (path !== null && written.has(path)) {
        return { exists: true, id: path.slice(path.lastIndexOf('/') + 1), data: () => written.get(path) };
      }
      if (
        target &&
        typeof target === 'object' &&
        'get' in target &&
        typeof (target as { get?: unknown }).get === 'function'
      ) {
        return (target as { get: () => unknown | Promise<unknown> }).get();
      }
      if (path !== null) return { exists: false, id: path.slice(path.lastIndexOf('/') + 1), data: () => undefined };
      throw new Error('document-store test transaction target does not expose get()');
    },
    create: (ref, data) => {
      writes.push({ type: 'create', ref, data });
      const path = pathOf(ref);
      if (path !== null) written.set(path, data as Record<string, unknown>);
      return transaction;
    },
    set: (ref, data, writeOptions) => {
      writes.push({ type: 'set', ref, data, options: writeOptions });
      const path = pathOf(ref);
      if (path !== null) written.set(path, data as Record<string, unknown>);
      return transaction;
    },
    update: (ref, data) => {
      writes.push({ type: 'update', ref, data });
      const path = pathOf(ref);
      if (path !== null && written.has(path)) {
        written.set(path, { ...written.get(path), ...(data as Record<string, unknown>) });
      }
      return transaction;
    },
    delete: (ref) => {
      writes.push({ type: 'delete', ref });
      const path = pathOf(ref);
      if (path !== null) written.delete(path);
      return transaction;
    },
  };

  return {
    transaction,
    runTransaction: async (callback) => callback(transaction),
    writes,
  };
}
