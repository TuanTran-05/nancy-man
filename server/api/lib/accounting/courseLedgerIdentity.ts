/**
 * A course fee ledger is identified by the business tuple
 * (studentId, classId, termStart) — the same tuple that identifies an
 * enrollment. `termEnd` is mutable metadata: holiday extensions rewrite
 * `class.endDate`, so including it in the key produced duplicate debt.
 *
 * Doc ids keep their historical four-part shape. They are addresses, not the
 * dedupe mechanism; existence is decided by tuple lookup.
 */

export type TupleIndexedLedger = { id: string; studentId?: unknown; termStart?: unknown };

export function courseLedgerTupleKey(
  studentId: string,
  classId: string,
  termStart: string
): string {
  return `${studentId}|${classId}|${termStart}`;
}

export function buildCourseLedgerId(
  studentId: string,
  classId: string,
  termStart: string,
  termEnd: string
): string {
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return [studentId, classId, termStart || 'no_start', termEnd || 'no_end'].map(clean).join('_');
}

/**
 * Whether a ledger already exists for a (studentId, classId, termStart) tuple.
 *
 * Matched by tuple, not by doc id: holiday extensions rewrite `class.endDate`,
 * so an existing ledger for the same course can live under an id computed with
 * a different `termEnd` than the one in hand right now.
 */
export function findExistingCourseLedger(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>,
  tupleKey: string,
  classId: string
): boolean {
  return docs.some((docSnap) => {
    const row = docSnap.data() || {};
    const studentId = typeof row.studentId === 'string' ? row.studentId : '';
    const termStart = typeof row.termStart === 'string' ? row.termStart : '';
    if (!studentId || !termStart) return false;
    return courseLedgerTupleKey(studentId, classId, termStart) === tupleKey;
  });
}

export function indexLedgersByTuple(
  classId: string,
  ledgers: TupleIndexedLedger[]
): Map<string, TupleIndexedLedger[]> {
  const index = new Map<string, TupleIndexedLedger[]>();
  for (const ledger of ledgers) {
    const studentId = typeof ledger.studentId === 'string' ? ledger.studentId : '';
    const termStart = typeof ledger.termStart === 'string' ? ledger.termStart : '';
    if (!studentId || !termStart) continue;
    const key = courseLedgerTupleKey(studentId, classId, termStart);
    const bucket = index.get(key);
    if (bucket) bucket.push(ledger);
    else index.set(key, [ledger]);
  }
  return index;
}
