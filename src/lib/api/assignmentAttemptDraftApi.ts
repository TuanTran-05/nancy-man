import { apiRequest } from './apiClient';
import type { AssignmentAttemptDraft } from '../../../shared/assignmentAttemptDraft';

export async function getAssignmentAttemptDraft(
  assignmentId: string
): Promise<AssignmentAttemptDraft | null> {
  const response = await apiRequest<{ success: boolean; data: AssignmentAttemptDraft | null }>(
    `/api/v1/edu/assignment-attempt-draft-get?assignmentId=${encodeURIComponent(assignmentId)}`
  );
  return response.data ?? null;
}

export async function saveAssignmentAttemptDraft(payload: {
  assignmentId: string;
  content?: string;
  quizAnswers?: unknown[];
  assessmentAnswers?: unknown[];
  clientSavedAt?: string;
}): Promise<AssignmentAttemptDraft> {
  const response = await apiRequest<{ success: boolean; data: AssignmentAttemptDraft }>(
    '/api/v1/edu/assignment-attempt-draft-save',
    {
      method: 'POST',
      body: { ...payload, clientSavedAt: payload.clientSavedAt ?? new Date().toISOString() },
    }
  );
  return response.data;
}

export async function clearAssignmentAttemptDraft(assignmentId: string): Promise<void> {
  await apiRequest('/api/v1/edu/assignment-attempt-draft-clear', {
    method: 'POST',
    body: { assignmentId },
  });
}
