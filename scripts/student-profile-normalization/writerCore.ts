/**
 * The narrow DocumentStore port shared by the apply writer and the rollback
 * reverser, plus the one document path both of them re-read.
 *
 * It lives in its own module so `rollback.ts` and `writer.ts` can each depend
 * on it without depending on each other. The port is intentionally small —
 * get, set, delete inside a transaction — because everything the engine does to
 * production has to be expressible in terms a fake store can implement
 * faithfully. A wider port would mean the tests exercise something other than
 * what runs.
 */

/**
 * The maintenance guard. Re-read inside every transaction rather than trusted
 * from preflight, because writes reopening mid-run is the exact race the
 * maintenance window exists to prevent.
 */
export const MAINTENANCE_DOC_PATH = '_maintenance/student_identity';

export interface NormalizationTransaction {
  get(
    path: string
  ): Promise<{ data: Record<string, unknown>; fingerprint: string } | null | undefined>;
  set(path: string, doc: { data: Record<string, unknown>; fingerprint: string }): void;
  delete(path: string): void;
}

export interface NormalizationStore {
  runTransaction<T>(fn: (tx: NormalizationTransaction) => Promise<T>): Promise<T>;
}
