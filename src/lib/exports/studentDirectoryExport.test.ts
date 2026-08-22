import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STUDENT_DIRECTORY_EXPORT_COLUMN_KEYS,
  buildStudentDirectoryExportRows,
  exportStudentDirectoryWorkbook,
  formatExportDate,
  resolveStudentStatusKey,
  type StudentDirectoryExportLabels,
  type StudentDirectoryExportStudent,
} from './studentDirectoryExport';

const excel = vi.hoisted(() => ({ sheets: [] as any[], saved: [] as string[] }));

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
    views: any[] = [];
    autoFilter: any = null;
    cells: Record<string, any> = {};
    addedRows: FakeRow[] = [];
    mergeCells() {}
    getCell(address: string) {
      this.cells[address] = this.cells[address] || { value: '', font: {}, alignment: {} };
      return this.cells[address];
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

vi.mock('file-saver', () => ({
  saveAs: vi.fn((_blob: Blob, fileName: string) => {
    excel.saved.push(fileName);
  }),
}));

vi.mock('../api/readApi', () => ({
  readAllStudentPages: vi.fn(async () => []),
}));

const labels: StudentDirectoryExportLabels = {
  sheetName: 'Danh sách học sinh',
  title: 'DANH SÁCH HỌC SINH TOÀN TRUNG TÂM',
  generatedAt: 'Ngày xuất: 25/07/2026',
  totalStudents: 'Tổng số học sinh: {count}',
  headers: {
    index: 'STT',
    studentId: 'Mã học sinh',
    name: 'Họ và tên',
    dob: 'Ngày sinh',
    gender: 'Giới tính',
    contact: 'Số điện thoại',
    grade: 'Khối lớp',
    className: 'Lớp học hiện tại',
    teacher: 'Giáo viên chủ nhiệm',
    status: 'Trạng thái',
    enrollmentDate: 'Ngày nhập học',
    createdAt: 'Ngày tạo hồ sơ',
  },
  gender: { male: 'Nam', female: 'Nữ', other: 'Khác', unknown: 'Chưa cập nhật' },
  status: {
    active: 'Đang học',
    on_leave: 'Nghỉ phép',
    dropped: 'Thôi học',
    promoted: 'Chờ xếp lớp mới',
    trial: 'Học thử',
    archived: 'Lưu trữ',
  },
  unassignedClass: 'Chưa xếp lớp',
  unknownTeacher: 'Chưa phân công',
};

const classes = [
  { id: 'class-1', name: 'Aptis A1', teacherId: 'teacher-1' },
  { id: 'class-2', name: 'Beginner B2', teacherId: 'teacher-2' },
];

const teachers = [
  { uid: 'teacher-1', displayName: 'Cô Hương' },
  { uid: 'teacher-2', displayName: 'Thầy Tuấn' },
];

const students: StudentDirectoryExportStudent[] = [
  {
    id: 's1',
    studentId: 'HS001',
    name: 'NGUYỄN VĂN A',
    dob: '2012-03-05',
    contact: '0912345678',
    classId: 'class-2',
    teacherId: 'teacher-2',
    gender: 'male',
    grade: 7,
    enrollmentStatus: 'active',
    studentLifecycle: 'enrolled',
    enrollmentDate: '2025-09-01T00:00:00.000Z',
    createdAt: '2025-08-20T03:00:00.000Z',
  },
  {
    id: 's2',
    studentId: 'HS002',
    name: 'TRẦN THỊ B',
    dob: '2013-11-20',
    contact: '0987654321',
    classId: 'class-1',
    teacherId: 'teacher-1',
    gender: 'female',
    grade: 6,
    enrollmentStatus: 'on_leave',
    studentLifecycle: 'enrolled',
    enrollmentDate: '2024-05-10T00:00:00.000Z',
    createdAt: '2024-05-01T03:00:00.000Z',
  },
  {
    id: 's3',
    studentId: 'HS003',
    name: 'LÊ VĂN C',
    dob: '2014-01-02',
    contact: '0900000003',
    classId: '',
    gender: undefined,
    enrollmentStatus: 'active',
    studentLifecycle: 'trial',
    createdAt: '2026-01-05T03:00:00.000Z',
  },
];

describe('buildStudentDirectoryExportRows', () => {
  it('exports every student of the center with the full profile columns', () => {
    const rows = buildStudentDirectoryExportRows({ students, classes, teachers, labels });

    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({
      index: 2,
      studentId: 'HS001',
      name: 'NGUYỄN VĂN A',
      dob: '05/03/2012',
      gender: 'Nam',
      contact: '0912345678',
      grade: '7',
      className: 'Beginner B2',
      teacherName: 'Thầy Tuấn',
      status: 'Đang học',
      enrollmentDate: '01/09/2025',
      createdAt: '20/08/2025',
    });
  });

  it('sorts by class then name and pushes unassigned students to the end', () => {
    const rows = buildStudentDirectoryExportRows({ students, classes, teachers, labels });

    expect(rows.map((row) => row.className)).toEqual(['Aptis A1', 'Beginner B2', 'Chưa xếp lớp']);
    expect(rows[2]).toMatchObject({
      index: 3,
      studentId: 'HS003',
      teacherName: 'Chưa phân công',
      status: 'Học thử',
      gender: 'Chưa cập nhật',
      grade: '',
      enrollmentDate: '',
    });
  });

  it('keeps students whose enrollment date is missing instead of dropping them', () => {
    const rows = buildStudentDirectoryExportRows({ students, classes, teachers, labels });
    expect(rows.map((row) => row.studentId)).toContain('HS003');
  });

  it('scopes the export to one class when a class id is given', () => {
    const rows = buildStudentDirectoryExportRows({
      students,
      classes,
      teachers,
      labels,
      classId: 'class-1',
    });

    expect(rows.map((row) => row.studentId)).toEqual(['HS002']);
    expect(rows[0].status).toBe('Nghỉ phép');
    expect(rows[0].teacherName).toBe('Cô Hương');
  });

  it('exports the rows it was given rather than deciding which are the same child', () => {
    // Two documents sharing a code is the duplicate the normalization run
    // exists to fix. Collapsing it here keys on name, date of birth, and
    // contact — the three fields such a pair always agrees on — so it could
    // only ever hide the duplicate from the person exporting the list.
    const duplicated: StudentDirectoryExportStudent[] = [
      ...students,
      {
        ...students[0],
        id: 's1-old',
        enrollmentStatus: 'promoted',
      },
    ];

    const rows = buildStudentDirectoryExportRows({
      students: duplicated,
      classes,
      teachers,
      labels,
    });

    expect(rows.filter((row) => row.studentId === 'HS001')).toHaveLength(2);
  });

  it('falls back to the student teacher when the class has none', () => {
    const rows = buildStudentDirectoryExportRows({
      students: [{ ...students[0], classId: 'class-unknown' }],
      classes,
      teachers,
      labels,
    });

    expect(rows[0]).toMatchObject({
      className: 'Chưa xếp lớp',
      teacherName: 'Thầy Tuấn',
    });
  });
});

describe('formatExportDate', () => {
  it('renders api dates, iso datetimes and blanks', () => {
    expect(formatExportDate('2012-03-05')).toBe('05/03/2012');
    expect(formatExportDate('2025-09-01T00:00:00.000Z')).toBe('01/09/2025');
    expect(formatExportDate('05/03/2012')).toBe('05/03/2012');
    expect(formatExportDate('')).toBe('');
    expect(formatExportDate(undefined)).toBe('');
  });

  it('passes unparseable values through untouched', () => {
    expect(formatExportDate('không rõ')).toBe('không rõ');
  });
});

describe('resolveStudentStatusKey', () => {
  it('maps lifecycle and enrollment status the way the status badge does', () => {
    expect(resolveStudentStatusKey({ studentLifecycle: 'trial' })).toBe('trial');
    expect(resolveStudentStatusKey({ isRevoked: true })).toBe('archived');
    expect(resolveStudentStatusKey({ studentLifecycle: 'archived' })).toBe('archived');
    expect(resolveStudentStatusKey({ enrollmentStatus: 'on_leave' })).toBe('on_leave');
    expect(resolveStudentStatusKey({ enrollmentStatus: 'dropped' })).toBe('dropped');
    expect(resolveStudentStatusKey({ enrollmentStatus: 'promoted' })).toBe('promoted');
    expect(resolveStudentStatusKey({})).toBe('active');
  });
});

describe('exportStudentDirectoryWorkbook', () => {
  beforeEach(() => {
    excel.sheets.length = 0;
    excel.saved.length = 0;
  });

  it('writes a header row with every requested column and one row per student', async () => {
    const rows = await exportStudentDirectoryWorkbook({
      students,
      classes,
      teachers,
      labels,
      fileName: 'danh-sach-hoc-sinh-2026-07-25.xlsx',
    });

    const sheet = excel.sheets[0];
    const headerRow = sheet.addedRows.find((row: any) => row.values[0] === 'STT');

    expect(STUDENT_DIRECTORY_EXPORT_COLUMN_KEYS).toHaveLength(12);
    expect(headerRow.values).toEqual([
      'STT',
      'Mã học sinh',
      'Họ và tên',
      'Ngày sinh',
      'Giới tính',
      'Số điện thoại',
      'Khối lớp',
      'Lớp học hiện tại',
      'Giáo viên chủ nhiệm',
      'Trạng thái',
      'Ngày nhập học',
      'Ngày tạo hồ sơ',
    ]);
    expect(sheet.columns).toHaveLength(12);
    expect(rows).toHaveLength(3);

    const dataRows = sheet.addedRows.filter((row: any) => typeof row.values[0] === 'number');
    expect(dataRows).toHaveLength(3);
    expect(dataRows[1].values).toContain('0912345678');
    expect(excel.saved).toEqual(['danh-sach-hoc-sinh-2026-07-25.xlsx']);
  });

  it('never downloads an empty workbook', async () => {
    const rows = await exportStudentDirectoryWorkbook({
      students: [],
      classes,
      teachers,
      labels,
      fileName: 'export.xlsx',
    });

    expect(rows).toEqual([]);
    expect(excel.sheets).toHaveLength(0);
    expect(excel.saved).toEqual([]);
  });

  it('prints the student count in the sheet heading', async () => {
    await exportStudentDirectoryWorkbook({
      students,
      classes,
      teachers,
      labels,
      fileName: 'export.xlsx',
    });

    expect(excel.sheets[0].cells.A1.value).toBe('DANH SÁCH HỌC SINH TOÀN TRUNG TÂM');
    expect(excel.sheets[0].cells.A3.value).toBe('Tổng số học sinh: 3');
  });
});
