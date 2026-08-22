import { describe, expect, it } from 'vitest';
import {
  readNextCounterSequenceInTransaction,
  reserveNextCounterSequence,
  writeCounterSequenceReservation,
  type CounterSequenceOptions,
} from './counterSequence.js';

const OPTIONS: CounterSequenceOptions = {
  counterId: 'students-260807',
  collectionName: 'students',
  numberField: 'studentId',
  prefix: 'HS260807',
};

/**
 * Records reads and writes in order. The split exists so a caller can decide
 * an entire creation — generated code, registry claim, identity conflict —
 * before the first write lands. A read hiding behind the write phase would
 * quietly restore the ordering bug the split is meant to remove, so the log
 * is the assertion, not the return value.
 */
function makeTx(counterDoc: Record<string, unknown> | undefined, lastValue = '') {
  const log: string[] = [];
  const tx = {
    log,
    async get(target: { path?: string; __query?: string }) {
      if (target.__query) {
        log.push(`read:${target.__query}`);
        return {
          empty: lastValue === '',
          docs: lastValue === '' ? [] : [{ data: () => ({ studentId: lastValue }) }],
        };
      }
      log.push(`read:${target.path}`);
      return { exists: counterDoc !== undefined, data: () => counterDoc };
    },
    create(ref: { path: string }, value: unknown) {
      log.push(`create:${ref.path}`);
      return value;
    },
    update(ref: { path: string }, value: unknown) {
      log.push(`update:${ref.path}`);
      return value;
    },
  };
  return tx;
}

function makeDb() {
  const query = {
    __query: '_query:students.studentId',
    where: () => query,
    orderBy: () => query,
    limit: () => query,
  };
  return {
    collection(name: string) {
      return {
        doc(id: string) {
          return { path: `${name}/${id}` };
        },
        where: () => query,
      };
    },
  };
}

describe('readNextCounterSequenceInTransaction', () => {
  it('reads the counter and the legacy maximum without writing anything', async () => {
    const tx = makeTx({ seq: 4 }, 'HS26080709');

    const reservation = await readNextCounterSequenceInTransaction(
      tx as never,
      makeDb() as never,
      { ...OPTIONS, extractSequence: (value) => Number(String(value).slice(-2)) }
    );

    expect(tx.log).toEqual(['read:_counters/students-260807', 'read:_query:students.studentId']);
    expect(reservation).toMatchObject({ counterExists: true, nextSeq: 10 });
  });

  it('reports a missing counter document instead of assuming it exists', async () => {
    const tx = makeTx(undefined);

    const reservation = await readNextCounterSequenceInTransaction(tx as never, makeDb() as never, {
      ...OPTIONS,
      lookupExisting: false,
    });

    expect(reservation).toMatchObject({ counterExists: false, nextSeq: 1 });
    expect(tx.log).toEqual(['read:_counters/students-260807']);
  });

  it('skips the legacy scan when the caller opts out', async () => {
    const tx = makeTx({ seq: 7 });

    const reservation = await readNextCounterSequenceInTransaction(tx as never, makeDb() as never, {
      ...OPTIONS,
      lookupExisting: false,
    });

    expect(tx.log).toEqual(['read:_counters/students-260807']);
    expect(reservation.nextSeq).toBe(8);
  });
});

describe('writeCounterSequenceReservation', () => {
  it('updates an existing counter with exactly one write', () => {
    const tx = makeTx({ seq: 4 });

    writeCounterSequenceReservation(tx as never, {
      counterRef: { path: '_counters/students-260807' } as never,
      counterExists: true,
      nextSeq: 5,
    });

    expect(tx.log).toEqual(['update:_counters/students-260807']);
  });

  it('creates a missing counter with exactly one write', () => {
    const tx = makeTx(undefined);

    writeCounterSequenceReservation(tx as never, {
      counterRef: { path: '_counters/students-260807' } as never,
      counterExists: false,
      nextSeq: 1,
    });

    expect(tx.log).toEqual(['create:_counters/students-260807']);
  });

  it('performs no read, so it can never run before the decision it commits', () => {
    const tx = makeTx({ seq: 1 });

    writeCounterSequenceReservation(tx as never, {
      counterRef: { path: '_counters/students-260807' } as never,
      counterExists: true,
      nextSeq: 2,
    });

    expect(tx.log.some((entry) => entry.startsWith('read:'))).toBe(false);
  });
});

describe('reserveNextCounterSequence compatibility', () => {
  it('still reads then writes in one call for unrelated counters', async () => {
    const tx = makeTx({ seq: 11 }, '');

    const next = await reserveNextCounterSequence(tx as never, makeDb() as never, {
      ...OPTIONS,
      lookupExisting: false,
    });

    expect(next).toBe(12);
    expect(tx.log).toEqual(['read:_counters/students-260807', 'update:_counters/students-260807']);
  });

  it('creates the counter on first use', async () => {
    const tx = makeTx(undefined);

    const next = await reserveNextCounterSequence(tx as never, makeDb() as never, {
      ...OPTIONS,
      lookupExisting: false,
    });

    expect(next).toBe(1);
    expect(tx.log).toEqual(['read:_counters/students-260807', 'create:_counters/students-260807']);
  });

  it('recomputes the same contract when DocumentStore retries the transaction', async () => {
    // Contention re-runs the whole transaction body against fresh data. The
    // reservation must be derived from that fresh read every time; a value
    // cached across attempts would hand out a sequence number another attempt
    // already committed.
    const attempts: number[] = [];
    for (const seq of [4, 9]) {
      const tx = makeTx({ seq });
      const reservation = await readNextCounterSequenceInTransaction(
        tx as never,
        makeDb() as never,
        { ...OPTIONS, lookupExisting: false }
      );
      writeCounterSequenceReservation(tx as never, reservation);
      attempts.push(reservation.nextSeq);
      expect(tx.log).toEqual([
        'read:_counters/students-260807',
        'update:_counters/students-260807',
      ]);
    }

    expect(attempts).toEqual([5, 10]);
  });
});
