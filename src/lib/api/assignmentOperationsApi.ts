import { apiRequest } from './apiClient';

export async function getAssignmentProgressSummary<T = unknown>(assignmentId: string) {
  const response = await apiRequest<{ success: boolean; data: T }>(
    `/api/v1/edu/assignment-progress-summary?assignmentId=${encodeURIComponent(assignmentId)}`
  );
  return response.data;
}
