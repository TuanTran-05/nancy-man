import type { SafeStudent } from '../../types';
import {
  deriveStudentLifecycle,
  type EnrollmentStatus,
  type StudentLifecycle,
} from '../../../shared/studentLifecycle';
import { selectEnrolledStudentRows } from '../student/currentRecords';
import { readAllStudentPages } from '../api/readApi';

/**
 * Every field is optional: student documents reach the client through several
 * projections and older records simply have not filled all of them in.
 */
export type StudentDirectoryExportStudent = {
  id?: string;
  name?: string;
  studentId?: string;
  dob?: string;
  contact?: string;
  classId?: string;
  teacherId?: string;
  gender?: 'male' | 'female' | 'other';
  grade?: number;
  enrollmentStatus?: EnrollmentStatus;
  studentLifecycle?: StudentLifecycle;
  enrollmentDate?: string;
  createdAt?: string;
  isRevoked?: boolean;
};

export type StudentDirectoryExportClass = { id: string; name?: string; teacherId?: string };
export type StudentDirectoryExportTeacher = { uid: string; displayName?: string };

export type StudentDirectoryStatusKey =
  | 'active'
  | 'on_leave'
  | 'dropped'
  | 'promoted'
  | 'trial'
  | 'archived';

export type StudentDirectoryExportLabels = {
  sheetName: string;
  title: string;
  generatedAt: string;
  totalStudents: string;
  headers: {
    index: string;
    studentId: string;
    name: string;
    dob: string;
    gender: string;
    contact: string;
    grade: string;
    className: string;
    teacher: string;
    status: string;
    enrollmentDate: string;
    createdAt: string;
  };
  gender: { male: string; female: string; other: string; unknown: string };
  status: Record<StudentDirectoryStatusKey, string>;
  unassignedClass: string;
  unknownTeacher: string;
};

export type StudentDirectoryExportRow = {
  index: number;
  studentId: string;
  name: string;
  dob: string;
  gender: string;
  contact: string;
  grade: string;
  className: string;
  teacherName: string;
  status: string;
  enrollmentDate: string;
  createdAt: string;
};

type BuildInput = {
  students: StudentDirectoryExportStudent[];
  classes: StudentDirectoryExportClass[];
  teachers: StudentDirectoryExportTeacher[];
  labels: StudentDirectoryExportLabels;
  /** When set, only students of that class are exported (class detail view). */
  classId?: string;
};

export const STUDENT_DIRECTORY_EXPORT_COLUMN_KEYS = [
  'index',
  'studentId',
  'name',
  'dob',
  'gender',
  'contact',
  'grade',
  'className',
  'teacher',
  'status',
  'enrollmentDate',
  'createdAt',
] as const;

const COLUMN_WIDTHS = [6, 16, 28, 14, 10, 18, 10, 24, 24, 16, 16, 16];

/**
 * Dates reach the client in several shapes: `dob` is an API date (`YYYY-MM-DD`),
 * `enrollmentDate` is normalized to an ISO datetime by the read projection, and
 * `createdAt` is whatever the writer stored. Anything unparseable is passed
 * through untouched rather than dropped, so no information is lost in the sheet.
 */
export function formatExportDate(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const apiDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (apiDate) {
    const [, year, month, day] = apiDate;
    return `${day}/${month}/${year}`;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return `${String(parsed.getDate()).padStart(2, '0')}/${String(parsed.getMonth() + 1).padStart(2, '0')}/${parsed.getFullYear()}`;
}

/** Mirrors the status badge in the students directory so both surfaces agree. */
export function resolveStudentStatusKey(
  student: Pick<
    StudentDirectoryExportStudent,
    'enrollmentStatus' | 'studentLifecycle' | 'isRevoked'
  >
): StudentDirectoryStatusKey {
  const lifecycle = deriveStudentLifecycle(student);
  if (lifecycle === 'trial') return 'trial';
  if (lifecycle === 'archived') return 'archived';

  const status = student.enrollmentStatus || 'active';
  if (status === 'on_leave' || status === 'dropped' || status === 'promoted') return status;
  return 'active';
}

function genderLabel(
  gender: StudentDirectoryExportStudent['gender'],
  labels: StudentDirectoryExportLabels
): string {
  if (gender === 'male') return labels.gender.male;
  if (gender === 'female') return labels.gender.female;
  if (gender === 'other') return labels.gender.other;
  return labels.gender.unknown;
}

export function buildStudentDirectoryExportRows({
  students,
  classes,
  teachers,
  labels,
  classId,
}: BuildInput): StudentDirectoryExportRow[] {
  const classById = new Map(classes.map((classInfo) => [classInfo.id, classInfo]));
  const teacherById = new Map(teachers.map((teacher) => [teacher.uid, teacher]));

  // The server decides who is who; this exports the rows it returned. Two rows
  // for one human collapsed here would hide a duplicate that belongs in the
  // normalization run, and the identity guess doing the collapsing was wrong
  // for every one of the fifty-nine doubly-owned codes in production.
  const scoped = classId ? students.filter((student) => student.classId === classId) : students;

  const decorated = scoped.map((student) => {
    const classInfo = student.classId ? classById.get(student.classId) : undefined;
    const teacherId = classInfo?.teacherId || student.teacherId || '';
    const teacher = teacherId ? teacherById.get(teacherId) : undefined;

    return {
      student,
      className: String(classInfo?.name || '').trim(),
      teacherName: String(teacher?.displayName || '').trim(),
    };
  });

  decorated.sort((a, b) => {
    // Unassigned students sink to the bottom instead of leading the sheet.
    if (!a.className !== !b.className) return a.className ? -1 : 1;
    const byClass = a.className.localeCompare(b.className, 'vi');
    if (byClass !== 0) return byClass;
    return String(a.student.name || '').localeCompare(String(b.student.name || ''), 'vi');
  });

  return decorated.map((entry, index) => ({
    index: index + 1,
    studentId: String(entry.student.studentId || ''),
    name: String(entry.student.name || ''),
    dob: formatExportDate(entry.student.dob),
    gender: genderLabel(entry.student.gender, labels),
    contact: String(entry.student.contact || ''),
    grade: entry.student.grade ? String(entry.student.grade) : '',
    className: entry.className || labels.unassignedClass,
    teacherName: entry.teacherName || labels.unknownTeacher,
    status: labels.status[resolveStudentStatusKey(entry.student)],
    enrollmentDate: formatExportDate(entry.student.enrollmentDate),
    createdAt: formatExportDate(entry.student.createdAt),
  }));
}

/**
 * The reports channel only exposes the `academic` student projection, which has
 * no contact number. The export therefore reads the full directory itself so it
 * always covers every student the current user may see, center wide.
 */
export async function fetchStudentDirectoryExportStudents(): Promise<
  StudentDirectoryExportStudent[]
> {
  return readAllStudentPages<SafeStudent>({ view: 'directory' });
}

function safeWorksheetName(name: string, fallback: string) {
  const cleaned = (name || fallback).replace(/[\\/?*[\]:]/g, ' ').trim();
  return (cleaned || fallback).slice(0, 31);
}

export async function exportStudentDirectoryWorkbook(
  input: BuildInput & { fileName: string }
): Promise<StudentDirectoryExportRow[]> {
  const rows = buildStudentDirectoryExportRows(input);
  const { labels } = input;
  // Nothing to export - do not hand the user an empty workbook.
  if (rows.length === 0) return rows;

  const [{ default: ExcelJS }, { saveAs }] = await Promise.all([
    import('exceljs'),
    import('file-saver'),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EduTrack';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(safeWorksheetName(labels.sheetName, 'Students'));
  const headers = STUDENT_DIRECTORY_EXPORT_COLUMN_KEYS.map((key) => labels.headers[key]);
  const lastColumn = String.fromCharCode('A'.charCodeAt(0) + headers.length - 1);

  worksheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  worksheet.mergeCells(`A1:${lastColumn}1`);
  worksheet.getCell('A1').value = labels.title;
  worksheet.getCell('A1').font = { bold: true, size: 14 };
  worksheet.getCell('A1').alignment = { horizontal: 'center' };

  worksheet.mergeCells(`A2:${lastColumn}2`);
  worksheet.getCell('A2').value = labels.generatedAt;

  worksheet.mergeCells(`A3:${lastColumn}3`);
  worksheet.getCell('A3').value = labels.totalStudents.replace('{count}', String(rows.length));
  worksheet.getCell('A3').font = { bold: true };

  worksheet.addRow([]);
  const headerRow = worksheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  const headerRowNumber = 5;
  worksheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];
  worksheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: headers.length },
  };

  rows.forEach((row) => {
    const excelRow = worksheet.addRow([
      row.index,
      row.studentId,
      row.name,
      row.dob,
      row.gender,
      row.contact,
      row.grade,
      row.className,
      row.teacherName,
      row.status,
      row.enrollmentDate,
      row.createdAt,
    ]);
    excelRow.getCell(1).alignment = { horizontal: 'center' };
    excelRow.getCell(4).alignment = { horizontal: 'center' };
    excelRow.getCell(5).alignment = { horizontal: 'center' };
    excelRow.getCell(7).alignment = { horizontal: 'center' };
    // Phone numbers keep their leading zero only when Excel treats them as text.
    excelRow.getCell(6).numFmt = '@';
    excelRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, input.fileName);

  return rows;
}
