import { describe, expect, it, vi, beforeEach } from 'vitest';
import { apiRequest } from './apiClient';
import {
  getAssignmentAttemptDraft,
  saveAssignmentAttemptDraft,
  clearAssignmentAttemptDraft,
} from './assignmentAttemptDraftApi';

vi.mock('./apiClient', () => ({
  apiRequest: vi.fn(),
}));

describe('assignmentAttemptDraftApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gets an existing draft', async () => {
    const draft = {
      id: 'assignment-1_student-1',
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      content: 'My essay draft',
      quizAnswers: [],
      assessmentAnswers: [],
    };
    vi.mocked(apiRequest).mockResolvedValue({ success: true, data: draft });

    const result = await getAssignmentAttemptDraft('assignment-1');

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/edu/assignment-attempt-draft-get?assignmentId=assignment-1'
    );
    expect(result).toEqual(draft);
  });

  it('returns null when no draft exists', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true, data: null });

    const result = await getAssignmentAttemptDraft('assignment-1');

    expect(result).toBeNull();
  });

  it('saves a draft with clientSavedAt timestamp', async () => {
    const savedDraft = {
      id: 'assignment-1_student-1',
      assignmentId: 'assignment-1',
      content: 'Draft',
    };
    vi.mocked(apiRequest).mockResolvedValue({ success: true, data: savedDraft });

    const result = await saveAssignmentAttemptDraft({
      assignmentId: 'assignment-1',
      content: 'Draft',
    });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/edu/assignment-attempt-draft-save',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          assignmentId: 'assignment-1',
          content: 'Draft',
          clientSavedAt: expect.any(String),
        }),
      })
    );
    expect(result).toEqual(savedDraft);
  });

  it('clears a draft', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true });

    await clearAssignmentAttemptDraft('assignment-1');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/edu/assignment-attempt-draft-clear', {
      method: 'POST',
      body: { assignmentId: 'assignment-1' },
    });
  });
});
