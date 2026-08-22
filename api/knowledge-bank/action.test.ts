import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../server/api/knowledge-bank/route';
import { getDb, verifyAuthToken, verifyAuthContext } from '../../server/api/lib/auth/verifyAuth.js';
import {
  assertCanReadStudentScopedResource,
  assertClassAccess,
  getUserContext,
} from '../../server/api/lib/auth/authz.js';
import { writeRequiredAuditLog } from '../../server/api/lib/logging/auditLog.js';
import formidable from 'formidable';
import { readFileSync } from 'fs';

const storageMocks = vi.hoisted(() => ({
  save: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  download: vi.fn(),
  stat: vi.fn(),
  createSignedReadUrl: vi.fn().mockResolvedValue('https://signed.example/file'),
  createPersistentReadUrl: vi.fn().mockResolvedValue('https://signed.example/persistent'),
}));

vi.mock('../../server/api/lib/auth/verifyAuth.js', () => {
  const getDb = vi.fn();
  const verifyAuthToken = vi.fn();
  const verifyAuthContext = vi.fn(async (req: any, res: any, requiredRoles: any) => {
    const decoded = await verifyAuthToken(req, res, requiredRoles);
    if (!decoded) return null;
    const userCtxMock = (globalThis as any).vi.mocked(getUserContext);
    const context = (await userCtxMock(null as any, decoded).catch(() => ({
      uid: decoded.uid,
      email: decoded.email,
      role: 'teacher',
      name: 'Teacher One',
    }))) || {
      uid: decoded.uid,
      email: decoded.email,
      role: 'teacher',
      name: 'Teacher One',
    };
    return {
      decoded,
      context,
    } as any;
  });
  return { getDb, verifyAuthToken, verifyAuthContext };
});

vi.mock('../../server/api/lib/auth/authz.js', () => ({
  assertCanReadStudentScopedResource: vi.fn(),
  assertClassAccess: vi.fn(),
  getUserContext: vi.fn(),
}));

vi.mock('../../server/api/lib/logging/auditLog.js', () => ({
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  writeRequiredAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/api/lib/storage/objectStore.js', () => ({
  getObjectStore: () => storageMocks,
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => Buffer.from('%PDF test document')),
}));

vi.mock('formidable', () => ({
  default: vi.fn(),
}));

beforeEach(() => {
  storageMocks.save.mockReset().mockResolvedValue(undefined);
  storageMocks.delete.mockReset().mockResolvedValue(undefined);
  storageMocks.download.mockReset();
  storageMocks.stat.mockReset();
  storageMocks.createSignedReadUrl.mockReset().mockResolvedValue('https://signed.example/file');
  storageMocks.createPersistentReadUrl
    .mockReset()
    .mockResolvedValue('https://signed.example/persistent');
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
  res.send = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

function mockPrintRequestUploadDb() {
  const classGet = vi.fn().mockResolvedValue({
    exists: true,
    data: () => ({ id: 'class-1', name: 'G5A', teacherId: 'teacher-1' }),
  });
  const userGet = vi.fn().mockResolvedValue({
    exists: true,
    data: () => ({ role: 'teacher', displayName: 'Teacher One' }),
  });
  const set = vi.fn().mockResolvedValue(undefined);
  const doc = vi.fn(() => ({ id: 'print-1', set }));
  const collection = vi.fn((name: string) => {
    if (name === 'classes') return { doc: vi.fn(() => ({ get: classGet })) };
    if (name === 'users') return { doc: vi.fn(() => ({ get: userGet })) };
    if (name === 'print_requests') return { doc };
    return { doc: vi.fn(() => ({ get: vi.fn() })), add: vi.fn() };
  });
  return { db: { collection }, add: set, classGet, userGet };
}

describe('DELETE /api/v1/knowledge-bank/:id authentication boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes the path id before the maintenance guard and returns the auth response', async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('database must not be read before authentication');
    });
    vi.mocked(verifyAuthContext).mockImplementationOnce(async (_req, res) => {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return null;
    });
    const res = mockRes();

    await handler(
      {
        method: 'DELETE',
        headers: {},
        query: { action: 'document-id-from-path' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: 'Authentication required' });
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/knowledge-bank/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 'teacher@example.com',
    } as any);
    vi.mocked(getDb).mockReturnValue({ collection: vi.fn() } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'teacher-1',
      role: 'teacher',
      name: 'Teacher One',
    } as any);
    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {
          title: ['Class doc'],
          classId: ['class-other'],
        },
        {
          file: [
            {
              filepath: 'upload.tmp',
              originalFilename: 'lesson.pdf',
              size: 128,
            },
          ],
        },
      ]),
    } as any);
  });

  it('rejects class-targeted uploads when the teacher cannot write to that class', async () => {
    vi.mocked(assertClassAccess).mockRejectedValue(
      Object.assign(new Error('Not authorized for this class'), { statusCode: 403 })
    );
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'upload' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Not authorized for this class',
    });
    expect(assertClassAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ uid: 'teacher-1', role: 'teacher' }),
      'class-other',
      'write'
    );
    expect(storageMocks.save).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/knowledge-bank/upload-profile-image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 'teacher@example.com',
    } as any);
    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {},
        {
          file: [
            {
              filepath: 'avatar.tmp',
              originalFilename: 'avatar.png',
              mimetype: 'image/png',
              size: 128,
            },
          ],
        },
      ]),
    } as any);
  });

  it('does not leak internal storage errors to the client', async () => {
    storageMocks.save
      .mockRejectedValue(new Error('Object storage failed at /srv/edutrack/shared/uploads'));

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'upload-profile-image' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Failed to upload image',
    });
    expect(JSON.stringify(res.body)).not.toContain('service-account');
  });
});

describe('GET /api/v1/knowledge-bank/student-face-image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 'teacher@example.com',
    } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'teacher-1',
      role: 'teacher',
      name: 'Teacher One',
    } as any);
    vi.mocked(getDb).mockReturnValue({ collection: vi.fn() } as any);
  });

  it('streams an authorized student face image through the API', async () => {
    const storagePath = 'student_faces/teacher-1/stu-1/face.jpg';
    const imageBuffer = Buffer.from('face-bytes');
    vi.mocked(assertCanReadStudentScopedResource).mockResolvedValue({
      faceImageStoragePath: storagePath,
    } as any);
    storageMocks.download.mockResolvedValue(imageBuffer);
    storageMocks.stat.mockResolvedValue({ size: imageBuffer.length, contentType: 'image/jpeg' });

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: {
          action: 'student-face-image',
          studentId: 'stu-1',
          storagePath,
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(assertCanReadStudentScopedResource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ uid: 'teacher-1', role: 'teacher' }),
      'stu-1'
    );
    expect(storageMocks.download).toHaveBeenCalledWith(storagePath);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=300');
    expect(res.send).toHaveBeenCalledWith(imageBuffer);
  });

  it('denies a face read when the storage path does not match the stored path', async () => {
    vi.mocked(assertCanReadStudentScopedResource).mockResolvedValue({
      faceImageStoragePath: 'student_faces/teacher-1/stu-1/real.jpg',
    } as any);
    vi.mocked(getDb).mockReturnValue({ collection: vi.fn() } as any);

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: {
          action: 'student-face-url',
          studentId: 'stu-1',
          storagePath: 'student_faces/teacher-1/stu-1/guessed.jpg',
        },
      } as any,
      res
    );

    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/v1/knowledge-bank/download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 'teacher@example.com',
    } as any);
    vi.mocked(getUserContext).mockResolvedValue({
      uid: 'teacher-1',
      role: 'teacher',
      name: 'Teacher One',
    } as any);
  });

  function mockDownloadDb(update = vi.fn().mockResolvedValue(undefined)) {
    const docRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          storagePath: 'knowledge_bank/doc-1.pdf',
          originalFilename: 'Lesson.pdf',
          fileType: 'pdf',
          mimeType: 'application/pdf',
        }),
      }),
      update,
    };
    return { collection: vi.fn(() => ({ doc: vi.fn(() => docRef) })) };
  }

  function mockSignedUrl(url = 'https://signed.example/doc-1') {
    storageMocks.createSignedReadUrl.mockResolvedValue(url);
    return storageMocks.createSignedReadUrl;
  }

  it('audits an attachment download, returns the url, and increments the counter', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue(mockDownloadDb(update) as any);
    mockSignedUrl();

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: { 'user-agent': 'vitest' },
        query: { action: 'download', id: 'doc-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, url: 'https://signed.example/doc-1' });
    expect(vi.mocked(verifyAuthContext)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ['admin', 'teacher']
    );
    expect(vi.mocked(writeRequiredAuditLog)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'teacher-1',
        userRole: 'teacher',
        userName: 'Teacher One',
        action: 'export',
        collection: 'knowledge_bank',
        documentId: 'doc-1',
        ip: '127.0.0.1',
        userAgent: 'vitest',
        metadata: expect.objectContaining({
          mode: 'attachment',
          originalFilename: 'Lesson.pdf',
        }),
      })
    );
    expect(update).toHaveBeenCalled();
  });

  it('records mode inline and does not increment the counter', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue(mockDownloadDb(update) as any);
    mockSignedUrl();

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'download', id: 'doc-1', mode: 'inline' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(writeRequiredAuditLog)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadata: expect.objectContaining({ mode: 'inline' }) })
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 503 and no url when the audit write fails (fail-closed)', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue(mockDownloadDb(update) as any);
    const file = mockSignedUrl();
    vi.mocked(writeRequiredAuditLog).mockRejectedValueOnce(
      Object.assign(new Error('audit failed'), { statusCode: 503 })
    );

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'download', id: 'doc-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(503);
    expect(res.body?.url).toBeUndefined();
    expect(file).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/knowledge-bank/upload-print-request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'teacher-1',
      email: 'teacher@example.com',
    } as any);
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('%PDF test document') as any);
  });

  it('creates a print request with multiple files and per-file quantities', async () => {
    const mocked = mockPrintRequestUploadDb();
    vi.mocked(getDb).mockReturnValue(mocked.db as any);
    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {
          classId: ['class-1'],
          neededAt: ['2026-06-10T09:30:00.000Z'],
          note: ['Unit 3 handouts'],
          quantities: ['[20,5]'],
        },
        {
          files: [
            {
              filepath: 'one.tmp',
              originalFilename: 'worksheet.pdf',
              mimetype: 'application/pdf',
              size: 128,
            },
            {
              filepath: 'two.tmp',
              originalFilename: 'slides.pdf',
              mimetype: 'application/pdf',
              size: 256,
            },
          ],
        },
      ]),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'POST', headers: {}, query: { action: 'upload-print-request' } } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ success: true, id: 'print-1' });
    expect(mocked.add).toHaveBeenCalledWith(
      expect.objectContaining({
        teacherId: 'teacher-1',
        teacherName: 'Teacher One',
        classId: 'class-1',
        className: 'G5A',
        neededAt: '2026-06-10T09:30:00.000Z',
        neededDate: '2026-06-10',
        status: 'pending',
        files: [
          expect.objectContaining({ originalFilename: 'worksheet.pdf', quantity: 20 }),
          expect.objectContaining({ originalFilename: 'slides.pdf', quantity: 5 }),
        ],
      })
    );
    expect(storageMocks.save).toHaveBeenCalledTimes(2);
  });

  it('uses explicit neededDate from the teacher form', async () => {
    const mocked = mockPrintRequestUploadDb();
    vi.mocked(getDb).mockReturnValue(mocked.db as any);
    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {
          classId: ['class-1'],
          neededAt: ['2026-06-09T18:30:00.000Z'],
          neededDate: ['2026-06-10'],
          quantities: ['[20]'],
        },
        {
          files: [
            {
              filepath: 'one.tmp',
              originalFilename: 'worksheet.pdf',
              mimetype: 'application/pdf',
              size: 128,
            },
          ],
        },
      ]),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'POST', headers: {}, query: { action: 'upload-print-request' } } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(mocked.add).toHaveBeenCalledWith(
      expect.objectContaining({
        neededAt: '2026-06-09T18:30:00.000Z',
        neededDate: '2026-06-10',
      })
    );
  });

  it('does not upload any file when a later file is invalid', async () => {
    const mocked = mockPrintRequestUploadDb();
    vi.mocked(getDb).mockReturnValue(mocked.db as any);
    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {
          classId: ['class-1'],
          neededAt: ['2026-06-10T09:30:00.000Z'],
          neededDate: ['2026-06-10'],
          quantities: ['[20,5]'],
        },
        {
          files: [
            {
              filepath: 'one.tmp',
              originalFilename: 'worksheet.pdf',
              mimetype: 'application/pdf',
              size: 128,
            },
            {
              filepath: 'two.tmp',
              originalFilename: 'malware.exe',
              mimetype: 'application/octet-stream',
              size: 256,
            },
          ],
        },
      ]),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'POST', headers: {}, query: { action: 'upload-print-request' } } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('Invalid file type');
    expect(storageMocks.save).not.toHaveBeenCalled();
    expect(mocked.add).not.toHaveBeenCalled();
  });

  it('rejects teacher upload for a class they do not teach', async () => {
    const userGet = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ role: 'teacher', displayName: 'Teacher One' }),
    });
    const classGet = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Other class', teacherId: 'teacher-2' }),
    });
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'users') return { doc: vi.fn(() => ({ get: userGet })) };
        if (name === 'classes') return { doc: vi.fn(() => ({ get: classGet })) };
        return { add: vi.fn() };
      }),
    } as any);
    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        { classId: ['class-2'], neededAt: ['2026-06-10T09:30:00.000Z'], quantities: ['[1]'] },
        {
          files: [
            {
              filepath: 'one.tmp',
              originalFilename: 'worksheet.pdf',
              mimetype: 'application/pdf',
              size: 128,
            },
          ],
        },
      ]),
    } as any);

    const res = mockRes();
    await handler(
      { method: 'POST', headers: {}, query: { action: 'upload-print-request' } } as any,
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('Not authorized for this class');
    expect(storageMocks.save).not.toHaveBeenCalled();
  });

  it('uses verified auth context for uploader display metadata without reading users doc', async () => {
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid: 'teacher-1', email: 'teacher@example.com' } as any,
      context: {
        uid: 'teacher-1',
        email: 'teacher@example.com',
        role: 'teacher',
        name: 'Teacher One',
      },
    });
    const mocked = mockPrintRequestUploadDb();
    vi.mocked(getDb).mockReturnValue(mocked.db as any);
    vi.mocked(formidable).mockReturnValue({
      parse: vi.fn().mockResolvedValue([
        {
          classId: ['class-1'],
          neededAt: ['2026-06-10T09:30:00.000Z'],
          note: ['Unit 3 handouts'],
          quantities: ['[20]'],
        },
        {
          files: [
            {
              filepath: 'temp.pdf',
              originalFilename: 'test.pdf',
              mimetype: 'application/pdf',
              size: 100,
            },
          ],
        },
      ]),
    } as any);

    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'upload-print-request' },
        headers: {},
      } as any,
      res
    );

    expect(res.statusCode).toBe(201);
    expect(mocked.userGet).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/knowledge-bank/print-request-file', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows office to get a signed URL for a print request file', async () => {
    vi.mocked(verifyAuthToken).mockResolvedValue({
      uid: 'office-1',
      email: 'o@example.com',
    } as any);
    vi.mocked(getDb).mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === 'users') {
          return {
            doc: vi.fn(() => ({
              get: vi
                .fn()
                .mockResolvedValue({ data: () => ({ role: 'office', displayName: 'Office One' }) }),
            })),
          };
        }
        if (name === 'print_requests') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                  teacherId: 'teacher-1',
                  files: [
                    {
                      id: 'file-1',
                      originalFilename: 'worksheet.pdf',
                      fileType: 'pdf',
                      mimeType: 'application/pdf',
                      storagePath: 'print_requests/teacher-1/print-1/file.pdf',
                    },
                  ],
                }),
              }),
            })),
          };
        }
        return { doc: vi.fn() };
      }),
    } as any);
    storageMocks.createSignedReadUrl.mockResolvedValue('https://signed.example/file');

    const res = mockRes();
    await handler(
      {
        method: 'GET',
        headers: {},
        query: { action: 'print-request-file', requestId: 'print-1', fileId: 'file-1' },
      } as any,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, url: 'https://signed.example/file' });
  });
});
