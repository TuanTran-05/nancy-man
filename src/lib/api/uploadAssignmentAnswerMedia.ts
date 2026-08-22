import type { QuestionMedia, QuestionMediaType } from '../../../shared/assignmentAssessment';

interface UploadAssignmentAnswerMediaInput {
  assignmentId: string;
  questionId: string;
  mediaType: Extract<QuestionMediaType, 'audio' | 'document'>;
  file: File;
}

export async function uploadAssignmentAnswerMedia({
  assignmentId,
  questionId,
  mediaType,
  file,
}: UploadAssignmentAnswerMediaInput): Promise<QuestionMedia> {
  const formData = new FormData();
  formData.append('assignmentId', assignmentId);
  formData.append('questionId', questionId);
  formData.append('mediaType', mediaType);
  formData.append('file', file);

  const response = await fetch('/api/v1/edu/assignment-answer-media-upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    body: formData,
  });
  const payload = await response.json();
  if (!response.ok || !payload?.media) {
    throw new Error(payload?.error || 'Failed to upload assignment answer media');
  }
  return payload.media;
}
