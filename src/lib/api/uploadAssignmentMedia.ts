import type { QuestionMedia, QuestionMediaType } from '../../../shared/assignmentAssessment';

interface UploadAssignmentMediaInput {
  classId: string;
  mediaType: QuestionMediaType;
  file: File;
  title?: string;
  altText?: string;
  transcript?: string;
}

interface UploadAssignmentMediaResponse {
  success: boolean;
  media?: QuestionMedia;
  error?: string;
}

function parseUploadResponse(text: string, status: number): UploadAssignmentMediaResponse {
  try {
    return JSON.parse(text) as UploadAssignmentMediaResponse;
  } catch {
    throw new Error(`Server returned non-JSON upload response (${status})`);
  }
}

export async function uploadAssignmentMedia(
  input: UploadAssignmentMediaInput
): Promise<QuestionMedia> {
  const form = new FormData();
  form.append('classId', input.classId);
  form.append('mediaType', input.mediaType);
  form.append('file', input.file);
  if (input.title) form.append('title', input.title);
  if (input.altText) form.append('altText', input.altText);
  if (input.transcript) form.append('transcript', input.transcript);

  const response = await fetch('/api/v1/edu/assignment-media-upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    body: form,
  });
  const data = parseUploadResponse(await response.text(), response.status);
  if (!response.ok || data.success !== true || !data.media) {
    throw new Error(data.error || 'Failed to upload assignment media');
  }
  return data.media;
}
