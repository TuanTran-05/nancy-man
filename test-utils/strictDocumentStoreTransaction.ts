import { vi } from 'vitest';

export const DOCUMENT_STORE_READ_AFTER_WRITE_ERROR =
  'DocumentStore transactions require all reads to be executed before all writes.';

export function enforceDocumentStoreReadBeforeWrite<T extends { get: (...args: any[]) => any }>(
  transaction: T
): T {
  const tx = transaction as Record<string, any>;
  let writeStarted = false;
  const originalGet = tx.get.bind(transaction);

  tx.get = vi.fn((...args: any[]) => {
    if (writeStarted) throw new Error(DOCUMENT_STORE_READ_AFTER_WRITE_ERROR);
    return originalGet(...args);
  });

  for (const method of ['create', 'set', 'update', 'delete'] as const) {
    if (typeof tx[method] !== 'function') continue;
    const originalWrite = tx[method].bind(transaction);
    tx[method] = vi.fn((...args: any[]) => {
      writeStarted = true;
      return originalWrite(...args);
    });
  }

  return transaction;
}
