import ExcelJS from 'exceljs';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { MAX_STUDENT_IMPORT_ROWS, parseStudentImportWorkbook } from './studentImport.js';

async function workbookBuffer(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Students');
  worksheet.addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('parseStudentImportWorkbook', () => {
  it('parses Vietnamese headers and normalizes gender and dates', async () => {
    const buffer = await workbookBuffer([
      ['Tên học sinh', 'Giới tính', 'Khối lớp', 'Ngày sinh', 'Lớp học', 'Liên hệ'],
      ['Nguyễn Văn A', 'Nam', 5, '15/09/2015', 'Lớp 5A', '0901234567'],
      ['Trần Thị B', 'Nữ', '6', '2014-08-20', 'Lớp 6A', 'parent@example.com'],
      ['Lê C', 'Khác', 7, new Date(2013, 4, 10), 'Lớp 7A', '0912345678'],
      ['Phạm D', 'Nam', 8, 42262, 'Lớp 8A', '0987654321'],
    ]);

    await expect(parseStudentImportWorkbook(buffer)).resolves.toEqual([
      {
        row: 2,
        name: 'Nguyễn Văn A',
        gender: 'male',
        grade: 5,
        dob: '2015-09-15',
        className: 'Lớp 5A',
        contact: '0901234567',
      },
      {
        row: 3,
        name: 'Trần Thị B',
        gender: 'female',
        grade: 6,
        dob: '2014-08-20',
        className: 'Lớp 6A',
        contact: 'parent@example.com',
      },
      {
        row: 4,
        name: 'Lê C',
        gender: 'other',
        grade: 7,
        dob: '2013-05-10',
        className: 'Lớp 7A',
        contact: '0912345678',
      },
      {
        row: 5,
        name: 'Phạm D',
        gender: 'male',
        grade: 8,
        dob: '2015-09-15',
        className: 'Lớp 8A',
        contact: '0987654321',
      },
    ]);
  });

  it('normalizes slash DOB values with missing zero padding', async () => {
    const buffer = await workbookBuffer([
      ['Tên học sinh', 'Giới tính', 'Khối lớp', 'Ngày sinh', 'Lớp học', 'Liên hệ'],
      ['Nguyen An', 'Nam', 6, '9/5/2025', '6A', '0900000000'],
    ]);

    await expect(parseStudentImportWorkbook(buffer)).resolves.toMatchObject([
      { name: 'Nguyen An', dob: '2025-05-09' },
    ]);
  });

  it('keeps Excel date cells as stored calendar dates regardless of display format', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Students');
    worksheet.addRow(['Tên học sinh', 'Giới tính', 'Khối lớp', 'Ngày sinh', 'Lớp học', 'Liên hệ']);
    worksheet.addRow(['Nguyen An', 'Nam', 6, null, '6A', '0900000000']);
    const dobCell = worksheet.getCell('D2');
    dobCell.value = new Date(2014, 10, 9);
    dobCell.numFmt = 'mm/dd/yyyy';

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(parseStudentImportWorkbook(buffer)).resolves.toMatchObject([
      { name: 'Nguyen An', dob: '2014-11-09' },
    ]);
  });

  it('rejects workbooks missing required headers', async () => {
    const buffer = await workbookBuffer([
      ['Tên học sinh', 'Ngày sinh', 'Lớp học', 'Liên hệ'],
      ['Nguyễn Văn A', '15/09/2015', 'Lớp 5A', '0901234567'],
    ]);

    await expect(parseStudentImportWorkbook(buffer)).rejects.toThrow(
      /Missing required column: Giới tính/
    );
  });

  it('rejects workbooks with more than 100 student rows', async () => {
    const rows = [
      ['Tên học sinh', 'Giới tính', 'Khối lớp', 'Ngày sinh', 'Lớp học', 'Liên hệ'],
      ...Array.from({ length: MAX_STUDENT_IMPORT_ROWS + 1 }, (_, index) => [
        `Student ${index + 1}`,
        'Nam',
        5,
        '2015-09-15',
        'Lớp 5A',
        '0901234567',
      ]),
    ];

    await expect(parseStudentImportWorkbook(await workbookBuffer(rows))).rejects.toThrow(
      /Cannot import more than 100 students/
    );
  });

  it('keeps template sample values in user-facing import formats', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(readFileSync('public/student-import-template.xlsx'));
    const worksheet = workbook.worksheets[0];

    expect(worksheet.getCell('D1').value).toBe('Ngày sinh');
    expect(worksheet.getCell('D2').value).toBe('20/08/2014');
    expect(worksheet.getCell('D2').numFmt).toBe('@');
    expect(worksheet.getCell('D20').numFmt).toBe('@');
    expect(worksheet.getCell('F1').value).toBe('Liên hệ');
    expect(worksheet.getCell('F2').value).toBe('0384072314');
    expect(worksheet.getCell('F2').numFmt).toBe('@');
    expect(worksheet.getCell('F20').numFmt).toBe('@');
  });
});
