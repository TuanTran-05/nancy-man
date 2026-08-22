import { describe, expect, it } from 'vitest';
import {
  buildCourseLedgerId,
  courseLedgerTupleKey,
  indexLedgersByTuple,
} from './courseLedgerIdentity.js';

describe('courseLedgerTupleKey', () => {
  it('keys on student, class and termStart only', () => {
    expect(courseLedgerTupleKey('s1', 'c1', '2026-01-05')).toBe('s1|c1|2026-01-05');
  });
});

describe('buildCourseLedgerId', () => {
  it('keeps the legacy four-part shape so existing doc ids stay reachable', () => {
    expect(buildCourseLedgerId('s1', 'c1', '2026-01-05', '2026-06-05')).toBe(
      's1_c1_2026-01-05_2026-06-05'
    );
  });

  it('substitutes placeholders for a missing term', () => {
    expect(buildCourseLedgerId('s1', 'c1', '', '')).toBe('s1_c1_no_start_no_end');
  });

  it('replaces characters that are illegal in a document id', () => {
    expect(buildCourseLedgerId('s/1', 'c 1', '2026-01-05', '2026-06-05')).toBe(
      's_1_c_1_2026-01-05_2026-06-05'
    );
  });
});

describe('indexLedgersByTuple', () => {
  it('groups ledgers that share a tuple even when termEnd differs', () => {
    const index = indexLedgersByTuple('c1', [
      { id: 'a', studentId: 's1', termStart: '2026-01-05' },
      { id: 'b', studentId: 's1', termStart: '2026-01-05' },
      { id: 'c', studentId: 's2', termStart: '2026-01-05' },
    ]);

    expect(index.get('s1|c1|2026-01-05')?.map((row) => row.id)).toEqual(['a', 'b']);
    expect(index.get('s2|c1|2026-01-05')?.map((row) => row.id)).toEqual(['c']);
  });

  it('ignores ledgers without a usable studentId or termStart', () => {
    const index = indexLedgersByTuple('c1', [
      { id: 'a', studentId: '', termStart: '2026-01-05' },
      { id: 'b', studentId: 's1', termStart: undefined },
      { id: 'c', studentId: 's1', termStart: 20260105 },
    ]);

    expect(index.size).toBe(0);
  });
});
