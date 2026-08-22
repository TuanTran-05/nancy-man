import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequestDetailed } from './apiClient';
import { clearStudentDirectoryCache, getStudentDirectory } from './studentDirectoryApi';

vi.mock('./apiClient', () => ({
  apiRequestDetailed: vi.fn(),
}));

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { uid: 'admin-1' } },
}));

function completePayload(count = 2) {
  const students = Array.from({ length: count }, (_, index) => ({
    id: 'stu-' + index,
    name: 'Student ' + index,
    classId: 'class-1',
  }));
  return {
    success: true as const,
    data: {
      students,
      meta: {
        total: students.length,
        complete: true as const,
        maxSupported: 3000 as const,
        version: 7,
        generatedAt: '2026-07-18T00:00:00.000Z',
      },
      page: { limit: 3000, nextCursor: null, hasMore: false },
    },
    serverTime: '2026-07-18T00:00:00.000Z',
  };
}

describe('studentDirectoryApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStudentDirectoryCache();
  });

  it('deduplicates concurrent requests and caches the complete index', async () => {
    vi.mocked(apiRequestDetailed).mockResolvedValue({
      status: 200,
      headers: new Headers({ ETag: 'etag-7' }),
      data: completePayload(),
    });

    const [first, second] = await Promise.all([getStudentDirectory(), getStudentDirectory()]);
    const third = await getStudentDirectory();

    expect(apiRequestDetailed).toHaveBeenCalledOnce();
    expect(first).toBe(second);
    expect(third).toBe(first);
    expect(first.students).toHaveLength(2);
  });

  it('revalidates with ETag and returns the cached index on 304', async () => {
    vi.mocked(apiRequestDetailed)
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ ETag: 'etag-7' }),
        data: completePayload(),
      })
      .mockResolvedValueOnce({ status: 304, headers: new Headers({ ETag: 'etag-7' }), data: null });

    const cached = await getStudentDirectory();
    const revalidated = await getStudentDirectory({ revalidate: true });

    expect(revalidated).toBe(cached);
    expect(apiRequestDetailed).toHaveBeenLastCalledWith(
      expect.stringContaining('view=index'),
      expect.objectContaining({ headers: { 'If-None-Match': 'etag-7' } })
    );
  });

  it('rejects incomplete or internally inconsistent payloads', async () => {
    const payload = completePayload();
    payload.data.meta.total = 200;
    vi.mocked(apiRequestDetailed).mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: payload,
    });

    await expect(getStudentDirectory()).rejects.toThrow('Student index is incomplete');
  });
});
