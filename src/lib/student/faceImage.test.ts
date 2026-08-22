import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveStudentFaceUrl } from './faceImage';

const mocks = vi.hoisted(() => ({
  getIdToken: vi.fn(),
}));

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: {
    currentUser: {
      getIdToken: mocks.getIdToken,
    },
  },
}));

describe('resolveStudentFaceUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getIdToken.mockResolvedValue('auth-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob(['face-bytes'], { type: 'image/jpeg' })),
      })
    );
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:student-face'),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns direct non-storage face image values unchanged', async () => {
    await expect(resolveStudentFaceUrl('stu-1', 'data:image/jpeg;base64,abc')).resolves.toBe(
      'data:image/jpeg;base64,abc'
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads object-storage face images through the same-origin API as object URLs', async () => {
    await expect(
      resolveStudentFaceUrl('stu-1', '', 'student_faces/teacher-1/stu-1/face.jpg')
    ).resolves.toBe('blob:student-face');

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/knowledge-bank/student-face-image?studentId=stu-1&storagePath=student_faces%2Fteacher-1%2Fstu-1%2Fface.jpg',
      {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      }
    );
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('retries the network request after a failed resolution instead of replaying the same failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'Not authenticated' }),
    });

    await expect(
      resolveStudentFaceUrl('stu-2', '', 'student_faces/teacher-1/stu-2/face.jpg')
    ).rejects.toThrow('Not authenticated');

    await expect(
      resolveStudentFaceUrl('stu-2', '', 'student_faces/teacher-1/stu-2/face.jpg')
    ).resolves.toBe('blob:student-face');

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
