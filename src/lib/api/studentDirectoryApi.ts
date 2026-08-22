import { auth } from '../../lib/auth/sessionAuth';
import { apiRequestDetailed } from './apiClient';

export type StudentIndexRow = {
  id: string;
  name?: string;
  studentId?: string;
  code?: string;
  classId?: string;
  teacherId?: string;
  dob?: string;
  gender?: string;
  enrollmentStatus?: string;
  studentLifecycle?: string;
  admissionStatus?: string;
  leaveUntil?: string;
  isRevoked?: boolean;
  siblingGroupId?: string;
  /** See `src/types/student.ts` — server-derived, optional during rollout. */
  canonicalProfileId?: string;
  placementStatus?: string;
  requestedProfileId?: string;
  redirected?: boolean;
};

export type StudentIndexPayload = {
  students: StudentIndexRow[];
  meta: {
    total: number;
    complete: true;
    maxSupported: 3000;
    version: number;
    generatedAt: string;
  };
  page: { limit: 3000; nextCursor: null; hasMore: false };
};

type StudentIndexEnvelope = {
  success: boolean;
  data?: StudentIndexPayload;
  error?: string;
};

type CacheEntry = { payload: StudentIndexPayload; etag: string | null };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<StudentIndexPayload>>();

function validateCompleteIndex(payload: StudentIndexPayload | undefined): StudentIndexPayload {
  if (
    !payload ||
    payload.meta?.complete !== true ||
    !Array.isArray(payload.students) ||
    payload.meta.total !== payload.students.length ||
    payload.students.length > 3000 ||
    payload.meta.maxSupported !== 3000 ||
    payload.page?.hasMore !== false ||
    payload.page?.nextCursor !== null ||
    new Set(payload.students.map((student) => student.id)).size !== payload.students.length
  ) {
    throw new Error('Student index is incomplete or inconsistent');
  }
  return payload;
}

export function clearStudentDirectoryCache() {
  cache.clear();
  inFlight.clear();
}

export async function getStudentDirectory(
  options: { revalidate?: boolean } = {}
): Promise<StudentIndexPayload> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Not authenticated');

  const cached = cache.get(userId);
  if (cached && !options.revalidate) return cached.payload;

  const pending = inFlight.get(userId);
  if (pending) return pending;

  const request = (async () => {
    const headers = cached?.etag ? { 'If-None-Match': cached.etag } : undefined;
    const search = new URLSearchParams({ channel: 'students', view: 'index' });
    const response = await apiRequestDetailed<StudentIndexEnvelope>(
      '/api/v1/read/students?' + search,
      headers ? { headers } : {}
    );

    if (response.status === 304) {
      if (!cached) throw new Error('Student index returned 304 without a cache entry');
      return cached.payload;
    }

    const envelope = response.data;
    if (!envelope?.success) {
      throw new Error(envelope?.error || 'Student index request failed');
    }

    const payload = validateCompleteIndex(envelope.data);
    cache.set(userId, { payload, etag: response.headers.get('ETag') });
    return payload;
  })();

  inFlight.set(userId, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(userId) === request) inFlight.delete(userId);
  }
}
