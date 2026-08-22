import { describe, expect, it } from 'vitest';
import {
  courseLedgerTupleKey,
  findExistingCourseLedger,
} from '../../lib/accounting/courseLedgerIdentity.js';

describe('findExistingCourseLedger', () => {
  const docs = [
    {
      id: 's1_c2_2026-01-05_2026-06-05',
      data: () => ({ studentId: 's1', termStart: '2026-01-05' }),
    },
  ];

  it('matches a ledger whose termEnd has since shifted', () => {
    expect(
      findExistingCourseLedger(docs, courseLedgerTupleKey('s1', 'c2', '2026-01-05'), 'c2')
    ).toBe(true);
  });

  it('does not match a different term of the same class', () => {
    expect(
      findExistingCourseLedger(docs, courseLedgerTupleKey('s1', 'c2', '2026-07-01'), 'c2')
    ).toBe(false);
  });

  it('does not match an empty result set', () => {
    expect(findExistingCourseLedger([], courseLedgerTupleKey('s1', 'c2', '2026-01-05'), 'c2')).toBe(
      false
    );
  });

  it('ignores rows missing studentId or termStart', () => {
    const broken = [{ id: 'x', data: () => ({ studentId: 's1' }) }];
    expect(
      findExistingCourseLedger(broken, courseLedgerTupleKey('s1', 'c2', '2026-01-05'), 'c2')
    ).toBe(false);
  });
});
