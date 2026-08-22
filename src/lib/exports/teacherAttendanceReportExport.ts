import type { OfficeTeacherProfile, OfficeTeachersMonthResponse } from '../api/officeTeachersApi';
import { formatVndAmount } from '../core/moneyFormat';
import { buildTeacherPayrollMonthView } from '../payroll/teacherPayrollMonth';

export const TEACHER_ATTENDANCE_REPORT_HEADERS = [
  'STT',
  'NGAY',
  'LOP',
  'THU',
  'GIO HOC',
  'THANH TIEN',
  'GHI CHU',
] as const;

export const TEACHER_ATTENDANCE_REPORT_HEADERS_NO_SALARY = [
  'STT',
  'NGAY',
  'LOP',
  'THU',
  'GIO HOC',
  'GHI CHU',
] as const;

export type TeacherAttendanceReportRow = {
  index: number;
  date: string;
  className: string;
  weekday: string;
  schedule: string;
  amount: number;
  note: string;
};

export type TeacherAttendanceReportSheet = {
  teacher: OfficeTeacherProfile;
  title: string;
  monthLabel: string;
  rows: TeacherAttendanceReportRow[];
  totalAmount: number;
  includeSalary: boolean;
};

type BuildInput = {
  data: OfficeTeachersMonthResponse;
  selectedTeacherIds: string[];
  includeSalary?: boolean;
};

function formatMonthLabel(month: string) {
  const [year, value] = month.split('-');
  return year && value ? `${value}/${year}` : month;
}

function formatDateLabel(date: string) {
  const [year, month, day] = date.split('-');
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function isAllTeachersSelection(selectedTeacherIds: string[]) {
  return selectedTeacherIds.length === 0 || selectedTeacherIds.includes('all');
}

export function buildTeacherAttendanceReportSheets({
  data,
  selectedTeacherIds,
  includeSalary = true,
}: BuildInput): TeacherAttendanceReportSheet[] {
  const selected = new Set(selectedTeacherIds);
  const monthLabel = formatMonthLabel(data.month);
  const allTeachers = isAllTeachersSelection(selectedTeacherIds);

  const view = buildTeacherPayrollMonthView(data);

  const teacherRowsById = new Map(
    view.rows.map((teacherRow) => [teacherRow.teacher.uid, teacherRow])
  );

  return data.teachers
    .map((teacher) => teacherRowsById.get(teacher.uid))
    .filter((teacherRow) => Boolean(teacherRow))
    .filter((teacherRow) => allTeachers || selected.has(teacherRow!.teacher.uid))
    .map((teacherRow) => {
      const row = teacherRow!;
      const rows = row.paidRows.map((paidRow, index) => ({
        index: index + 1,
        date: formatDateLabel(paidRow.date),
        className: paidRow.className,
        weekday: paidRow.weekday,
        schedule: paidRow.schedule,
        amount: includeSalary ? paidRow.amount : 0,
        note: paidRow.note,
      }));

      return {
        teacher: row.teacher,
        title: `BANG CHAM CONG GIAO VIEN THANG ${monthLabel}`,
        monthLabel,
        rows,
        totalAmount: includeSalary ? rows.reduce((sum, row) => sum + row.amount, 0) : 0,
        includeSalary,
      };
    });
}

function safeWorksheetName(name: string, fallback: string) {
  const cleaned = (name || fallback).replace(/[\\/?*[\]:]/g, ' ').trim();
  return (cleaned || fallback).slice(0, 31);
}

function currency(value: number) {
  return formatVndAmount(value);
}

export async function exportTeacherAttendanceReportWorkbook(input: BuildInput) {
  const sheets = buildTeacherAttendanceReportSheets(input);
  const [{ default: ExcelJS }, { saveAs }] = await Promise.all([
    import('exceljs'),
    import('file-saver'),
  ]);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EduTrack';
  workbook.created = new Date();

  sheets.forEach((sheet, sheetIndex) => {
    const worksheet = workbook.addWorksheet(
      safeWorksheetName(sheet.teacher.displayName, `Teacher ${sheetIndex + 1}`)
    );
    const headers = sheet.includeSalary
      ? TEACHER_ATTENDANCE_REPORT_HEADERS
      : TEACHER_ATTENDANCE_REPORT_HEADERS_NO_SALARY;
    const lastColumn = sheet.includeSalary ? 'G' : 'F';
    const amountColumn = 6;

    worksheet.columns = sheet.includeSalary
      ? [
          { width: 8 },
          { width: 14 },
          { width: 24 },
          { width: 10 },
          { width: 18 },
          { width: 16 },
          { width: 24 },
        ]
      : [{ width: 8 }, { width: 14 }, { width: 24 }, { width: 10 }, { width: 18 }, { width: 24 }];

    worksheet.mergeCells(`A1:${lastColumn}1`);
    worksheet.getCell('A1').value = sheet.title;
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells(`A2:${lastColumn}2`);
    worksheet.getCell('A2').value = `Teacher: ${sheet.teacher.displayName || ''}`;
    worksheet.getCell('A2').font = { bold: true };

    worksheet.addRow([]);
    const headerRow = worksheet.addRow([...headers]);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    sheet.rows.forEach((row) => {
      const cells = sheet.includeSalary
        ? [row.index, row.date, row.className, row.weekday, row.schedule, row.amount, row.note]
        : [row.index, row.date, row.className, row.weekday, row.schedule, row.note];
      const excelRow = worksheet.addRow(cells);
      excelRow.getCell(1).alignment = { horizontal: 'center' };
      excelRow.getCell(4).alignment = { horizontal: 'center' };
      if (sheet.includeSalary) excelRow.getCell(amountColumn).numFmt = '#,##0';
      excelRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    });

    if (sheet.includeSalary) {
      const totalRow = worksheet.addRow(['', '', 'Tong', '', '', sheet.totalAmount, '']);
      totalRow.font = { bold: true };
      totalRow.getCell(amountColumn).numFmt = '#,##0';
      totalRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, `teacher-attendance-${input.data.month}.xlsx`);
}
