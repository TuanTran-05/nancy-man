import type { DocumentStore } from '@/server/db/documentStore.js';
import { fingerprintDocumentProjection } from './canonicalJson.js';
import type { NormalizationStore, NormalizationTransaction } from './writerCore.js';

/**
 * The merge engine's adapter onto a real database.
 *
 * `writer.ts` and `rollback.ts` are written against a deliberately narrow port
 * — get, set, delete, inside one transaction — so that a fake can implement it
 * faithfully and the tests exercise the same code production does. This is the
 * other half of that arrangement, and until it existed the engine could apply
 * operations to a fake and to nothing else.
 *
 * Two details are load-bearing. Reads carry the canonical fingerprint the
 * engine compares against, computed here rather than stored on the document,
 * because a fingerprint a writer could set is a fingerprint a drifted writer
 * could keep current. And a missing document reads as `null`, never as an
 * empty one: the engine treats "not there" and "there but empty" as different
 * answers, one being a document it may create and the other being drift.
 */
export function createDocumentStoreNormalizationStore(db: DocumentStore): NormalizationStore {
  return {
    runTransaction: <T>(work: (tx: NormalizationTransaction) => Promise<T>): Promise<T> =>
      db.runTransaction(async (transaction) => {
        const port: NormalizationTransaction = {
          get: async (path: string) => {
            const snapshot = (await transaction.get(db.doc(path) as never)) as unknown as {
              exists: boolean;
              data: () => Record<string, unknown> | undefined;
            };
            if (!snapshot.exists) return null;
            const data = snapshot.data() ?? {};
            // Computed only if somebody asks. The engine reads documents it
            // never compares — the maintenance guard, most obviously — and
            // canonicalisation is strict enough to reject a field none of
            // those reads care about. A document that is compared still
            // throws, which is the right answer: content that cannot be
            // canonicalised cannot be checked for drift either.
            return {
              data,
              get fingerprint() {
                return fingerprintDocumentProjection(data);
              },
            };
          },
          set: (path: string, doc: { data: Record<string, unknown> }) => {
            // Replace, not merge. The engine hands over the whole document it
            // intends to exist; merging would leave a field it decided to drop
            // sitting in production.
            transaction.set(db.doc(path) as never, doc.data as never);
          },
          delete: (path: string) => {
            transaction.delete(db.doc(path) as never);
          },
        };
        return work(port);
      }),
  };
}
