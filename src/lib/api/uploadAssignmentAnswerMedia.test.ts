import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadAssignmentAnswerMedia } from './uploadAssignmentAnswerMedia';

describe('uploadAssignmentAnswerMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          media: {
            id: 'recording-1',
            type: 'audio',
            source: 'upload',
            url: 'https://cdn.example.com/recording.webm',
            storagePath: 'assignment_answers/assignment-1/student-1/q1/recording.webm',
          },
        }),
      })
    );
  });

  it('uploads a student recording as multipart form data', async () => {
    const blob = new Blob(['voice'], { type: 'audio/webm' });
    const result = await uploadAssignmentAnswerMedia({
      assignmentId: 'assignment-1',
      questionId: 'q-speaking',
      mediaType: 'audio',
      file: new File([blob], 'answer.webm', { type: 'audio/webm' }),
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/edu/assignment-answer-media-upload',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: expect.any(FormData),
      })
    );
    expect(result.id).toBe('recording-1');
  });
});
