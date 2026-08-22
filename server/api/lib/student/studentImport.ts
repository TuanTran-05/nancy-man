import ExcelJS from 'exceljs';
import { normalizeDateLikeToApiDate } from '../../../../shared/dateTimeFormat.js';

export const MAX_STUDENT_IMPORT_ROWS = 100;

export type StudentImportGender = 'male' | 'female' | 'other';

export interface ParsedStudentImportRow {
  row: number;
  name: string;
  gender: StudentImportGender;
  grade: number;
  dob: string;
  className: string;
  contact: string;
}

export interface StudentImportFailure {
  row: number;
  name: string;
  field: string;
  error: string;
}

const REQUIRED_COLUMNS = [
  { key: 'name', label: 'Tên học sinh', aliases: ['ten hoc sinh', 'name'] },
  { key: 'gender', label: 'Giới tính', aliases: ['gioi tinh', 'gender'] },
  { key: 'grade', label: 'Khối lớp', aliases: ['khoi lop', 'grade'] },
  { key: 'dob', label: 'Ngày sinh', aliases: ['ngay sinh', 'dob', 'date of birth'] },
  { key: 'className', label: 'Lớp học', aliases: ['lop hoc', 'class', 'class name'] },
  { key: 'contact', label: 'Liên hệ', aliases: ['lien he', 'contact', 'email', 'phone'] },
] as const;

type ColumnKey = (typeof REQUIRED_COLUMNS)[number]['key'];
type ImportCellValue = { rawValue: unknown; numFmt?: string };

function withStatus(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function normalizeText(value: unknown): string {
  return String(getRawCellValue(value) ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isImportCellValue(value: unknown): value is ImportCellValue {
  return typeof value === 'object' && value !== null && 'rawValue' in value;
}

function getRawCellValue(value: unknown): unknown {
  return isImportCellValue(value) ? value.rawValue : value;
}

function getDisplayString(value: unknown): string {
  const rawValue = getRawCellValue(value);
  if (rawValue instanceof Date)
    return formatDateParts(rawValue.getFullYear(), rawValue.getMonth() + 1, rawValue.getDate());
  return String(rawValue ?? '').trim();
}

function normalizeCellRawValue(value: unknown): unknown {
  if (!value || value instanceof Date || typeof value !== 'object') return value;
  if ('text' in value && typeof value.text === 'string') return value.text;
  if ('result' in value) return value.result;
  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => String(part?.text ?? '')).join('');
  }
  return value;
}

function normalizeCellValue(cell: ExcelJS.Cell): ImportCellValue {
  return {
    rawValue: normalizeCellRawValue(cell.value),
    numFmt: cell.numFmt,
  };
}

function resolveHeaderIndexes(headerRow: unknown[]): Record<ColumnKey, number> {
  const normalizedHeaders = headerRow.map(normalizeText);
  const indexes = {} as Record<ColumnKey, number>;

  for (const column of REQUIRED_COLUMNS) {
    const aliases: readonly string[] = column.aliases;
    const index = normalizedHeaders.findIndex((header) => aliases.includes(header));
    if (index === -1) {
      throw withStatus(`Missing required column: ${column.label}`, 400);
    }
    indexes[column.key] = index;
  }

  return indexes;
}

function parseGender(value: unknown): StudentImportGender {
  const normalized = normalizeText(value);
  if (normalized === 'nam' || normalized === 'male') return 'male';
  if (normalized === 'nu' || normalized === 'female') return 'female';
  if (normalized === 'khac' || normalized === 'other') return 'other';
  throw withStatus('Invalid gender', 400);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function formatDateParts(year: number, month: number, day: number): string {
  if (!isValidDateParts(year, month, day)) throw withStatus('Invalid date', 400);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseExcelSerialDate(value: number): string {
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.floor(value) * 86_400_000);
  return formatDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function parseDob(value: unknown): string {
  const rawValue = getRawCellValue(value);

  if (rawValue instanceof Date) {
    return formatDateParts(rawValue.getFullYear(), rawValue.getMonth() + 1, rawValue.getDate());
  }

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return parseExcelSerialDate(rawValue);
  }

  const raw = getDisplayString(value);
  try {
    return normalizeDateLikeToApiDate(raw);
  } catch {
    throw withStatus('Invalid date', 400);
  }
}

function parseGrade(value: unknown): number {
  const grade = Number(getDisplayString(value));
  if (!Number.isInteger(grade) || grade < 1 || grade > 12) {
    throw withStatus('Invalid grade', 400);
  }
  return grade;
}

function hasAnyCellValue(row: unknown[]): boolean {
  return row.some((cell) => getDisplayString(cell) !== '');
}

function getWorksheetRows(
  worksheet: ExcelJS.Worksheet
): Array<{ row: unknown[]; rowNumber: number }> {
  const rows: Array<{ row: unknown[]; rowNumber: number }> = [];
  worksheet.eachRow({ includeEmpty: false }, (worksheetRow, rowNumber) => {
    const values: unknown[] = [];
    for (let column = 1; column <= worksheetRow.cellCount; column++) {
      values.push(normalizeCellValue(worksheetRow.getCell(column)));
    }
    if (hasAnyCellValue(values)) rows.push({ row: values, rowNumber });
  });
  return rows;
}

export async function parseStudentImportWorkbookResult(buffer: Buffer): Promise<{
  rows: ParsedStudentImportRow[];
  failures: StudentImportFailure[];
}> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw withStatus('Invalid .xlsx file', 400);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw withStatus('Workbook has no sheets', 400);

  const workbookRows = getWorksheetRows(worksheet);
  if (workbookRows.length === 0) throw withStatus('Workbook is empty', 400);

  const [headerRow, ...dataRows] = workbookRows;
  const headerIndexes = resolveHeaderIndexes(headerRow.row);
  const nonEmptyDataRows = dataRows.filter(({ row }) => hasAnyCellValue(row));

  if (nonEmptyDataRows.length > MAX_STUDENT_IMPORT_ROWS) {
    throw withStatus(`Cannot import more than ${MAX_STUDENT_IMPORT_ROWS} students`, 400);
  }

  const parsedRows: ParsedStudentImportRow[] = [];
  const failures: StudentImportFailure[] = [];

  for (const { row, rowNumber } of nonEmptyDataRows) {
    const name = getDisplayString(row[headerIndexes.name]);
    const className = getDisplayString(row[headerIndexes.className]);
    const contact = getDisplayString(row[headerIndexes.contact]);
    if (!name) {
      failures.push({
        row: rowNumber,
        name: '',
        field: 'Tên học sinh',
        error: 'Missing student name',
      });
      continue;
    }
    if (!className) {
      failures.push({ row: rowNumber, name, field: 'Lớp học', error: 'Missing class name' });
      continue;
    }
    if (!contact) {
      failures.push({ row: rowNumber, name, field: 'Liên hệ', error: 'Missing contact' });
      continue;
    }

    try {
      parsedRows.push({
        row: rowNumber,
        name,
        gender: parseGender(row[headerIndexes.gender]),
        grade: parseGrade(row[headerIndexes.grade]),
        dob: parseDob(row[headerIndexes.dob]),
        className,
        contact,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Invalid row';
      let field = 'Dữ liệu';
      if (error.includes('gender')) field = 'Giới tính';
      if (error.includes('grade')) field = 'Khối lớp';
      if (error.includes('date')) field = 'Ngày sinh';
      failures.push({ row: rowNumber, name, field, error });
    }
  }

  return { rows: parsedRows, failures };
}

export async function parseStudentImportWorkbook(
  buffer: Buffer
): Promise<ParsedStudentImportRow[]> {
  const result = await parseStudentImportWorkbookResult(buffer);
  if (result.failures.length > 0) {
    const failure = result.failures[0];
    throw withStatus(`Row ${failure.row}: ${failure.error}`, 400);
  }
  return result.rows;
}

export function normalizeClassLookupName(value: string): string {
  return normalizeText(value);
}
