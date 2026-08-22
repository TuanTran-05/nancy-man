import { describe, expect, it } from 'vitest';
import {
  buildAccountingSearchTokens,
  matchesAccountingSearchTerms,
  parseAccountingSearchTerms,
  selectAccountingSearchIndexTerm,
} from './accountingStudentFinance.js';

const tokens = buildAccountingSearchTokens('Nguyễn Văn An', 'HS001');

function findsStudent(search: string): boolean {
  const terms = parseAccountingSearchTerms(search);
  const indexTerm = selectAccountingSearchIndexTerm(terms);
  if (indexTerm && !tokens.includes(indexTerm)) return false;
  return matchesAccountingSearchTerms(
    { studentNameNormalized: 'nguyen van an', studentCode: 'HS001' },
    terms
  );
}

describe('accounting student search tokens', () => {
  it('indexes every word and its prefixes', () => {
    expect(tokens).toContain('nguyen');
    expect(tokens).toContain('nguy');
    expect(tokens).toContain('van');
    expect(tokens).toContain('an');
  });

  it('indexes the student code in lower case so a lowercased query matches', () => {
    expect(tokens).toContain('hs001');
  });
});

describe('accounting student search matching', () => {
  it('finds a student when the full name is pasted with diacritics', () => {
    expect(findsStudent('Nguyễn Văn An')).toBe(true);
  });

  it('finds a student when the full name is pasted without diacritics', () => {
    expect(findsStudent('Nguyen Van An')).toBe(true);
  });

  it('finds a student from a partial multi-word name', () => {
    expect(findsStudent('Văn An')).toBe(true);
  });

  it('tolerates padded and repeated whitespace from a paste', () => {
    expect(findsStudent('  Nguyễn   Văn  An  ')).toBe(true);
  });

  it('still finds a student by a single word or prefix', () => {
    expect(findsStudent('Nguyễn')).toBe(true);
    expect(findsStudent('nguy')).toBe(true);
  });

  it('finds a student by student code regardless of case', () => {
    expect(findsStudent('HS001')).toBe(true);
    expect(findsStudent('hs001')).toBe(true);
  });

  it('does not match a name that only shares one word', () => {
    expect(findsStudent('Nguyễn Thị Bình')).toBe(false);
  });
});

describe('selectAccountingSearchIndexTerm', () => {
  it('returns null when there is nothing to search', () => {
    expect(selectAccountingSearchIndexTerm(parseAccountingSearchTerms('   '))).toBeNull();
  });

  it('picks the longest term so the indexed query is the most selective one', () => {
    expect(selectAccountingSearchIndexTerm(['an', 'nguyen', 'van'])).toBe('nguyen');
  });

  it('truncates to the indexed prefix length so long words still hit the index', () => {
    const longTokens = buildAccountingSearchTokens('Konstantinopolitanus Le', 'HS002');
    const term = selectAccountingSearchIndexTerm(parseAccountingSearchTerms('Konstantinopolitanus'));
    expect(term).toBe('konstantinop');
    expect(longTokens).toContain(term);
  });
});
