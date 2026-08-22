import type {
  DocumentData,
  DocumentReference,
  DocumentStore,
  SetOptions,
} from '@/server/db/documentStore.js';

export const DOCUMENT_STORE_SAFE_BATCH_SIZE = 450;

export type BatchWriteOperation =
  | { type: 'delete'; ref: DocumentReference }
  | { type: 'update'; ref: DocumentReference; data: Partial<DocumentData> }
  | { type: 'set'; ref: DocumentReference; data: DocumentData; options?: SetOptions };

export async function commitWriteOperationsInChunks(
  db: Pick<DocumentStore, 'batch'>,
  operations: BatchWriteOperation[],
  chunkSize = DOCUMENT_STORE_SAFE_BATCH_SIZE
): Promise<number> {
  if (operations.length === 0) return 0;
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 500) {
    throw new Error('Invalid DocumentStore batch chunk size');
  }

  for (let start = 0; start < operations.length; start += chunkSize) {
    const batch = db.batch();
    for (const operation of operations.slice(start, start + chunkSize)) {
      if (operation.type === 'delete') batch.delete(operation.ref);
      else if (operation.type === 'update') batch.update(operation.ref, operation.data);
      else if (operation.options) batch.set(operation.ref, operation.data, operation.options);
      else batch.set(operation.ref, operation.data);
    }
    await batch.commit();
  }

  return operations.length;
}

export function deleteRefsInChunks(
  db: Pick<DocumentStore, 'batch'>,
  refs: DocumentReference[],
  chunkSize = DOCUMENT_STORE_SAFE_BATCH_SIZE
): Promise<number> {
  return commitWriteOperationsInChunks(
    db,
    refs.map((ref) => ({ type: 'delete', ref })),
    chunkSize
  );
}
