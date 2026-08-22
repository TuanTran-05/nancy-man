import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import { handleZaloLogSummary } from './messagesHandler.js';

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  return res;
}

describe('Zalo recent log summary', () => {
  it('resolves a migrated notification name from its student id', async () => {
    const { db } = createInMemoryDocumentStore({
      'zalo_notifications/sent-1': {
        type: 'absence',
        status: 'sent',
        createdAt: '2026-08-19T08:00:00.000Z',
        studentId: 'student-1',
        classId: 'class-1',
        phone: '84971108838',
      },
      'students/student-1': {
        name: 'NGUYỄN VĂN AN',
        code: 'HS260001',
      },
      'classes/class-1': { name: 'Flyers 1' },
    });
    const res = mockRes();

    await handleZaloLogSummary(
      { method: 'GET' } as any,
      res,
      db as any,
      { uid: 'admin-1', role: 'admin' }
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.logs).toEqual([
      expect.objectContaining({
        id: 'sent-1',
        studentName: 'NGUYỄN VĂN AN',
        phone: '84971108838',
      }),
    ]);
  });

  it('uses a unique normalized phone when a legacy notification has no student id', async () => {
    const { db } = createInMemoryDocumentStore({
      'zalo_notifications/manual-1': {
        type: 'manual',
        status: 'sent',
        createdAt: '2026-08-19T09:00:00.000Z',
        phone: '84901234567',
      },
      'students/student-1': {
        name: 'TRẦN THỊ BÌNH',
        contact: '0901 234 567',
      },
    });
    const res = mockRes();

    await handleZaloLogSummary(
      { method: 'GET' } as any,
      res,
      db as any,
      { uid: 'admin-1', role: 'admin' }
    );

    expect(res.body.logs[0]).toMatchObject({
      id: 'manual-1',
      studentName: 'TRẦN THỊ BÌNH',
    });
  });
});
