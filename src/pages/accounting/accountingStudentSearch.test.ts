import { describe, expect, it } from 'vitest';
import { filterAccountingStudentRows } from './accountingStudentSearch';

const rows = [
  {
    studentId: 's1',
    studentName: 'Nguyễn Văn An',
    studentNameNormalized: 'nguyen van an',
    studentCode: 'HS001',
  },
  {
    studentId: 's2',
    studentName: 'Nguyễn Thị Bình',
    studentNameNormalized: 'nguyen thi binh',
    studentCode: 'HS002',
  },
  {
    studentId: 's3',
    studentName: 'Trần Văn An',
    studentNameNormalized: 'tran van an',
    studentCode: 'HS003',
  },
];

const names = (search: string) =>
  filterAccountingStudentRows(rows, search).map((row) => row.studentName);

describe('filterAccountingStudentRows', () => {
  it('returns every row when nothing is typed', () => {
    expect(names('')).toHaveLength(3);
    expect(names('   ')).toHaveLength(3);
  });

  it('narrows the list on the very first character typed', () => {
    expect(names('n')).toEqual(['Nguyễn Văn An', 'Nguyễn Thị Bình', 'Trần Văn An']);
    expect(names('ng')).toEqual(['Nguyễn Văn An', 'Nguyễn Thị Bình']);
  });

  it('matches the middle of a word, not only its start', () => {
    expect(names('uyen')).toEqual(['Nguyễn Văn An', 'Nguyễn Thị Bình']);
  });

  it('finds the student when a full name is pasted with diacritics', () => {
    expect(names('Nguyễn Văn An')).toEqual(['Nguyễn Văn An']);
  });

  it('finds the student when a full name is pasted without diacritics', () => {
    expect(names('nguyen van an')).toEqual(['Nguyễn Văn An']);
  });

  it('requires every typed word to match, in any order', () => {
    expect(names('an van')).toEqual(['Nguyễn Văn An', 'Trần Văn An']);
    expect(names('binh nguyen')).toEqual(['Nguyễn Thị Bình']);
  });

  it('ignores padded and repeated whitespace from a paste', () => {
    expect(names('  Nguyễn   Văn  An  ')).toEqual(['Nguyễn Văn An']);
  });

  it('matches the student code regardless of case', () => {
    expect(names('hs002')).toEqual(['Nguyễn Thị Bình']);
    expect(names('HS002')).toEqual(['Nguyễn Thị Bình']);
  });

  it('returns nothing for a name that is not in the list', () => {
    expect(names('Lê Văn Cường')).toEqual([]);
  });

  it('falls back to the display name when the normalized name is missing', () => {
    const partial = [{ studentId: 's4', studentName: 'Phạm Quốc Huy', studentCode: 'HS004' }];
    expect(filterAccountingStudentRows(partial, 'quoc huy')).toHaveLength(1);
  });
});
