import {
  FieldValue,
  type DocumentReference,
  type DocumentStore,
  type Transaction,
} from '@/server/db/documentStore.js';

const RANGE_END = '\uf8ff';

export type CounterSequenceOptions = {
  counterId: string;
  collectionName: string;
  numberField: string;
  prefix: string;
  lookupExisting?: boolean;
  extractSequence?: (lastValue: unknown, prefix: string) => number;
};

export function compactDateKey(now = new Date()): string {
  return (
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0')
  );
}

export function extractHyphenSuffixSequence(lastValue: unknown): number {
  return (
    parseInt(
      String(lastValue || '')
        .split('-')
        .pop() || '0',
      10
    ) || 0
  );
}

export function extractPrefixSuffixSequence(lastValue: unknown, prefix: string): number {
  const value = String(lastValue || '');
  return value.startsWith(prefix) ? parseInt(value.slice(prefix.length), 10) || 0 : 0;
}

export async function getNextCounterSequence(
  db: DocumentStore,
  options: CounterSequenceOptions
): Promise<number> {
  return db.runTransaction((tx) => reserveNextCounterSequence(tx, db, options));
}

export async function peekNextCounterSequence(
  db: DocumentStore,
  {
    counterId,
    collectionName,
    numberField,
    prefix,
    lookupExisting = true,
    extractSequence = extractHyphenSuffixSequence,
  }: CounterSequenceOptions
): Promise<number> {
  const counterSnap = await db.collection('_counters').doc(counterId).get();
  let maxSeq = counterSnap.exists ? Number(counterSnap.data()?.seq || 0) : 0;
  if (lookupExisting) {
    const snapshot = await db
      .collection(collectionName)
      .where(numberField, '>=', prefix)
      .where(numberField, '<', prefix + RANGE_END)
      .orderBy(numberField, 'desc')
      .limit(1)
      .get();
    const lastValue = snapshot.empty ? '' : snapshot.docs[0].data()[numberField];
    maxSeq = Math.max(maxSeq, extractSequence(lastValue, prefix));
  }
  return maxSeq + 1;
}

/**
 * Everything the write phase needs, carried between the two halves.
 *
 * `counterExists` travels with the reservation rather than being re-read at
 * write time on purpose: re-reading would be a read after a write in the same
 * transaction, which is exactly what the split exists to make impossible.
 */
export type CounterSequenceReservation = {
  counterRef: DocumentReference;
  counterExists: boolean;
  nextSeq: number;
};

/**
 * Read phase. Performs every read the reservation depends on and stages no
 * write, so a caller can compute the generated code from `nextSeq` and then
 * validate the identity conflict, code-registry claim, and enrollment state
 * before anything is committed. Under the single-call version those checks
 * could only run after the counter had already been staged.
 */
export async function readNextCounterSequenceInTransaction(
  tx: Transaction,
  db: DocumentStore,
  {
    counterId,
    collectionName,
    numberField,
    prefix,
    lookupExisting = true,
    extractSequence = extractHyphenSuffixSequence,
  }: CounterSequenceOptions
): Promise<CounterSequenceReservation> {
  const counterRef = db.collection('_counters').doc(counterId);
  const counterSnap = await tx.get(counterRef);
  let maxSeq = counterSnap.exists ? Number(counterSnap.data()?.seq || 0) : 0;
  if (lookupExisting) {
    const snapshot = await tx.get(
      db
        .collection(collectionName)
        .where(numberField, '>=', prefix)
        .where(numberField, '<', prefix + RANGE_END)
        .orderBy(numberField, 'desc')
        .limit(1)
    );
    const lastValue = snapshot.empty ? '' : snapshot.docs[0].data()[numberField];
    maxSeq = Math.max(maxSeq, extractSequence(lastValue, prefix));
  }

  return { counterRef, counterExists: counterSnap.exists, nextSeq: maxSeq + 1 };
}

/**
 * Write phase. Exactly one create or update, never a read — a DocumentStore retry
 * re-runs the read phase and produces a fresh reservation, so a value carried
 * across attempts would hand out a sequence another attempt already committed.
 */
export function writeCounterSequenceReservation(
  tx: Transaction,
  reservation: CounterSequenceReservation
): void {
  const updateData = { seq: reservation.nextSeq, updatedAt: FieldValue.serverTimestamp() };
  if (reservation.counterExists) {
    tx.update(reservation.counterRef, updateData);
  } else {
    tx.create(reservation.counterRef, updateData);
  }
}

/**
 * Compatibility wrapper for the counters that have no decision to make between
 * the phases. Kept so unrelated sequences (receipts, invoices, classes) keep
 * their exact current behavior while student creation moves to the split.
 */
export async function reserveNextCounterSequence(
  tx: Transaction,
  db: DocumentStore,
  options: CounterSequenceOptions
): Promise<number> {
  const reservation = await readNextCounterSequenceInTransaction(tx, db, options);
  writeCounterSequenceReservation(tx, reservation);
  return reservation.nextSeq;
}
