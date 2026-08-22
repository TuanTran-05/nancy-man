import {
  matchesAccountingSearchTerms,
  parseAccountingSearchTerms,
} from '../../../shared/accountingStudentFinance';

export type AccountingSearchableRow = {
  studentName?: string;
  studentNameNormalized?: string;
  studentCode?: string;
};

/**
 * Filters the loaded debt list as the accountant types, the way the student
 * directory does: every typed word has to appear somewhere in the name or code,
 * in any order and anywhere inside a word. Diacritics are ignored on both sides
 * so a name pasted from a report still finds its student.
 */
export function filterAccountingStudentRows<T extends AccountingSearchableRow>(
  rows: readonly T[],
  searchTerm: string
): T[] {
  const terms = parseAccountingSearchTerms(searchTerm);
  if (terms.length === 0) return [...rows];
  return rows.filter((row) => matchesAccountingSearchTerms(row, terms));
}
