type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ApiRequestOptions {
  method?: ApiMethod;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ApiDetailedResponse<T> {
  data: T | null;
  status: number;
  headers: Headers;
}

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

function getRequestHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };
}

function parseJsonResponse(text: string, status: number): unknown {
  if (!text) {
    throw new ApiError(`Server returned empty response (status ${status})`, status, null);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(
      `Server returned non-JSON response (status ${status}): ${text.slice(0, 100)}`,
      status,
      text
    );
  }
}

function getErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return error;
  }

  return fallback;
}

export async function apiRequestDetailed<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<ApiDetailedResponse<T>> {
  const method = options.method || (options.body === undefined ? 'GET' : 'POST');
  const headers = { ...getRequestHeaders(), ...options.headers };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      signal: controller.signal,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 304) {
    return { data: null, status: response.status, headers: response.headers };
  }

  const text = await response.text();
  const data = parseJsonResponse(text, response.status);
  const hasSuccessField = data && typeof data === 'object' && 'success' in data;
  const success = hasSuccessField ? (data as { success?: unknown }).success === true : true;

  if (!response.ok || !success) {
    throw new ApiError(getErrorMessage(data, 'API request failed'), response.status, data);
  }

  return { data: data as T, status: response.status, headers: response.headers };
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await apiRequestDetailed<T>(path, options);
  if (response.status === 304) {
    throw new ApiError('Server returned 304 without a client cache entry', 304, null);
  }
  return response.data as T;
}
