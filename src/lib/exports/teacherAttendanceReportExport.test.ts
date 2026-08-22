import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportTeacherAttendanceReportWorkbook } from './teacherAttendanceReportExport';
import {
  buildTeacherAttendanceReportSheets,
  TEACHER_ATTENDANCE_REPORT_HEADERS,
  TEACHER_ATTENDANCE_REPORT_HEADERS_NO_SALARY,
} from './teacherAttendanceReportExport';
import type { OfficeTeachersMonthResponse } from '../api/officeTeachersApi';

const excel = vi.hoisted(() => ({ sheets: [] as any[] }));

vi.mock('exceljs', () => {
  class FakeRow {
    font: any = {};
    constructor(public values: any[]) {}
    eachCell(cb: (cell: any) => void) {
      this.values.forEach(() => cb({ border: {}, font: {}, alignment: {}, fill: {} }));
    }
    getCell() {
      return { numFmt: '', alignment: {}, border: {}, font: {} };
    }
  }
  class FakeWorksheet {
    columns: any[] = [];
    addedRows: FakeRow[] = [];
    mergeCells() {}
    getCell() {
      return { value: '', font: {}, alignment: {} };
    }
    addRow(values: any[] = []) {
      const row = new FakeRow(values);
      this.addedRows.push(row);
      return row;
    }
  }
  class FakeWorkbook {
    creator = '';
    created = new Date();
    xlsx = { writeBuffer: async () => new ArrayBuffer(8) };
    addWorksheet() {
      const worksheet = new FakeWorksheet();
      excel.sheets.push(worksheet);
      return worksheet;
    }
  }
  return { default: { Workbook: FakeWorkbook } };
});

vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

const monthData: OfficeTeachersMonthResponse = {
  month: '2026-06',
  range: { from: '2026-06-01', to: '2026-06-30' },
  serverTime: new Date('2026-06-30T10:00:00.000Z').getTime(),
  teachers: [
    { uid: 'teacher-1', displayName: 'Teacher One', email: 'one@test.com' },
    { uid: 'teacher-2', displayName: 'Teacher Two', email: 'two@test.com' },
    { uid: 'teacher-3', displayName: 'Teacher Three', email: 'three@test.com' },
  ],
  classes: [
    {
      id: 'class-1',
      name: 'Grade 8',
      teacherId: 'teacher-1',
      daysOfWeek: [1, 3],
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      startTime: '15:45',
      schedule: '15:45 - 17:15',
      status: 'active',
      holidays: [],
      salaryPerSession: 150000,
    },
    {
      id: 'class-2',
      name: 'Grade 3',
      teacherId: 'teacher-2',
      daysOfWeek: [2],
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      startTime: '17:30',
      schedule: '17:30 - 19:00',
      status: 'active',
      holidays: [],
      salaryPerSession: 175000,
    },
  ] as any,
  sessions: [
    {
      id: 'class-1_2026-06-01',
      classId: 'class-1',
      teacherId: 'teacher-1',
      date: '2026-06-01',
      status: 'taught',
      teacherAttendanceStatus: 'present',
    },
    {
      id: 'class-1_2026-06-03',
      classId: 'class-1',
      teacherId: 'teacher-1',
      date: '2026-06-03',
      status: 'taught',
      teacherAttendanceStatus: 'absent',
    },
    {
      id: 'class-1_2026-06-08',
      classId: 'class-1',
      teacherId: 'teacher-1',
      date: '2026-06-08',
      status: 'cancelled',
      teacherAttendanceStatus: 'present',
    },
    {
      id: 'class-2_2026-06-02',
      classId: 'class-2',
      teacherId: 'teacher-2',
      date: '2026-06-02',
      status: 'taught',
      teacherAttendanceStatus: 'present',
      salaryPerSession: 190000,
    },
  ] as any,
  substitutes: [],
};

describe('buildTeacherAttendanceReportSheets', () => {
  it('builds one paid monthly worksheet per selected teacher', () => {
    const sheets = buildTeacherAttendanceReportSheets({
      data: monthData,
      selectedTeacherIds: ['teacher-2', 'teacher-1'],
    });

    expect(sheets.map((sheet) => sheet.teacher.uid)).toEqual(['teacher-1', 'teacher-2']);
    expect(sheets[0]).toMatchObject({
      title: 'BANG CHAM CONG GIAO VIEN THANG 06/2026',
      monthLabel: '06/2026',
      totalAmount: 150000,
    });
    expect(sheets[0].rows).toEqual([
      {
        index: 1,
        date: '01/06/2026',
        className: 'Grade 8',
        weekday: 'T2',
        schedule: '15:45 - 17:15',
        amount: 150000,
        note: '',
      },
    ]);
    expect(sheets[1].rows).toEqual([
      expect.objectContaining({
        date: '02/06/2026',
        className: 'Grade 3',
        weekday: 'T3',
        schedule: '17:30 - 19:00',
        amount: 190000,
      }),
    ]);
    expect(sheets[1].totalAmount).toBe(190000);
  });

  it('can include every teacher while preserving empty teacher worksheets', () => {
    const sheets = buildTeacherAttendanceReportSheets({
      data: monthData,
      selectedTeacherIds: ['all'],
    });

    expect(sheets.map((sheet) => sheet.teacher.uid)).toEqual([
      'teacher-1',
      'teacher-2',
      'teacher-3',
    ]);
    expect(sheets[2].rows).toEqual([]);
    expect(sheets[2].totalAmount).toBe(0);
  });

  it('omits period and per-period price headers', () => {
    expect(TEACHER_ATTENDANCE_REPORT_HEADERS).toEqual([
      'STT',
      'NGAY',
      'LOP',
      'THU',
      'GIO HOC',
      'THANH TIEN',
      'GHI CHU',
    ]);
    expect(TEACHER_ATTENDANCE_REPORT_HEADERS).not.toContain('SO TIET');
    expect(TEACHER_ATTENDANCE_REPORT_HEADERS).not.toContain('VND/TIET');
  });
});

describe('teacher attendance report salary variants', () => {
  it('keeps the money column by default', () => {
    const sheets = buildTeacherAttendanceReportSheets({
      data: monthData,
      selectedTeacherIds: ['teacher-1'],
    });

    expect(sheets[0].includeSalary).toBe(true);
    expect(sheets[0].totalAmount).toBeGreaterThan(0);
    expect(sheets[0].rows[0].amount).toBe(150000);
  });

  it('zeroes out money and flags the sheet when includeSalary is false', () => {
    const sheets = buildTeacherAttendanceReportSheets({
      data: monthData,
      selectedTeacherIds: ['teacher-1'],
      includeSalary: false,
    });

    expect(sheets[0].includeSalary).toBe(false);
    expect(sheets[0].totalAmount).toBe(0);
    expect(sheets[0].rows.every((row) => row.amount === 0)).toBe(true);
  });

  it('still lists the same worked sessions when money is hidden', () => {
    const withSalary = buildTeacherAttendanceReportSheets({
      data: monthData,
      selectedTeacherIds: ['teacher-1'],
    });
    const withoutSalary = buildTeacherAttendanceReportSheets({
      data: monthData,
      selectedTeacherIds: ['teacher-1'],
      includeSalary: false,
    });

    expect(withoutSalary[0].rows.map((row) => row.date)).toEqual(
      withSalary[0].rows.map((row) => row.date)
    );
  });

  it('exposes a six column header without the money column', () => {
    expect(TEACHER_ATTENDANCE_REPORT_HEADERS).toContain('THANH TIEN');
    expect(TEACHER_ATTENDANCE_REPORT_HEADERS_NO_SALARY).not.toContain('THANH TIEN');
    expect(TEACHER_ATTENDANCE_REPORT_HEADERS_NO_SALARY).toHaveLength(6);
  });
});

describe('teacher attendance workbook money column', () => {
  beforeEach(() => {
    excel.sheets.length = 0;
  });

  const headerOf = (sheet: any) => sheet.addedRows.find((row: any) => row.values[0] === 'STT');
  const hasTotalRow = (sheet: any) => sheet.addedRows.some((row: any) => row.values[2] === 'Tong');

  it('renders seven columns with the money column and a total row by default', async () => {
    await exportTeacherAttendanceReportWorkbook({
      data: monthData,
      selectedTeacherIds: ['teacher-1'],
    });

    const sheet = excel.sheets[0];
    expect(sheet.columns).toHaveLength(7);
    expect(headerOf(sheet).values).toContain('THANH TIEN');
    expect(hasTotalRow(sheet)).toBe(true);
  });

  it('renders six columns with no money column and no total row when salary is hidden', async () => {
    await exportTeacherAttendanceReportWorkbook({
      data: monthData,
      selectedTeacherIds: ['teacher-1'],
      includeSalary: false,
    });

    const sheet = excel.sheets[0];
    expect(sheet.columns).toHaveLength(6);
    expect(headerOf(sheet).values).not.toContain('THANH TIEN');
    expect(hasTotalRow(sheet)).toBe(false);
  });

  it('never writes a salary figure into an office sheet', async () => {
    await exportTeacherAttendanceReportWorkbook({
      data: monthData,
      selectedTeacherIds: ['teacher-1'],
      includeSalary: false,
    });

    const written = excel.sheets[0].addedRows.flatMap((row: any) => row.values);
    expect(written).not.toContain(150000);
    expect(written).not.toContain(175000);
  });
});
