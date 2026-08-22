import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import handler from '../../server/api/students/route.js';
import { getDb, verifyAuthToken, verifyAuthContext } from '../../server/api/lib/auth/verifyAuth.js';
import { readNextCounterSequenceInTransaction } from '../../server/api/lib/documentStore/counterSequence.js';
import formidable from 'formidable';
import { readFileSync } from 'fs';

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
  verifyAuthContext: vi.fn(),
}));

vi.mock('../../server/api/lib/auth/rateLimit.js', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../server/api/lib/documentStore/counterSequence.js', () => ({
  extractPrefixSuffixSequence: vi.fn(),
  getNextCounterSequence: vi.fn(),
  reserveNextCounterSequence: vi.fn(),
  readNextCounterSequenceInTransaction: vi.fn(),
  writeCounterSequenceReservation: vi.fn(),
}));

/** The reservation shape the read phase hands to the write phase. */
function reservation(nextSeq: number) {
  return { counterRef: {}, counterExists: true, nextSeq } as never;
}

vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  writeAuditLogInTransaction: vi.fn(),
}));

vi.mock('formidable', () => ({
  default: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

function mockRes() {
  const res: any = { statusCode: 200 };
  res.setHeader = vi.fn();
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

async function workbookBuffer(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Students');
  worksheet.addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function makeQuerySnapshot(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    empty: docs.length === 0,
    docs: docs.map((doc) => ({
      id: doc.id,
      data: () => doc.data,
    })),
  };
}

function makeStudentsCollection(addStudent: ReturnType<typeof vi.fn>) {
  let createdSequence = 0;
  const chain: any = {
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    get: vi.fn().mockResolvedValue(makeQuerySnapshot([])),
  };
  return {
    where: chain.where,
    doc: vi.fn(() => ({ id: `student-doc-${++createdSequence}` })),
  };
}

function makeStudentsCollectionWithSnapshots(
  addStudent: ReturnType<typeof vi.fn>,
  snapshots: Array<ReturnType<typeof makeQuerySnapshot>>
) {
  let createdSequence = 0;
  const get = vi.fn();
  for (const snapshot of snapshots) get.mockResolvedValueOnce(snapshot);
  get.mockResolvedValue(makeQuerySnapshot([]));

  const chain: any = {
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    get,
  };
  return {
    where: chain.where,
    doc: vi.fn(() => ({ id: `student-doc-${++createdSequence}` })),
  };
}

function enableAtomicCreates(db: any, createStudent: ReturnType<typeof vi.fn>) {
  db.runTransaction = vi.fn(async (callback: any) => {
    const tx: any = {
      create: vi.fn((_ref: unknown, data: Record<string, unknown>) =>
        (createStudent as (value: Record<string, unknown>) => unknown)(data)
      ),
      update: vi.fn(),
      // The code registry claim stages its ownership document with set().
      set: vi.fn(),
    };
    tx.get = vi.fn(async (queryOrRef: any) => {
      if (typeof queryOrRef?.get === 'function') return queryOrRef.get();
      return { empty: true, docs: [] };
    });
    return callback(tx);
  });
}

describe('POST /api/v1/students/import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 't@example.com',
    } as any);
    vi.mocked(verifyAuthContext).mockImplementation(async (req, res, allowedRoles) => {
      const role = 'teacher';
      if (!allowedRoles.includes(role)) {
        res.status(403).json({ success: false, error: 'Unauthorized' });
        return null;
      }
      return {
        decoded: { uid: 'teacher-1', email: 't@example.com' } as any,
        context: {
          uid: 'teacher-1',
          email: 't@example.com',
          role,
          name: 'Teacher One',
        },
      };
    });
    vi.mocked(readNextCounterSequenceInTransaction)
      .mockResolvedValueOnce(reservation(1))
      .mockResolvedValueOnce(reservation(2))
      .mockResolvedValueOnce(reservation(3));
    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {},
        {
          file: [
            {
              filepath: 'students.xlsx',
              originalFilename: 'students.xlsx',
              mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              size: 1024,
            },
          ],
        },
      ]),
    } as any);
  });

  it('continues after row errors and creates valid students in row order', async () => {
    vi.mocked(readFileSync).mockReturnValue(
      await workbookBuffer([
        ['Tên học sinh', 'Giới tính', 'Khối lớp', 'Ngày sinh', 'Lớp học', 'Liên hệ'],
        ['Nguyễn Văn A', 'Nam', 5, '2015-09-15', 'Lớp 5A', '0901234567'],
        ['Trần Thị B', 'Nữ', 5, '2015-10-20', 'Lớp 5A', 'bad-contact'],
        ['Lê Văn C', 'Nam', 5, '2015-11-10', 'Lớp 5A', '0907654321'],
      ])
    );

    const addStudent = vi
      .fn()
      .mockResolvedValueOnce({ id: 'student-doc-1' })
      .mockResolvedValueOnce({ id: 'student-doc-2' });
    const classesCollection = {
      // Course-closing invalidation reads the class before deciding to write.
      doc: vi.fn((id: string) => ({
        id,
        get: vi.fn(async () => ({ exists: false, data: () => undefined })),
      })),
      where: vi.fn(() => ({
        get: vi.fn().mockResolvedValue(
          makeQuerySnapshot([
            {
              id: 'class-5a',
              data: { name: 'Lớp 5A', teacherId: 'teacher-1', grade: 5 },
            },
          ])
        ),
      })),
    };
    const studentsCollection = makeStudentsCollection(addStudent);
    const usersCollection = {
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          data: () => ({ role: 'teacher', displayName: 'Teacher One' }),
        }),
      })),
    };
    const db: any = {
      // Import checks the identity maintenance state before reading the file.
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })),
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesCollection;
        if (name === 'students') return studentsCollection;
        if (name === 'users') return usersCollection;
        return { add: vi.fn() };
      }),
    };
    enableAtomicCreates(db, addStudent);
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler({ method: 'POST', headers: {}, query: { action: 'import' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      totalRows: 3,
      created: 2,
      failed: 1,
      createdStudents: [
        { row: 2, name: 'NGUYỄN VĂN A', studentId: 'HS260001' },
        { row: 4, name: 'LÊ VĂN C', studentId: 'HS260002' },
      ],
      failures: [{ row: 3, name: 'Trần Thị B', field: 'Liên hệ' }],
    });
    expect(addStudent).toHaveBeenCalledTimes(2);
    expect(addStudent.mock.calls[0][0]).toMatchObject({
      name: 'NGUYỄN VĂN A',
      studentId: 'HS260001',
      classId: 'class-5a',
    });
    expect(addStudent.mock.calls[1][0]).toMatchObject({
      name: 'LÊ VĂN C',
      studentId: 'HS260002',
      classId: 'class-5a',
    });
  });

  it('fails a row when the class name is duplicated in the teacher scope', async () => {
    vi.mocked(readFileSync).mockReturnValue(
      await workbookBuffer([
        ['Tên học sinh', 'Giới tính', 'Khối lớp', 'Ngày sinh', 'Lớp học', 'Liên hệ'],
        ['Nguyễn Văn A', 'Nam', 5, '2015-09-15', 'Lớp 5A', '0901234567'],
      ])
    );

    const classesCollection = {
      where: vi.fn(() => ({
        get: vi.fn().mockResolvedValue(
          makeQuerySnapshot([
            { id: 'class-1', data: { name: 'Lớp 5A', teacherId: 'teacher-1' } },
            { id: 'class-2', data: { name: 'Lớp 5A', teacherId: 'teacher-1' } },
          ])
        ),
      })),
    };
    const db: any = {
      // Import checks the identity maintenance state before reading the file.
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })),
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesCollection;
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                data: () => ({ role: 'teacher', displayName: 'Teacher One' }),
              }),
            })),
          };
        }
        return { add: vi.fn() };
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler({ method: 'POST', headers: {}, query: { action: 'import' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      totalRows: 1,
      created: 0,
      failed: 1,
      failures: [
        {
          row: 2,
          name: 'Nguyễn Văn A',
          field: 'Lớp học',
          error: 'Class name is not unique',
        },
      ],
    });
  });

  it('fails rows for classes outside the teacher scope without creating students', async () => {
    vi.mocked(readFileSync).mockReturnValue(
      await workbookBuffer([
        ['Tên học sinh', 'Giới tính', 'Khối lớp', 'Ngày sinh', 'Lớp học', 'Liên hệ'],
        ['Nguyễn Văn A', 'Nam', 5, '2015-09-15', 'Lớp 5A', '0901234567'],
      ])
    );

    const addStudent = vi.fn();
    const classesCollection = {
      where: vi.fn(() => ({
        get: vi.fn().mockResolvedValue(makeQuerySnapshot([])),
      })),
    };
    const db: any = {
      // Import checks the identity maintenance state before reading the file.
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })),
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesCollection;
        if (name === 'students') return makeStudentsCollection(addStudent);
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                data: () => ({ role: 'teacher', displayName: 'Teacher One' }),
              }),
            })),
          };
        }
        return { add: vi.fn() };
      }),
    };
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler({ method: 'POST', headers: {}, query: { action: 'import' } } as any, res);

    expect(classesCollection.where).toHaveBeenCalledWith('teacherId', '==', 'teacher-1');
    expect(addStudent).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      totalRows: 1,
      created: 0,
      failed: 1,
      failures: [
        {
          row: 2,
          name: 'Nguyễn Văn A',
          field: 'Lớp học',
          error: 'Class not found',
        },
      ],
    });
  });

  it('fails duplicate student rows and continues with following rows', async () => {
    vi.mocked(readFileSync).mockReturnValue(
      await workbookBuffer([
        ['Tên học sinh', 'Giới tính', 'Khối lớp', 'Ngày sinh', 'Lớp học', 'Liên hệ'],
        ['Nguyễn Văn A', 'Nam', 5, '2015-09-15', 'Lớp 5A', '0901234567'],
        ['Lê Văn C', 'Nam', 5, '2015-11-10', 'Lớp 5A', '0907654321'],
      ])
    );

    vi.mocked(readNextCounterSequenceInTransaction).mockReset();
    // Every attempted row reads the counter, including ones that are refused
    // afterwards, because the code has to exist before it can be checked.
    vi.mocked(readNextCounterSequenceInTransaction).mockResolvedValue(reservation(1));

    const addStudent = vi.fn().mockResolvedValueOnce({ id: 'student-doc-2' });
    const classesCollection = {
      // Course-closing invalidation reads the class before deciding to write.
      doc: vi.fn((id: string) => ({
        id,
        get: vi.fn(async () => ({ exists: false, data: () => undefined })),
      })),
      where: vi.fn(() => ({
        get: vi.fn().mockResolvedValue(
          makeQuerySnapshot([
            {
              id: 'class-5a',
              data: { name: 'Lớp 5A', teacherId: 'teacher-1', grade: 5 },
            },
          ])
        ),
      })),
    };
    // Row 2 runs three student queries in order: the two exact-human identity
    // lookups, then the same-class name+dob check. Only the third sees the
    // existing record — the stored document has no contact, so it is not an
    // exact-human match, and the narrower same-class rule is what refuses it.
    const studentsCollection = makeStudentsCollectionWithSnapshots(addStudent, [
      makeQuerySnapshot([]),
      makeQuerySnapshot([]),
      makeQuerySnapshot([
        {
          id: 'existing-student',
          data: {
            name: 'Nguyễn Văn A',
            dob: '2015-09-15',
            classId: 'class-5a',
            enrollmentStatus: 'active',
          },
        },
      ]),
    ]);
    const db: any = {
      // Import checks the identity maintenance state before reading the file.
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })),
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesCollection;
        if (name === 'students') return studentsCollection;
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                data: () => ({ role: 'teacher', displayName: 'Teacher One' }),
              }),
            })),
          };
        }
        return { add: vi.fn() };
      }),
    };
    enableAtomicCreates(db, addStudent);
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler({ method: 'POST', headers: {}, query: { action: 'import' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      totalRows: 2,
      created: 1,
      failed: 1,
      createdStudents: [{ row: 3, name: 'LÊ VĂN C', studentId: 'HS260001' }],
      failures: [
        {
          row: 2,
          name: 'Nguyễn Văn A',
          field: 'Lớp học',
        },
      ],
    });
    expect(addStudent).toHaveBeenCalledTimes(1);
    expect(addStudent.mock.calls[0][0]).toMatchObject({
      name: 'LÊ VĂN C',
      studentId: 'HS260001',
      classId: 'class-5a',
    });
  });

  it('fails rows when Excel stores a phone number without its leading zero', async () => {
    vi.mocked(readFileSync).mockReturnValue(
      await workbookBuffer([
        ['Tên học sinh', 'Giới tính', 'Khối lớp', 'Ngày sinh', 'Lớp học', 'Liên hệ'],
        ['Nguyễn Văn A', 'Nam', 5, '2015-09-15', 'Lớp 5A', 384072314],
        ['Lê Văn C', 'Nam', 5, '2015-11-10', 'Lớp 5A', '0384072314'],
      ])
    );

    vi.mocked(readNextCounterSequenceInTransaction).mockReset();
    // Every attempted row reads the counter, including ones that are refused
    // afterwards, because the code has to exist before it can be checked.
    vi.mocked(readNextCounterSequenceInTransaction).mockResolvedValue(reservation(1));

    const addStudent = vi.fn().mockResolvedValueOnce({ id: 'student-doc-1' });
    const classesCollection = {
      // Course-closing invalidation reads the class before deciding to write.
      doc: vi.fn((id: string) => ({
        id,
        get: vi.fn(async () => ({ exists: false, data: () => undefined })),
      })),
      where: vi.fn(() => ({
        get: vi.fn().mockResolvedValue(
          makeQuerySnapshot([
            {
              id: 'class-5a',
              data: { name: 'Lớp 5A', teacherId: 'teacher-1', grade: 5 },
            },
          ])
        ),
      })),
    };
    const studentsCollection = makeStudentsCollection(addStudent);
    const usersCollection = {
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          data: () => ({ role: 'teacher', displayName: 'Teacher One' }),
        }),
      })),
    };
    const db: any = {
      // Import checks the identity maintenance state before reading the file.
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })),
      collection: vi.fn((name: string) => {
        if (name === 'classes') return classesCollection;
        if (name === 'students') return studentsCollection;
        if (name === 'users') return usersCollection;
        return { add: vi.fn() };
      }),
    };
    enableAtomicCreates(db, addStudent);
    vi.mocked(getDb).mockReturnValue(db);

    const res = mockRes();
    await handler({ method: 'POST', headers: {}, query: { action: 'import' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      totalRows: 2,
      created: 1,
      failed: 1,
      createdStudents: [{ row: 3, name: 'LÊ VĂN C', studentId: 'HS260001' }],
      failures: [
        {
          row: 2,
          name: 'Nguyễn Văn A',
          field: 'Liên hệ',
        },
      ],
    });
    expect(addStudent).toHaveBeenCalledTimes(1);
    expect(addStudent.mock.calls[0][0]).toMatchObject({
      name: 'LÊ VĂN C',
      contact: '0384072314',
    });
  });

  it.each([
    ['students.xls', 'application/vnd.ms-excel'],
    ['students.csv', 'text/csv'],
  ])('rejects unsupported import file %s', async (originalFilename, mimetype) => {
    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {},
        {
          file: [
            {
              filepath: originalFilename,
              originalFilename,
              mimetype,
              size: 1024,
            },
          ],
        },
      ]),
    } as any);
    vi.mocked(readFileSync).mockReturnValue(await workbookBuffer([]));
    vi.mocked(getDb).mockReturnValue({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                data: () => ({ role: 'teacher', displayName: 'Teacher One' }),
              }),
            })),
          };
        }
        return {};
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'POST', headers: {}, query: { action: 'import' } } as any, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Invalid .xlsx file',
    });
  });

  it('rejects renamed non-xlsx files', async () => {
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('not a zip workbook'));
    vi.mocked(getDb).mockReturnValue({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })),
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                data: () => ({ role: 'teacher', displayName: 'Teacher One' }),
              }),
            })),
          };
        }
        return {};
      }),
    } as any);

    const res = mockRes();
    await handler({ method: 'POST', headers: {}, query: { action: 'import' } } as any, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Invalid .xlsx file',
    });
  });
});
