import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadAssignmentMedia } from './uploadAssignmentMedia';

describe('uploadAssignmentMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          success: true,
          media: {
            id: 'media-1',
            type: 'audio',
            source: 'upload',
            url: 'https://cdn.example.com/audio.mp3',
            storagePath: 'assignment_media/class-1/teacher-1/audio.mp3',
          },
        })
      ),
    }) as any;
  });

  it('posts form data with bearer auth and returns media metadata', async () => {
    const file = new File(['audio'], 'audio.mp3', { type: 'audio/mpeg' });

    const media = await uploadAssignmentMedia({
      classId: 'class-1',
      mediaType: 'audio',
      file,
      title: 'Audio 1',
      altText: 'Listening audio',
      transcript: 'Transcript',
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/edu/assignment-media-upload',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: expect.any(FormData),
      })
    );
    expect(media).toEqual({
      id: 'media-1',
      type: 'audio',
      source: 'upload',
      url: 'https://cdn.example.com/audio.mp3',
      storagePath: 'assignment_media/class-1/teacher-1/audio.mp3',
    });
  });

  it('throws a useful message when upload fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: vi
        .fn()
        .mockResolvedValue(JSON.stringify({ success: false, error: 'Invalid audio file type' })),
    }) as any;

    const file = new File(['bad'], 'bad.png', { type: 'image/png' });

    await expect(
      uploadAssignmentMedia({
        classId: 'class-1',
        mediaType: 'audio',
        file,
      })
    ).rejects.toThrow('Invalid audio file type');
  });
});
