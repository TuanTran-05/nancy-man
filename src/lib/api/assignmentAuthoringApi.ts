import { apiRequest, ApiError } from './apiClient';
import type {
  AuthoringImportPreview,
  AuthoringImportSource,
} from '../../../shared/assignmentAuthoring';

export async function saveAuthoringDraft<T>(draft: T) {
  const response = await apiRequest<{ success: boolean; data: T }>(
    '/api/v1/edu/assignment-draft-save',
    {
      method: 'POST',
      body: draft,
    }
  );
  return response.data;
}

export async function listAuthoringDrafts<T = unknown>() {
  const response = await apiRequest<{ success: boolean; data: T[] }>(
    '/api/v1/edu/assignment-draft-list'
  );
  return response.data;
}

export async function getAuthoringDraft<T = unknown>(id: string) {
  const response = await apiRequest<{ success: boolean; data: T }>(
    `/api/v1/edu/assignment-draft-get?id=${encodeURIComponent(id)}`
  );
  return response.data;
}

export async function deleteAuthoringDraft(id: string) {
  await apiRequest('/api/v1/edu/assignment-draft-delete', {
    method: 'DELETE',
    body: { id },
  });
}

export async function publishAuthoringDraft(id: string) {
  const response = await apiRequest<{ success: boolean; id: string }>(
    '/api/v1/edu/assignment-draft-publish',
    {
      method: 'POST',
      body: { id },
    }
  );
  return response.id;
}

export async function createQuestionBankItem<T>(item: T) {
  const response = await apiRequest<{ success: boolean; data: T }>(
    '/api/v1/edu/assessment-question-bank-create',
    {
      method: 'POST',
      body: item,
    }
  );
  return response.data;
}

export async function searchQuestionBank<T = unknown>(
  filters: Record<string, string | undefined> = {}
) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await apiRequest<{
    success: boolean;
    data: { items: T[]; nextCursor: string | null };
  }>(`/api/v1/edu/assessment-question-bank-search${suffix}`);
  return response.data;
}

export async function createMediaBankItem<T>(item: T) {
  const response = await apiRequest<{ success: boolean; data: T }>(
    '/api/v1/edu/assessment-media-bank-create',
    {
      method: 'POST',
      body: item,
    }
  );
  return response.data;
}

export async function searchMediaBank<T = unknown>(
  filters: Record<string, string | undefined> = {}
) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await apiRequest<{
    success: boolean;
    data: { items: T[]; nextCursor: string | null };
  }>(`/api/v1/edu/assessment-media-bank-search${suffix}`);
  return response.data;
}

export async function submitQuestionBankReview(id: string) {
  await apiRequest('/api/v1/edu/assessment-question-bank-submit-review', {
    method: 'POST',
    body: { id },
  });
}

export async function reviewQuestionBankItem(input: {
  id: string;
  decision: 'approve' | 'reject' | 'archive';
  reviewNote?: string;
}) {
  await apiRequest('/api/v1/edu/assessment-question-bank-review', {
    method: 'POST',
    body: input,
  });
}

async function parseMultipartJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text)
    throw new ApiError(
      `Server returned empty response (status ${response.status})`,
      response.status,
      null
    );
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(
      `Server returned non-JSON response (status ${response.status}): ${text.slice(0, 100)}`,
      response.status,
      text
    );
  }
  const success =
    data && typeof data === 'object' && 'success' in data
      ? (data as { success?: unknown }).success === true
      : response.ok;
  if (!response.ok || !success) {
    const error =
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as { error?: unknown }).error === 'string'
        ? String((data as { error?: unknown }).error)
        : 'API request failed';
    throw new ApiError(error, response.status, data);
  }
  return data as T;
}

export async function previewAuthoringImport(file: File): Promise<AuthoringImportPreview> {
  const form = new FormData();
  form.append('file', file);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch('/api/v1/edu/assignment-draft-import-preview', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: form,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload = await parseMultipartJsonResponse<{
    success: boolean;
    data: AuthoringImportPreview;
  }>(response);
  return payload.data;
}

export type AuthoringImportTemplateFormat = Extract<AuthoringImportSource, 'xlsx' | 'csv' | 'docx'>;

function getFilenameFromContentDisposition(value: string | null, fallback: string) {
  const match = value?.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

export async function downloadAuthoringImportTemplate(
  format: AuthoringImportTemplateFormat
): Promise<{ filename: string; blob: Blob }> {
  const response = await fetch(
    `/api/v1/edu/assignment-draft-import-template?format=${encodeURIComponent(format)}`,
    {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    let message = 'Template download failed';
    try {
      const data = JSON.parse(text) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      if (text.trim()) message = text.slice(0, 100);
    }
    throw new ApiError(message, response.status, text);
  }

  return {
    filename: getFilenameFromContentDisposition(
      response.headers.get('Content-Disposition'),
      `assignment-import-template.${format}`
    ),
    blob: await response.blob(),
  };
}
