import { queryOptions, useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { officeQueryKeys } from '../../lib/office/officeQueryKeys';
import {
  officeSharedQueryOptions,
  type OfficeQueryIdentity,
} from '../../lib/office/officeQueryPolicy';

/**
 * Every key below carries the viewer's identity because the server narrows
 * these endpoints by role — accounting never receives `not_requested` rows or
 * evaluation documents — and `queryClient` is a module-level singleton that
 * outlives sign-out. Without it, whoever loaded the page first decides what the
 * next role sees.
 */
export function useQueryIdentity(): OfficeQueryIdentity {
  const { profile } = useAuth();
  return { uid: profile?.uid || '', role: profile?.role || '' };
}

/**
 * The archive search hits the server, so a fast second submit would otherwise
 * leave a request — and a cache entry — behind for a value nobody is looking at.
 */
export const COURSE_CLOSING_SEARCH_DEBOUNCE_MS = 300;

export type CourseClosingDocumentType = 'evaluation' | 'tuition';
export type CourseClosingDocumentMode = 'inline' | 'attachment';

export interface CourseClosingRecordFileResponse {
  success: true;
  url: string;
  downloadFilename: string;
  expiresAt: string;
}

export interface CourseClosingRecordMonthResponse {
  success: boolean;
  month: string;
}

export interface CourseClosingRecordsResponse {
  success: boolean;
  month: string;
  records: any[];
  truncated: boolean;
}

export function courseClosingRecordMonthQueryOptions(identity: OfficeQueryIdentity) {
  return queryOptions<CourseClosingRecordMonthResponse>({
    queryKey: officeQueryKeys.courseClosingMonth(identity),
    queryFn: () =>
      apiRequest<CourseClosingRecordMonthResponse>('/api/v1/classes/course-closing-record-month'),
    enabled: Boolean(identity.uid && identity.role),
    ...officeSharedQueryOptions,
  });
}

export function courseClosingRecordsQueryOptions(
  identity: OfficeQueryIdentity,
  month: string,
  searchQuery?: string
) {
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  if (searchQuery?.trim()) params.set('q', searchQuery.trim());

  return queryOptions<CourseClosingRecordsResponse>({
    queryKey: officeQueryKeys.courseClosingRecords(identity, month, searchQuery || ''),
    queryFn: () =>
      apiRequest<CourseClosingRecordsResponse>(
        `/api/v1/classes/course-closing-records?${params.toString()}`
      ),
    enabled: Boolean(identity.uid && identity.role && month),
    staleTime: 15 * 60_000,
    gcTime: 15 * 60_000,
  });
}

export function fetchCourseClosingRecordFile(
  recordId: string,
  documentType: CourseClosingDocumentType,
  mode: CourseClosingDocumentMode
) {
  const params = new URLSearchParams({ recordId, documentType, mode });
  return apiRequest<CourseClosingRecordFileResponse>(
    `/api/v1/classes/course-closing-record-file?${params.toString()}`
  );
}

export function courseClosingRecordFileQueryOptions(
  identity: OfficeQueryIdentity,
  recordId?: string,
  documentType?: CourseClosingDocumentType
) {
  return queryOptions<CourseClosingRecordFileResponse>({
    queryKey: officeQueryKeys.courseClosingFile(
      identity,
      recordId || '',
      documentType || '',
      'inline'
    ),
    queryFn: () => fetchCourseClosingRecordFile(recordId!, documentType!, 'inline'),
    enabled: Boolean(identity.uid && identity.role && recordId && documentType),
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 0,
  });
}

export function useCourseClosingRecordMonthQuery() {
  const identity = useQueryIdentity();
  return useQuery(courseClosingRecordMonthQueryOptions(identity));
}

export function useCourseClosingRecordsQuery(month: string, searchQuery?: string) {
  const identity = useQueryIdentity();
  return useQuery(courseClosingRecordsQueryOptions(identity, month, searchQuery));
}

export function useCourseClosingRecordFileQuery(
  recordId?: string,
  documentType?: CourseClosingDocumentType
) {
  const identity = useQueryIdentity();
  return useQuery(courseClosingRecordFileQueryOptions(identity, recordId, documentType));
}
