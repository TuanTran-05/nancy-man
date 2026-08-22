import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './apiClient';
import { readAllStudentPages, readChannel, readChannelPage } from './readApi';

vi.mock('./apiClient', () => ({
  apiRequest: vi.fn(),
}));

describe('readChannelPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data, cursor, and serverTime from the read API envelope', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      success: true,
      data: { items: [{ id: 'row-1' }], hasMore: true, cursor: 'next-doc' },
      cursor: 'next-doc',
      serverTime: '2026-05-26T00:00:00.000Z',
    });

    const result = await readChannelPage<{ items: { id: string }[]; hasMore: boolean }>(
      'audit-log',
      {
        cursor: 'start-doc',
        limit: 25,
        empty: '',
        ignored: null,
      }
    );

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/read/audit-log?channel=audit-log&cursor=start-doc&limit=25'
    );
    expect(result).toEqual({
      data: { items: [{ id: 'row-1' }], hasMore: true, cursor: 'next-doc' },
      cursor: 'next-doc',
      serverTime: '2026-05-26T00:00:00.000Z',
    });
  });

  it('throws the server error message for failed read API envelopes', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      success: false,
      errorCode: 'forbidden',
      error: 'Not authorized',
    });

    await expect(readChannelPage('finance')).rejects.toThrow('Not authorized');
  });

  it('deduplicates concurrent reads for the same channel and params', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      success: true,
      data: { model: { id: 'dashboard_global' } },
      serverTime: '2026-07-18T00:00:00.000Z',
    });

    const [first, second] = await Promise.all([
      readChannel('dashboard-aggregate'),
      readChannel('dashboard-aggregate'),
    ]);

    expect(apiRequest).toHaveBeenCalledOnce();
    expect(first).toBe(second);
  });
});

describe('readAllStudentPages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('follows every cursor and returns the complete de-duplicated class list', async () => {
    const onPage = vi.fn();
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        success: true,
        data: {
          students: [{ id: 'student-1' }, { id: 'student-2' }],
          page: { hasMore: true, nextCursor: 'student-2' },
        },
        serverTime: '2026-07-18T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          students: [{ id: 'student-3' }],
          page: { hasMore: false, nextCursor: null },
        },
        serverTime: '2026-07-18T00:00:01.000Z',
      });

    const students = await readAllStudentPages<{ id: string }>(
      {
        view: 'directory',
        classId: 'class-1',
      },
      { onPage }
    );

    expect(students.map((student) => student.id)).toEqual(['student-1', 'student-2', 'student-3']);
    expect(apiRequest).toHaveBeenNthCalledWith(2, expect.stringContaining('cursor=student-2'));
    expect(onPage).toHaveBeenNthCalledWith(1, {
      students: [{ id: 'student-1' }, { id: 'student-2' }],
      pageNumber: 1,
      hasMore: true,
    });
    expect(onPage).toHaveBeenNthCalledWith(2, {
      students: [{ id: 'student-1' }, { id: 'student-2' }, { id: 'student-3' }],
      pageNumber: 2,
      hasMore: false,
    });
  });

  it('rejects a repeated cursor instead of returning partial data', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        success: true,
        data: { students: [{ id: 'student-1' }], page: { hasMore: true, nextCursor: 'same' } },
        serverTime: '2026-07-18T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        success: true,
        data: { students: [{ id: 'student-2' }], page: { hasMore: true, nextCursor: 'same' } },
        serverTime: '2026-07-18T00:00:01.000Z',
      });

    await expect(readAllStudentPages({ view: 'directory' })).rejects.toThrow(
      'Student pagination cursor did not advance'
    );
  });
});
