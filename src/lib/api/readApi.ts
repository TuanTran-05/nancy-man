import { apiRequest } from './apiClient';

export type ReadApiSuccess<T> = {
  success: true;
  data: T;
  cursor?: string;
  serverTime: string;
};

export type ReadApiFailure = {
  success: false;
  errorCode: string;
  error: string;
};

export type ReadApiResponse<T> = ReadApiSuccess<T> | ReadApiFailure;

type ReadParams = Record<string, string | number | boolean | undefined | null>;

const inFlightReads = new Map<string, Promise<ReadApiResponse<unknown>>>();

export type ReadChannelPage<T> = {
  data: T;
  cursor?: string;
  serverTime: string;
};

function buildReadSearch(channel: string, params: ReadParams) {
  const search = new URLSearchParams({ channel });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  return search;
}

function requestReadEnvelope<T>(url: string): Promise<ReadApiResponse<T>> {
  const existing = inFlightReads.get(url);
  if (existing) return existing as Promise<ReadApiResponse<T>>;

  const request = apiRequest<ReadApiResponse<T>>(url);
  inFlightReads.set(url, request as Promise<ReadApiResponse<unknown>>);
  const cleanup = () => {
    if (inFlightReads.get(url) === request) inFlightReads.delete(url);
  };
  void request.then(cleanup, cleanup);
  return request;
}

export async function readChannel<T>(channel: string, params: ReadParams = {}): Promise<T> {
  const search = buildReadSearch(channel, params);
  const response = await requestReadEnvelope<T>(`/api/v1/read/${channel}?${search}`);
  if (!response.success) {
    throw new Error('error' in response ? response.error : 'Read API request failed');
  }
  return response.data;
}

export async function readChannelPage<T>(
  channel: string,
  params: ReadParams = {}
): Promise<ReadChannelPage<T>> {
  const search = buildReadSearch(channel, params);
  const response = await requestReadEnvelope<T>(`/api/v1/read/${channel}?${search}`);
  if (!response.success) {
    throw new Error('error' in response ? response.error : 'Read API request failed');
  }
  return {
    data: response.data,
    cursor: response.cursor,
    serverTime: response.serverTime,
  };
}

type StudentPage<T> = {
  students: T[];
  page?: { hasMore?: boolean; nextCursor?: string | null };
};

export type StudentPageProgress<T> = {
  students: readonly T[];
  pageNumber: number;
  hasMore: boolean;
};

export async function readAllStudentPages<T extends { id: string }>(
  params: ReadParams = {},
  options: { onPage?: (progress: StudentPageProgress<T>) => void } = {}
): Promise<T[]> {
  const students: T[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
    const data = await readChannel<StudentPage<T>>('students', {
      ...params,
      limit: params.limit || 200,
      cursor,
    });

    for (const student of data.students || []) {
      if (seenIds.has(student.id)) {
        throw new Error('Student pagination returned a duplicate student');
      }
      seenIds.add(student.id);
      students.push(student);
    }

    const hasMore = data.page?.hasMore === true;
    options.onPage?.({
      // Do not expose the mutable accumulator while subsequent pages append.
      students: [...students],
      pageNumber: pageNumber + 1,
      hasMore,
    });

    if (!hasMore) return students;

    const nextCursor = String(data.page.nextCursor || '').trim();
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error('Student pagination cursor did not advance');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new Error('Student pagination exceeded the safe page limit');
}
