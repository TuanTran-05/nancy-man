import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleAcceptSubstituteRequest,
  handleCancelSubstituteRequest,
  handleCreateSubstituteRequest,
} from './classSubstituteHandlers.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';

vi.mock('../../lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../helpers/classHelpers.js', () => ({
  writeClassAudit: vi.fn().mockResolvedValue(undefined),
}));

function mockRes() {
  const res: any = {};
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

const user = { uid: 'teacher-2', email: 'teacher-2@nancy.com' };
const userInfo = { role: 'teacher', name: 'Teacher Two' };

describe('class substitute schedule invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('touches the office schedule after creating a substitute request', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'request-1' });
    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'classes') {
          return {
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({ teacherId: user.uid, name: 'Class One' }),
              }),
            })),
          };
        }
        if (name === 'substitute_requests') return { add };
        return {};
      }),
    } as any;

    const res = mockRes();
    await handleCreateSubstituteRequest(
      { method: 'POST', body: { classId: 'class-1', date: '2026-08-17' } } as any,
      res,
      db,
      user,
      userInfo
    );

    expect(res.statusCode).toBe(201);
    expect(touchRealtimeEvent).toHaveBeenCalledWith('office-schedule-changed');
  });

  it('touches the office schedule after accepting a substitute request', async () => {
    const requestRef = {};
    const update = vi.fn();
    const db = {
      collection: vi.fn(() => ({ doc: vi.fn(() => requestRef) })),
      runTransaction: vi.fn(async (callback: any) =>
        callback({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ status: 'pending', requestingTeacherId: 'teacher-1' }),
          }),
          update,
        })
      ),
    } as any;

    const res = mockRes();
    await handleAcceptSubstituteRequest(
      { method: 'POST', body: { requestId: 'request-1' } } as any,
      res,
      db,
      user,
      userInfo
    );

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalled();
    expect(touchRealtimeEvent).toHaveBeenCalledWith('office-schedule-changed');
  });

  it('touches the office schedule after cancelling a substitute request', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const requestRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ status: 'pending', requestingTeacherId: user.uid }),
      }),
      update,
    };
    const db = {
      collection: vi.fn(() => ({ doc: vi.fn(() => requestRef) })),
    } as any;

    const res = mockRes();
    await handleCancelSubstituteRequest(
      { method: 'POST', body: { requestId: 'request-1' } } as any,
      res,
      db,
      user,
      userInfo
    );

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalled();
    expect(touchRealtimeEvent).toHaveBeenCalledWith('office-schedule-changed');
  });
});
