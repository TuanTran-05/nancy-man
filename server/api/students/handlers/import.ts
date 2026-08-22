import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { readFileSync } from 'fs';
import type { DocumentStore } from '@/server/db/documentStore.js';
import formidable, { type File as FormidableFile } from 'formidable';
import { sendApiError } from '../../lib/http/helpers.js';
import { createStudentRecord } from '../../lib/student/studentCreation.js';
import {
  normalizeClassLookupName,
  parseStudentImportWorkbookResult,
  type ParsedStudentImportRow,
  type StudentImportFailure,
} from '../../lib/student/studentImport.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { withStatus } from './utils.js';
import { refreshAccountingStudentSummariesAfterCommit } from '../../lib/services/accountingStudentSummaryService.js';
import { assertStudentIdentityMutationAllowed } from '../../lib/maintenance/studentIdentityMaintenance.js';

const MAX_IMPORT_FILE_SIZE = 2 * 1024 * 1024;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type ImportUser = { uid: string; email?: string };
type ImportUserInfo = { role: string; name: string };
type ImportClass = { id: string; name: string; teacherId?: string; data: Record<string, unknown> };

function getExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

function assertXlsxFile(file: FormidableFile, buffer: Buffer) {
  const filename = file.originalFilename || '';
  const ext = getExt(filename);
  const mime = file.mimetype || '';
  const hasZipSignature =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08);

  if (ext !== 'xlsx' || (mime && mime !== XLSX_MIME && mime !== 'application/octet-stream')) {
    throw withStatus('Invalid .xlsx file', 400);
  }
  if (!hasZipSignature) throw withStatus('Invalid .xlsx file', 400);
}

async function parseSingleXlsxForm(req: ApiRequest): Promise<FormidableFile> {
  const form = formidable({ maxFileSize: MAX_IMPORT_FILE_SIZE, maxFiles: 1 });
  const [, files] = await form.parse(req);
  const uploadedFile = files.file?.[0];
  if (!uploadedFile) throw withStatus('Missing import file', 400);
  return uploadedFile;
}

async function loadAccessibleClasses(
  db: DocumentStore,
  user: ImportUser,
  userInfo: ImportUserInfo
): Promise<ImportClass[]> {
  const classesCollection = db.collection('classes');
  const snap =
    userInfo.role === 'admin' || userInfo.role === 'office'
      ? await classesCollection.get()
      : await classesCollection.where('teacherId', '==', user.uid).get();

  return snap.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    return {
      id: docSnap.id,
      name: String(data.name || ''),
      teacherId: typeof data.teacherId === 'string' ? data.teacherId : undefined,
      data,
    };
  });
}

function resolveClassForRow(row: ParsedStudentImportRow, classes: ImportClass[]): ImportClass {
  const lookupName = normalizeClassLookupName(row.className);
  const matches = classes.filter(
    (classInfo) => normalizeClassLookupName(classInfo.name) === lookupName
  );
  if (matches.length === 0) throw withStatus('Class not found', 404);
  if (matches.length > 1) throw withStatus('Class name is not unique', 409);
  return matches[0];
}

function fieldForError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/contact/i.test(message)) return 'Liên hệ';
  if (/class/i.test(message)) return 'Lớp học';
  if (/gender/i.test(message)) return 'Giới tính';
  if (/grade/i.test(message)) return 'Khối lớp';
  if (/date|dob/i.test(message)) return 'Ngày sinh';
  return 'Dữ liệu';
}

async function importRows({
  req,
  db,
  user,
  userInfo,
  rows,
  parseFailures,
  classes,
}: {
  req: ApiRequest;
  db: DocumentStore;
  user: ImportUser;
  userInfo: ImportUserInfo;
  rows: ParsedStudentImportRow[];
  parseFailures: StudentImportFailure[];
  classes: ImportClass[];
}) {
  const createdStudents: Array<{ row: number; name: string; studentId: string }> = [];
  const createdStudentIds: string[] = [];
  const failures: StudentImportFailure[] = [...parseFailures];

  for (const row of rows) {
    try {
      const classInfo = resolveClassForRow(row, classes);
      const created = await createStudentRecord({
        req,
        db,
        user,
        userInfo,
        classData: classInfo.data,
        // Never 'student_create'. The operation is what makes an admin override
        // structurally unreachable from a spreadsheet, whatever role uploaded it.
        mutationOperation: 'student_import',
        body: {
          name: row.name,
          gender: row.gender,
          grade: row.grade,
          dob: row.dob,
          classId: classInfo.id,
          contact: row.contact,
        },
      });
      createdStudents.push({ row: row.row, name: created.name, studentId: created.studentId });
      createdStudentIds.push(created.id);
    } catch (err) {
      failures.push({
        row: row.row,
        name: row.name,
        field: fieldForError(err),
        error: err instanceof Error ? err.message : 'Failed to import student',
      });
    }
  }

  return {
    success: true,
    totalRows: rows.length + parseFailures.length,
    created: createdStudents.length,
    failed: failures.length,
    createdStudents,
    createdStudentIds,
    failures,
  };
}

export async function handleImport(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  user: ImportUser,
  userInfo: ImportUserInfo
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await assertStudentIdentityMutationAllowed(db, {
      actorId: user.uid,
      operation: 'students:import',
    });
    const uploadedFile = await parseSingleXlsxForm(req);
    const fileBuffer = readFileSync(uploadedFile.filepath);
    assertXlsxFile(uploadedFile, fileBuffer);

    const parsed = await parseStudentImportWorkbookResult(fileBuffer);
    const classes = await loadAccessibleClasses(db, user, userInfo);
    const result = await importRows({
      req,
      db,
      user,
      userInfo,
      rows: parsed.rows,
      parseFailures: parsed.failures,
      classes,
    });
    await refreshAccountingStudentSummariesAfterCommit(
      db,
      result.createdStudentIds,
      'students-imported',
      { actorId: user.uid, operation: 'students:import' }
    );
    await Promise.all([touchRealtimeEvent('students'), touchRealtimeEvent('admin-summary')]);

    return res.status(200).json(result);
  } catch (err) {
    console.error('[Students/import] Error:', err);
    return sendApiError(res, err, 'Failed to import students');
  }
}
