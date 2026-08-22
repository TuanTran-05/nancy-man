import { beforeEach, describe, expect, it } from 'vitest';
import { readAccountingStudents } from './readers.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import {
  resetCanonicalStudentReadControlCacheForTests,
  STUDENT_IDENTITY_READ_MODEL_PATH,
} from '../../lib/student/canonicalStudentReadControl.js';
import { flushDeferredReadTelemetry } from '../../lib/telemetry/deferredReadTelemetry.js';
import type { UserContext } from '../../lib/auth/authz.js';

/**
 * The ledger fan-out behind the tuition column.
 *
 * DocumentStore caps an `in` filter at thirty ids, so a roster of six hundred is
 * twenty queries. Issuing them one after another made the finance read wait
 * through twenty round trips; issuing them all at once would throw away the
 * early exit that stops at the ledger cap. This file pins both ends: the rows
 * are the rows the sequential loop produced, and the read still stops well
 * short of the whole roster.
 */

const ADMIN: UserContext = { uid: 'admin-1', role: 'admin', name: 'Admin' };

const STUDENT_COUNT = 600;
const LEDGERS_PER_STUDENT = 3;
/** Mirrors ACCOUNTING_LEDGER_TOTAL_CAP in handlers/utils.ts. */
const LEDGER_TOTAL_CAP = 300;
/** Students whose ledgers fit under the cap: 300 / 3. */
const STUDENTS_WITHIN_CAP = LEDGER_TOTAL_CAP / LEDGERS_PER_STUDENT;

function paddedIndex(index: number) {
  return String(index).padStart(4, '0');
}

function seed() {
  const store: Record<string, Record<string, unknown>> = {
    [STUDENT_IDENTITY_READ_MODEL_PATH]: {
      schemaVersion: 1,
      mode: 'legacy_compare',
      generation: 1,
      activatedAt: '2026-08-08T00:00:00.000Z',
      activatedBy: 'admin:tt',
      normalizationRunId: null,
      planDigest: null,
      approvalDigest: null,
    },
    'classes/class-1': { name: 'G6', teacherId: 'teacher-1', status: 'active' },
    'users/teacher-1': { role: 'teacher', displayName: 'GV Một' },
  };

  for (let index = 0; index < STUDENT_COUNT; index += 1) {
    const studentId = `student-${paddedIndex(index)}`;
    store[`students/${studentId}`] = {
      // Name order is the page order, so the name and the index agree.
      name: `HS ${paddedIndex(index)}`,
      studentId: `HS${paddedIndex(index)}`,
      classId: 'class-1',
      teacherId: 'teacher-1',
      enrollmentStatus: 'active',
      studentLifecycle: 'enrolled',
    };
    for (let n = 0; n < LEDGERS_PER_STUDENT; n += 1) {
      store[`course_fee_ledgers/ledger-${paddedIndex(index)}-${n}`] = {
        studentId,
        classId: 'class-1',
        amount: 1000,
        status: 'unpaid',
      };
    }
  }

  return store;
}

function request(query: Record<string, string> = {}) {
  return { query } as never;
}

describe('readAccountingStudents ledger fan-out', () => {
  beforeEach(() => {
    resetCanonicalStudentReadControlCacheForTests();
  });

  it('returns the capped ledger set the sequential loop produced', async () => {
    const { db } = createInMemoryDocumentStore(seed());

    const result = (await readAccountingStudents(db, ADMIN, request({ limit: '2000' }))) as unknown as {
      ledgers: Array<{ id: string; studentId?: string }>;
      ledgerTruncated: boolean;
    };
    await flushDeferredReadTelemetry();

    expect(result.ledgers).toHaveLength(LEDGER_TOTAL_CAP);
    expect(result.ledgerTruncated).toBe(true);

    // The cap is taken from the front of the roster, in page order. Anything
    // else means the fan-out reordered the students under the tuition column.
    const owners = new Set(result.ledgers.map((ledger) => ledger.studentId));
    expect(owners.size).toBe(STUDENTS_WITHIN_CAP);
    for (const owner of owners) {
      const index = Number(String(owner).replace('student-', ''));
      expect(index).toBeLessThan(STUDENTS_WITHIN_CAP);
    }
  });

  it('stops well short of querying the whole roster', async () => {
    const { db, readLog } = createInMemoryDocumentStore(seed());

    await readAccountingStudents(db, ADMIN, request({ limit: '2000' }));
    await flushDeferredReadTelemetry();

    const ledgerQueries = readLog.filter((entry) => entry === 'query:course_fee_ledgers').length;
    const chunksForWholeRoster = Math.ceil(STUDENT_COUNT / 30);

    // Four chunks cover the cap; a bounded wave may overshoot by less than one
    // wave. Reading all twenty would mean the early exit is gone.
    expect(ledgerQueries).toBeGreaterThanOrEqual(4);
    expect(ledgerQueries).toBeLessThan(chunksForWholeRoster);
  });

  it('issues the chunks of a wave concurrently rather than one after another', async () => {
    const { db, readLog } = createInMemoryDocumentStore(seed());
    let inFlight = 0;
    let peakInFlight = 0;

    const instrumented = new Proxy(db as object, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== 'collection' || typeof value !== 'function') return value;
        return (name: string) => {
          const ref = (value as (n: string) => any).call(target, name);
          if (name !== 'course_fee_ledgers') return ref;
          const trace = (node: any): any =>
            new Proxy(node, {
              get(inner, innerProp, innerReceiver) {
                const innerValue = Reflect.get(inner, innerProp, innerReceiver);
                if (typeof innerValue !== 'function') return innerValue;
                if (innerProp === 'get') {
                  return async (...args: unknown[]) => {
                    inFlight += 1;
                    peakInFlight = Math.max(peakInFlight, inFlight);
                    try {
                      return await innerValue.apply(inner, args);
                    } finally {
                      inFlight -= 1;
                    }
                  };
                }
                return (...args: unknown[]) => trace(innerValue.apply(inner, args));
              },
            });
          return trace(ref);
        };
      },
    });

    await readAccountingStudents(instrumented as never, ADMIN, request({ limit: '2000' }));
    await flushDeferredReadTelemetry();

    expect(readLog.filter((entry) => entry === 'query:course_fee_ledgers').length).toBeGreaterThan(1);
    expect(peakInFlight).toBeGreaterThan(1);
  });
});
