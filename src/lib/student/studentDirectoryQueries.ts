import { queryOptions } from '@tanstack/react-query';
import type { CourseFeeLedger, SafeStudent, Submission } from '../../types';
import { readAllStudentPages, readChannel, type StudentPageProgress } from '../api/readApi';
import { FRONTEND_LARGE_COLLECTION_LIMIT, STUDENT_DIRECTORY_PAGE_SIZE } from '../api/readLimits';

export const STUDENT_DIRECTORY_STALE_TIME_MS = 15 * 60_000;
export const STUDENT_DIRECTORY_GC_TIME_MS = 30 * 60_000;

type StudentDirectoryQueryIdentity = {
  uid: string;
  role: string;
};

export const studentDirectoryQueryKeys = {
  roster: ({ uid, role }: StudentDirectoryQueryIdentity) =>
    ['student-directory', uid, role, 'roster'] as const,
  ledgers: ({ uid, role }: StudentDirectoryQueryIdentity) =>
    ['student-directory', uid, role, 'ledgers'] as const,
  gradedSubmissions: ({ uid, role }: StudentDirectoryQueryIdentity) =>
    ['student-directory', uid, role, 'graded-submissions'] as const,
};

const sharedQueryOptions = {
  staleTime: STUDENT_DIRECTORY_STALE_TIME_MS,
  gcTime: STUDENT_DIRECTORY_GC_TIME_MS,
  refetchInterval: STUDENT_DIRECTORY_STALE_TIME_MS,
  refetchIntervalInBackground: false,
  retry: false,
} as const;

export function studentRosterQueryOptions(
  identity: StudentDirectoryQueryIdentity,
  enabled: boolean,
  onPage?: (progress: StudentPageProgress<SafeStudent>) => void
) {
  return queryOptions({
    queryKey: studentDirectoryQueryKeys.roster(identity),
    queryFn: () =>
      readAllStudentPages<SafeStudent>(
        {
          view: 'directory',
          limit: STUDENT_DIRECTORY_PAGE_SIZE,
        },
        { onPage }
      ),
    enabled,
    ...sharedQueryOptions,
  });
}

export function studentLedgerQueryOptions(
  identity: StudentDirectoryQueryIdentity,
  enabled: boolean
) {
  return queryOptions({
    queryKey: studentDirectoryQueryKeys.ledgers(identity),
    queryFn: async () => {
      const data = await readChannel<{ ledgers?: CourseFeeLedger[] }>('accounting-students', {
        limit: FRONTEND_LARGE_COLLECTION_LIMIT,
        view: 'ledgers',
      });
      return data.ledgers || [];
    },
    enabled,
    ...sharedQueryOptions,
  });
}

export function studentGradedSubmissionsQueryOptions(
  identity: StudentDirectoryQueryIdentity,
  enabled: boolean
) {
  return queryOptions({
    queryKey: studentDirectoryQueryKeys.gradedSubmissions(identity),
    queryFn: async () => {
      const data = await readChannel<{ submissions?: Submission[] }>('assignments', {
        limit: FRONTEND_LARGE_COLLECTION_LIMIT,
        view: 'graded-submissions',
      });
      return (data.submissions || []).filter((submission) => submission.status === 'graded');
    },
    enabled,
    ...sharedQueryOptions,
  });
}
